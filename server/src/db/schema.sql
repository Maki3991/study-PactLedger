-- KaleidoX database schema
-- Run via: npm run migrate

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT        PRIMARY KEY,
  mission_id    TEXT        NOT NULL,
  objective     TEXT        NOT NULL,
  phase         TEXT        NOT NULL DEFAULT 'created',
  budget_usdt   NUMERIC     NOT NULL DEFAULT 1000,
  max_loss_pct  NUMERIC     NOT NULL DEFAULT 5,
  max_asset_pct NUMERIC     NOT NULL DEFAULT 30,
  asset         TEXT        NOT NULL DEFAULT 'ETH',
  exec_state    TEXT        NOT NULL DEFAULT 'ready',
  tx_hash       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id        TEXT NOT NULL,
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'waiting',
  detail    TEXT NOT NULL DEFAULT '',
  elapsed   TEXT NOT NULL DEFAULT '--:--',
  PRIMARY KEY (id, task_id)
);

CREATE TABLE IF NOT EXISTS strategy_candidates (
  id           TEXT    NOT NULL,
  task_id      TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'testing',
  note         TEXT    NOT NULL DEFAULT '',
  return_pct   NUMERIC NOT NULL DEFAULT 0,
  drawdown_pct NUMERIC NOT NULL DEFAULT 0,
  sharpe       NUMERIC NOT NULL DEFAULT 0,
  signal       TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (id, task_id)
);

CREATE TABLE IF NOT EXISTS firewall_rules (
  id       SERIAL  PRIMARY KEY,
  task_id  TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label    TEXT    NOT NULL,
  lim      TEXT    NOT NULL,
  current  TEXT    NOT NULL,
  state    TEXT    NOT NULL DEFAULT 'pass'
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id         SERIAL      PRIMARY KEY,
  task_id    TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  time_label TEXT        NOT NULL,
  title      TEXT        NOT NULL,
  detail     TEXT        NOT NULL DEFAULT '',
  tone       TEXT        NOT NULL DEFAULT 'neutral',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
