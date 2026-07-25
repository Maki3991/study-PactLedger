ALTER TABLE pm_orders
  ADD COLUMN terminal_state TEXT
  CHECK (terminal_state IS NULL OR terminal_state = 'CANCELED');

CREATE TABLE pm_order_cancellations (
  order_id TEXT PRIMARY KEY REFERENCES pm_orders(id),
  idempotency_key TEXT UNIQUE,
  request_hash TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('telegram_owner', 'admin')),
  actor_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('owner_requested', 'admin_requested')),
  created_at TEXT NOT NULL
);

CREATE TRIGGER pm_order_cancellations_no_update
BEFORE UPDATE ON pm_order_cancellations
BEGIN
  SELECT RAISE(ABORT, 'Order cancellations are append-only');
END;

CREATE TRIGGER pm_order_cancellations_no_delete
BEFORE DELETE ON pm_order_cancellations
BEGIN
  SELECT RAISE(ABORT, 'Order cancellations are append-only');
END;
