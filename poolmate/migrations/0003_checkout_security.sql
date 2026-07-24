ALTER TABLE pm_checkout_snapshots
  ADD COLUMN hash_algorithm TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK (hash_algorithm IN ('LEGACY', 'SHA-256'));

ALTER TABLE pm_checkout_snapshots
  ADD COLUMN canonicalization_version TEXT NOT NULL DEFAULT 'legacy-unversioned'
  CHECK (canonicalization_version IN ('legacy-unversioned', 'poolmate-checkout-json-v1'));

ALTER TABLE pm_checkout_snapshots
  ADD COLUMN is_canonical INTEGER NOT NULL DEFAULT 0
  CHECK (is_canonical IN (0, 1));

ALTER TABLE pm_checkout_snapshots
  ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE pm_checkout_snapshots
  ADD COLUMN goods_amount_atomic TEXT NOT NULL DEFAULT '0';

ALTER TABLE pm_checkout_snapshots
  ADD COLUMN shipping_amount_atomic TEXT NOT NULL DEFAULT '0';

ALTER TABLE pm_checkout_snapshots
  ADD COLUMN discount_amount_atomic TEXT NOT NULL DEFAULT '0';

ALTER TABLE pm_checkout_snapshots
  ADD COLUMN fee_amount_atomic TEXT NOT NULL DEFAULT '0';

UPDATE pm_checkout_snapshots
SET goods_amount_atomic = total_amount_atomic
WHERE goods_amount_atomic = '0' AND total_amount_atomic <> '0';

DROP INDEX pm_confirmations_checkout_status_idx;

CREATE TABLE pm_user_confirmations_v2 (
  id TEXT PRIMARY KEY,
  checkout_id TEXT NOT NULL REFERENCES pm_checkout_snapshots(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES pm_participants(id),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'confirmed', 'declined', 'superseded', 'expired'
  )),
  acted_by_user_id TEXT,
  confirmed_at TEXT,
  declined_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(checkout_id, participant_id)
);

INSERT INTO pm_user_confirmations_v2 (
  id, checkout_id, participant_id, token_hash, status, confirmed_at,
  created_at, updated_at
)
SELECT
  id, checkout_id, participant_id, 'legacy-invalidated:' || id, 'superseded', confirmed_at,
  created_at, updated_at
FROM pm_user_confirmations;

DROP TABLE pm_user_confirmations;
ALTER TABLE pm_user_confirmations_v2 RENAME TO pm_user_confirmations;

CREATE INDEX pm_confirmations_checkout_status_idx
  ON pm_user_confirmations(checkout_id, status);

-- Legacy checkout hashes do not bind the itemized v1 contract. Re-quote them.
UPDATE pm_orders
SET state = 'QUOTE_PENDING', updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT order_id FROM pm_checkout_snapshots)
  AND state IN ('CONFIRMATION_PENDING', 'READY_FOR_PAYMENT');

UPDATE pm_checkout_snapshots
SET source_idempotency_key = NULL
WHERE is_canonical = 0;

UPDATE pm_payment_requests
SET status = 'failed', updated_at = CURRENT_TIMESTAMP
WHERE checkout_id IN (
  SELECT id FROM pm_checkout_snapshots WHERE is_canonical = 0
)
  AND status IN ('ready', 'submitting');

CREATE TABLE pm_operation_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('claim', 'leave', 'remind')),
  order_id TEXT NOT NULL REFERENCES pm_orders(id),
  actor_user_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX pm_operation_idempotency_order_idx
  ON pm_operation_idempotency(order_id, created_at);
