import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export interface AuthUser {
  id: string
  username: string
  createdAt: string
}

export interface AuthSession {
  token: string
  user: AuthUser
  expiresAt: string
}

export class AuthError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,24}$/

interface UserRow {
  id: string
  username: string
  password_hash: string
  salt: string
  created_at: string
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, createdAt: row.created_at }
}

export class UserStore {
  private readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `)
  }

  register(username: string, password: string): AuthSession {
    if (!USERNAME_PATTERN.test(username)) {
      throw new AuthError(400, '用户名需为 3-24 位字母、数字或下划线')
    }
    if (typeof password !== 'string' || password.length < 6) {
      throw new AuthError(400, '密码长度至少 6 位')
    }
    const existing = this.database.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existing) throw new AuthError(409, '该用户名已被注册')

    const salt = randomBytes(16).toString('hex')
    const user: UserRow = {
      id: randomBytes(8).toString('hex'),
      username,
      password_hash: hashPassword(password, salt),
      salt,
      created_at: new Date().toISOString(),
    }
    this.database.prepare(`
      INSERT INTO users (id, username, password_hash, salt, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, user.username, user.password_hash, user.salt, user.created_at)
    return this.createSession(toAuthUser(user))
  }

  login(username: string, password: string): AuthSession {
    const row = this.database.prepare(`
      SELECT id, username, password_hash, salt, created_at FROM users WHERE username = ?
    `).get(username) as UserRow | undefined
    if (!row) throw new AuthError(401, '用户名或密码错误')

    const candidate = Buffer.from(hashPassword(password, row.salt), 'hex')
    const expected = Buffer.from(row.password_hash, 'hex')
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      throw new AuthError(401, '用户名或密码错误')
    }
    return this.createSession(toAuthUser(row))
  }

  findByToken(token: string): AuthUser | undefined {
    const row = this.database.prepare(`
      SELECT s.expires_at AS expires_at, u.id AS id, u.username AS username, u.created_at AS created_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).get(token) as (UserRow & { expires_at: string }) | undefined
    if (!row) return undefined
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.logout(token)
      return undefined
    }
    return toAuthUser(row)
  }

  logout(token: string): void {
    this.database.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  }

  private createSession(user: AuthUser): AuthSession {
    const token = randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    this.database.prepare(`
      INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
    `).run(token, user.id, new Date().toISOString(), expiresAt)
    return { token, user, expiresAt }
  }
}
