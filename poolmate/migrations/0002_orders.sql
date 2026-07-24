CREATE TABLE pm_groups (
  id TEXT PRIMARY KEY,
  telegram_chat_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pm_orders (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES pm_groups(id),
  owner_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'DRAFT', 'COLLECTING', 'QUOTE_PENDING', 'CONFIRMATION_PENDING',
    'READY_FOR_PAYMENT', 'PAYMENT_SUBMITTED', 'PAID', 'DEMO_CONFIRMED',
    'PAYMENT_FAILED', 'PAYMENT_UNKNOWN'
  )),
  funding_mode TEXT NOT NULL CHECK (funding_mode IN ('sponsored_demo', 'prefunded_participants')),
  target_units INTEGER NOT NULL CHECK (target_units > 0),
  source_idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX pm_orders_group_created_idx ON pm_orders(group_id, created_at DESC);
CREATE INDEX pm_orders_state_updated_idx ON pm_orders(state, updated_at DESC);

CREATE TABLE pm_participants (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pm_orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0),
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_id, user_id)
);

CREATE INDEX pm_participants_order_idx ON pm_participants(order_id, joined_at);

CREATE TABLE pm_checkout_snapshots (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pm_orders(id),
  version INTEGER NOT NULL CHECK (version > 0),
  hash TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL,
  merchant_display_name TEXT NOT NULL,
  payee_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  total_amount_atomic TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  quote_reference TEXT NOT NULL,
  source_idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(order_id, version)
);

CREATE INDEX pm_checkout_order_version_idx ON pm_checkout_snapshots(order_id, version DESC);

CREATE TABLE pm_allocations (
  id TEXT PRIMARY KEY,
  checkout_id TEXT NOT NULL REFERENCES pm_checkout_snapshots(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES pm_participants(id),
  asset_id TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(checkout_id, participant_id)
);

CREATE TABLE pm_user_confirmations (
  id TEXT PRIMARY KEY,
  checkout_id TEXT NOT NULL REFERENCES pm_checkout_snapshots(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES pm_participants(id),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'superseded', 'expired')),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(checkout_id, participant_id)
);

CREATE INDEX pm_confirmations_checkout_status_idx ON pm_user_confirmations(checkout_id, status);

CREATE TABLE pm_confirmation_sets (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pm_orders(id),
  checkout_id TEXT NOT NULL UNIQUE REFERENCES pm_checkout_snapshots(id),
  created_at TEXT NOT NULL
);

CREATE TABLE pm_payment_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES pm_orders(id),
  checkout_id TEXT NOT NULL UNIQUE REFERENCES pm_checkout_snapshots(id),
  checkout_version INTEGER NOT NULL,
  checkout_hash TEXT NOT NULL,
  confirmation_set_id TEXT NOT NULL UNIQUE REFERENCES pm_confirmation_sets(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  payer_ref TEXT NOT NULL,
  payee_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'ready', 'submitting', 'submitted', 'confirmed', 'demo_confirmed',
    'failed', 'unknown'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX pm_payment_requests_status_created_idx ON pm_payment_requests(status, created_at);
