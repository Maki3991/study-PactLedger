ALTER TABLE pm_orders
  ADD COLUMN request_hash TEXT;

ALTER TABLE pm_checkout_snapshots
  ADD COLUMN request_hash TEXT;
