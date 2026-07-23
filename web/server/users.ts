import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'

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
  username_normalized: string
  password_hash: string
  salt: string
  created_at: string | Date
}

interface SessionRow {
  token: string
  user_id: string
  created_at: string
  expires_at: string
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export class UserStore {
  private readonly users = new Map<string, UserRow>()
  private readonly sessions = new Map<string, SessionRow>()

  constructor(private readonly pool?: Pool) {}

  async initialize(): Promise<void> {
    if (!this.pool) return
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_normalized TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
    `)
  }

  async register(username: string, password: string): Promise<AuthSession> {
    if (!USERNAME_PATTERN.test(username)) {
      throw new AuthError(400, '用户名需为 3-24 位字母、数字或下划线')
    }
    if (typeof password !== 'string' || password.length < 6) {
      throw new AuthError(400, '密码长度至少为 6 位')
    }

    const normalized = username.toLowerCase()
    const existing = await this.findUserByNormalizedName(normalized)
    if (existing) throw new AuthError(409, '该用户名已被注册')

    const salt = randomBytes(16).toString('hex')
    const user: UserRow = {
      id: randomBytes(8).toString('hex'),
      username,
      username_normalized: normalized,
      password_hash: hashPassword(password, salt),
      salt,
      created_at: new Date().toISOString(),
    }

    if (!this.pool) {
      this.users.set(normalized, user)
    } else {
      try {
        await this.pool.query(`
          INSERT INTO users (id, username, username_normalized, password_hash, salt, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [user.id, user.username, normalized, user.password_hash, user.salt, user.created_at])
      } catch (error) {
        if (isUniqueViolation(error)) throw new AuthError(409, '该用户名已被注册')
        throw error
      }
    }
    return this.createSession(toAuthUser(user))
  }

  async login(username: string, password: string): Promise<AuthSession> {
    const row = await this.findUserByNormalizedName(username.toLowerCase())
    if (!row) throw new AuthError(401, '用户名或密码错误')

    const candidate = Buffer.from(hashPassword(password, row.salt), 'hex')
    const expected = Buffer.from(row.password_hash, 'hex')
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      throw new AuthError(401, '用户名或密码错误')
    }
    return this.createSession(toAuthUser(row))
  }

  async findByToken(token: string): Promise<AuthUser | undefined> {
    if (!this.pool) {
      const session = this.sessions.get(token)
      if (!session) return undefined
      if (Date.parse(session.expires_at) <= Date.now()) {
        this.sessions.delete(token)
        return undefined
      }
      const user = [...this.users.values()].find((item) => item.id === session.user_id)
      return user ? toAuthUser(user) : undefined
    }

    const result = await this.pool.query<UserRow & { expires_at: string | Date }>(`
      SELECT s.expires_at, u.id, u.username, u.username_normalized, u.password_hash, u.salt, u.created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
    `, [token])
    const row = result.rows[0]
    if (!row) return undefined
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.logout(token)
      return undefined
    }
    return toAuthUser(row)
  }

  async logout(token: string): Promise<void> {
    if (!this.pool) {
      this.sessions.delete(token)
      return
    }
    await this.pool.query('DELETE FROM sessions WHERE token = $1', [token])
  }

  private async findUserByNormalizedName(username: string): Promise<UserRow | undefined> {
    if (!this.pool) return this.users.get(username)
    const result = await this.pool.query<UserRow>(`
      SELECT id, username, username_normalized, password_hash, salt, created_at
      FROM users WHERE username_normalized = $1
    `, [username])
    return result.rows[0]
  }

  private async createSession(user: AuthUser): Promise<AuthSession> {
    const token = randomBytes(24).toString('hex')
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    if (!this.pool) {
      this.sessions.set(token, { token, user_id: user.id, created_at: createdAt, expires_at: expiresAt })
    } else {
      await this.pool.query(`
        INSERT INTO sessions (token, user_id, created_at, expires_at)
        VALUES ($1, $2, $3, $4)
      `, [token, user.id, createdAt, expiresAt])
    }
    return { token, user, expiresAt }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
