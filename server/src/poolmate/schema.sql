-- Active: 1784870464694@@129.226.91.246@31268@zeabur@public
-- PoolMate group-purchase tables (tenant-agnostic data, no KaleidoX semantics)

CREATE TABLE IF NOT EXISTS poolmate_sessions (
  id           TEXT        PRIMARY KEY,
  chat_id      BIGINT      NOT NULL,
  creator_id   BIGINT      NOT NULL,
  creator_name TEXT        NOT NULL,
  product      TEXT        NOT NULL,
  price_each   NUMERIC(10,2) NOT NULL,
  slots_total  INT         NOT NULL DEFAULT 3,
  slots_filled INT         NOT NULL DEFAULT 0,
  status       TEXT        NOT NULL DEFAULT 'collecting',
  -- collecting | funded | ordering | completed | cancelled
  merchant_order_id TEXT,
  tx_hash      TEXT,
  message_id   BIGINT,                -- the pinned card message to edit
  deadline     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS poolmate_members (
  id           SERIAL      PRIMARY KEY,
  session_id   TEXT        NOT NULL REFERENCES poolmate_sessions(id) ON DELETE CASCADE,
  user_id      BIGINT      NOT NULL,
  username     TEXT        NOT NULL,
  slots        INT         NOT NULL DEFAULT 1,
  amount       NUMERIC(10,2) NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending',  -- pending | paid | refunded
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS poolmate_sessions_chat_idx ON poolmate_sessions (chat_id);
