ALTER TABLE pm_checkout_snapshots
  ADD COLUMN checkout_id TEXT NOT NULL DEFAULT '';

ALTER TABLE pm_checkout_snapshots
  ADD COLUMN source_protocol TEXT NOT NULL DEFAULT 'MOCK'
  CHECK (source_protocol IN ('A2A', 'MOCK'));

UPDATE pm_checkout_snapshots SET checkout_id = id WHERE checkout_id = '';

CREATE UNIQUE INDEX pm_checkout_identity_version_idx
  ON pm_checkout_snapshots(checkout_id, version);

ALTER TABLE pm_allocations
  ADD COLUMN strategy TEXT NOT NULL DEFAULT 'BY_QUANTITY'
  CHECK (strategy IN ('BY_QUANTITY', 'EQUAL_SPLIT'));

ALTER TABLE pm_allocations
  ADD COLUMN status TEXT NOT NULL DEFAULT 'INVALIDATED'
  CHECK (status IN (
    'CALCULATED', 'CONFIRMATION_PENDING', 'CONFIRMED',
    'CAPTURED', 'FAILED', 'INVALIDATED'
  ));

ALTER TABLE pm_allocations
  ADD COLUMN goods_amount_atomic TEXT NOT NULL DEFAULT '0';

ALTER TABLE pm_allocations
  ADD COLUMN shipping_amount_atomic TEXT NOT NULL DEFAULT '0';

ALTER TABLE pm_allocations
  ADD COLUMN discount_amount_atomic TEXT NOT NULL DEFAULT '0';

ALTER TABLE pm_allocations
  ADD COLUMN fee_amount_atomic TEXT NOT NULL DEFAULT '0';

-- Existing hashes included allocation facts and are not canonical merchant checkouts.
UPDATE pm_user_confirmations
SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
WHERE checkout_id IN (
  SELECT id FROM pm_checkout_snapshots WHERE is_canonical = 1
)
  AND status IN ('pending', 'confirmed', 'declined');

UPDATE pm_allocations
SET status = 'INVALIDATED'
WHERE checkout_id IN (
  SELECT id FROM pm_checkout_snapshots WHERE is_canonical = 1
);

UPDATE pm_checkout_snapshots SET is_canonical = 0 WHERE is_canonical = 1;

UPDATE pm_orders
SET state = 'QUOTE_PENDING', updated_at = CURRENT_TIMESTAMP
WHERE terminal_state IS NULL
  AND state IN ('CONFIRMATION_PENDING', 'READY_FOR_PAYMENT');

UPDATE pm_payment_requests
SET status = 'failed', updated_at = CURRENT_TIMESTAMP
WHERE status = 'ready';

UPDATE pm_payment_projections
SET status = 'FAILED', error_code = 'CHECKOUT_REQUOTE_REQUIRED',
    error_message = 'The legacy checkout hash was not a canonical merchant checkout.',
    updated_at = CURRENT_TIMESTAMP
WHERE status IN ('READY', 'UNAVAILABLE');

UPDATE pm_outbox
SET status = 'completed', last_error_code = 'CHECKOUT_REQUOTE_REQUIRED',
    available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE status IN ('pending', 'blocked');
