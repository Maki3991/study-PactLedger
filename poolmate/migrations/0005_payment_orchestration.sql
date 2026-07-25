CREATE TABLE pm_payment_projections (
  payment_request_id TEXT PRIMARY KEY REFERENCES pm_payment_requests(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'READY', 'UNAVAILABLE', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN',
    'FAILED', 'CONFIRMED', 'DEMO_CONFIRMED'
  )),
  settlement_mode TEXT NOT NULL CHECK (settlement_mode IN (
    'disabled', 'mock', 'testnet', 'live'
  )),
  error_code TEXT,
  error_message TEXT,
  receipt_id TEXT,
  transaction_hash TEXT,
  explorer_url TEXT,
  confirmed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    status <> 'CONFIRMED' OR (
      settlement_mode IN ('testnet', 'live')
      AND receipt_id IS NOT NULL AND length(trim(receipt_id)) > 0
      AND transaction_hash IS NOT NULL AND length(trim(transaction_hash)) > 0
      AND explorer_url LIKE 'https://%'
      AND confirmed_at IS NOT NULL
    )
  ),
  CHECK (status <> 'DEMO_CONFIRMED' OR settlement_mode = 'mock')
);

CREATE INDEX pm_payment_projections_status_updated_idx
  ON pm_payment_projections(status, updated_at DESC);

CREATE TABLE pm_outbox (
  id TEXT PRIMARY KEY,
  payment_request_id TEXT NOT NULL UNIQUE REFERENCES pm_payment_requests(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'processing', 'completed', 'blocked', 'unknown'
  )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX pm_outbox_status_available_idx
  ON pm_outbox(status, available_at);

-- Backfill P1 requests without changing their stable payment idempotency key.
INSERT INTO pm_payment_projections (
  payment_request_id, operation_id, status, settlement_mode, error_code,
  attempts, created_at, updated_at
)
SELECT
  id,
  'pmop_' || idempotency_key,
  CASE status
    WHEN 'submitting' THEN 'SUBMITTING'
    WHEN 'submitted' THEN 'UNKNOWN'
    WHEN 'failed' THEN 'FAILED'
    WHEN 'unknown' THEN 'UNKNOWN'
    WHEN 'confirmed' THEN 'UNKNOWN'
    WHEN 'demo_confirmed' THEN 'UNKNOWN'
    ELSE 'READY'
  END,
  'disabled',
  CASE
    WHEN status = 'failed' THEN 'LEGACY_PAYMENT_FAILED'
    WHEN status = 'submitted' THEN 'PAYMENT_OPERATION_UNKNOWN'
    WHEN status IN ('confirmed', 'demo_confirmed')
      THEN 'LEGACY_PAYMENT_EVIDENCE_UNAVAILABLE'
    ELSE NULL
  END,
  0,
  created_at,
  updated_at
FROM pm_payment_requests;

INSERT INTO pm_outbox (
  id, payment_request_id, operation_id, status, attempts, last_error_code,
  available_at, created_at, updated_at
)
SELECT
  'pmob_' || id,
  id,
  'pmop_' || idempotency_key,
  CASE status
    WHEN 'ready' THEN 'pending'
    WHEN 'submitting' THEN 'processing'
    WHEN 'unknown' THEN 'unknown'
    WHEN 'confirmed' THEN 'unknown'
    WHEN 'demo_confirmed' THEN 'unknown'
    WHEN 'failed' THEN 'blocked'
    ELSE 'unknown'
  END,
  0,
  CASE
    WHEN status = 'failed' THEN 'LEGACY_PAYMENT_FAILED'
    WHEN status IN ('confirmed', 'demo_confirmed')
      THEN 'LEGACY_PAYMENT_EVIDENCE_UNAVAILABLE'
    ELSE NULL
  END,
  created_at,
  created_at,
  updated_at
FROM pm_payment_requests;

UPDATE pm_payment_requests
SET status = 'unknown', updated_at = CURRENT_TIMESTAMP
WHERE status IN ('confirmed', 'demo_confirmed', 'submitted');

UPDATE pm_orders
SET state = 'PAYMENT_UNKNOWN', updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT order_id FROM pm_payment_requests WHERE status = 'unknown'
)
  AND state IN ('PAID', 'DEMO_CONFIRMED', 'PAYMENT_SUBMITTED');
