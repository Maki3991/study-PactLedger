-- Agent Treasury schema (tenant-agnostic infrastructure layer)
-- Append to existing schema; run via: npm run migrate

-- ── treasury accounts ──────────────────────────────────────────────────────
-- One wallet per agent per tenant task. Balance is in USDT (6 decimal places).
CREATE TABLE IF NOT EXISTS treasury_accounts (
  id          TEXT         PRIMARY KEY,          -- "{tenant_id}:{agent_id}"
  tenant_id   TEXT         NOT NULL,             -- task/session identifier
  agent_id    TEXT         NOT NULL,
  agent_name  TEXT         NOT NULL,
  balance     NUMERIC(20,6) NOT NULL DEFAULT 0,
  allocated   NUMERIC(20,6) NOT NULL DEFAULT 0,  -- initial allocation from orchestrator
  spent       NUMERIC(20,6) NOT NULL DEFAULT 0,
  earned      NUMERIC(20,6) NOT NULL DEFAULT 0,
  currency    TEXT         NOT NULL DEFAULT 'USDT',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, agent_id)
);

-- ── spending policies ───────────────────────────────────────────────────────
-- Rules enforced BEFORE any transfer leaves an agent wallet.
CREATE TABLE IF NOT EXISTS spending_policies (
  id              SERIAL       PRIMARY KEY,
  tenant_id       TEXT         NOT NULL,
  agent_id        TEXT         NOT NULL,
  max_single      NUMERIC(20,6) NOT NULL DEFAULT 100,   -- max USDT per single tx
  daily_limit     NUMERIC(20,6) NOT NULL DEFAULT 500,   -- max USDT per calendar day
  whitelist       JSONB        NOT NULL DEFAULT '[]',   -- allowed to_agent IDs ([] = any)
  asset_whitelist JSONB        NOT NULL DEFAULT '["ETH","USDT"]',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, agent_id)
);

-- ── transaction ledger ──────────────────────────────────────────────────────
-- Append-only audit trail; never updated, only inserted.
CREATE TABLE IF NOT EXISTS treasury_txs (
  id            TEXT         PRIMARY KEY,
  tenant_id     TEXT         NOT NULL,
  from_agent    TEXT,                               -- NULL = user deposit
  to_agent      TEXT,                               -- NULL = user withdrawal
  amount        NUMERIC(20,6) NOT NULL,
  currency      TEXT         NOT NULL DEFAULT 'USDT',
  purpose       TEXT         NOT NULL,
  protocol      TEXT         NOT NULL DEFAULT 'internal',  -- internal|x402|acp|ap2
  status        TEXT         NOT NULL DEFAULT 'completed', -- completed|rejected
  reject_reason TEXT,
  inj_tx_hash   TEXT,                               -- Injective settlement hash
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS treasury_txs_tenant_idx ON treasury_txs (tenant_id);
CREATE INDEX IF NOT EXISTS treasury_txs_from_idx   ON treasury_txs (from_agent);
