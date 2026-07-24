import { Router } from 'express'

export const poolmateRouter = Router()

// GET /api/poolmate/bot-status – ping Telegram API to verify token + polling
poolmateRouter.get('/bot-status', async (_req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    res.json({ ok: false, reason: 'TELEGRAM_BOT_TOKEN not set' })
    return
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(5_000),
    })
    const data = await r.json() as { ok: boolean; result?: { username: string; first_name: string } }
    if (!data.ok) { res.json({ ok: false, reason: 'Telegram rejected token' }); return }
    res.json({
      ok: true,
      username: data.result?.username,
      firstName: data.result?.first_name,
      inviteUrl: `https://t.me/${data.result?.username}`,
    })
  } catch (err) {
    res.json({ ok: false, reason: err instanceof Error ? err.message : 'network error' })
  }
})
