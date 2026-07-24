import { readFile, unlink, writeFile } from 'node:fs/promises'

const mode = process.argv[2]
const baseUrl = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const statePath = process.env.SMOKE_STATE_PATH ?? '/tmp/agent-treasury-production-smoke.json'

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : undefined
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${text}`)
  }
  return body
}

async function createState() {
  const username = `deploy_${Date.now()}`
  const password = 'deploy-smoke-123'
  const session = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  const headers = { Authorization: `Bearer ${session.token}` }
  const created = await request('/api/tasks', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      objective: 'Validate production persistence for a risk-controlled stock strategy',
      budgetUsdt: 1_000,
      maxLossPct: 5,
      maxAssetPct: 30,
      asset: '000001.SZ',
    }),
  })

  let task = created
  for (let attempt = 0; attempt < 180 && task.phase !== 'awaiting_approval'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    task = await request(`/api/tasks/${created.id}`, { headers })
  }
  if (task.phase !== 'awaiting_approval') throw new Error(`Unexpected phase before approval: ${task.phase}`)

  await request(`/api/tasks/${created.id}/approve`, { method: 'POST', headers })
  const executed = await request(`/api/tasks/${created.id}/execute`, { method: 'POST', headers })
  const accounts = await request(`/api/treasury/${created.id}/accounts`, { headers })
  if (executed.phase !== 'executed') throw new Error(`Unexpected execution phase: ${executed.phase}`)
  if (!executed.execution?.transactionHash) throw new Error('Execution receipt is missing')
  if (accounts.length !== 7) throw new Error(`Expected 7 Treasury accounts, received ${accounts.length}`)

  await writeFile(statePath, JSON.stringify({ username, password, taskId: created.id }), { mode: 0o600 })
  console.log(JSON.stringify({ created: true, phase: executed.phase, receipt: true, accounts: accounts.length }))
}

async function verifyState() {
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const session = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: state.username, password: state.password }),
  })
  const headers = { Authorization: `Bearer ${session.token}` }
  const task = await request(`/api/tasks/${state.taskId}`, { headers })
  const accounts = await request(`/api/treasury/${state.taskId}/accounts`, { headers })
  if (task.phase !== 'executed') throw new Error(`Persisted task has unexpected phase: ${task.phase}`)
  if (!task.execution?.transactionHash) throw new Error('Persisted execution receipt is missing')
  if (accounts.length !== 7) throw new Error(`Expected 7 persisted Treasury accounts, received ${accounts.length}`)

  await unlink(statePath)
  console.log(JSON.stringify({ restored: true, provider: task.quantEvidence?.provider, phase: task.phase, receipt: true, accounts: accounts.length }))
}

try {
  if (mode === 'create') await createState()
  else if (mode === 'verify') await verifyState()
  else throw new Error('Usage: node tests/production-api-smoke.mjs <create|verify>')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
