CREATE TABLE pm_mock_payment_operations (
  operation_id TEXT PRIMARY KEY,
  payment_request_id TEXT NOT NULL UNIQUE REFERENCES pm_payment_requests(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('POLICY_REJECTED', 'DEMO_CONFIRMED')),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX pm_mock_payment_operations_request_idx
  ON pm_mock_payment_operations(payment_request_id);

CREATE TABLE pm_mock_policy_decisions (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES pm_mock_payment_operations(operation_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  code TEXT NOT NULL,
  reason TEXT NOT NULL,
  checks_json TEXT NOT NULL CHECK (json_valid(checks_json)),
  evaluated_at TEXT NOT NULL
);

CREATE TABLE pm_mock_settlement_receipts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES pm_mock_payment_operations(operation_id),
  status TEXT NOT NULL CHECK (status = 'DEMO_CONFIRMED'),
  transaction_hash TEXT NOT NULL DEFAULT '' CHECK (transaction_hash = ''),
  explorer_url TEXT NOT NULL DEFAULT '' CHECK (explorer_url = ''),
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER pm_mock_payment_operations_no_update
BEFORE UPDATE ON pm_mock_payment_operations
BEGIN
  SELECT RAISE(ABORT, 'Mock payment operations are append-only');
END;

CREATE TRIGGER pm_mock_payment_operations_no_delete
BEFORE DELETE ON pm_mock_payment_operations
BEGIN
  SELECT RAISE(ABORT, 'Mock payment operations are append-only');
END;

CREATE TRIGGER pm_mock_policy_decisions_no_update
BEFORE UPDATE ON pm_mock_policy_decisions
BEGIN
  SELECT RAISE(ABORT, 'Mock policy decisions are append-only');
END;

CREATE TRIGGER pm_mock_policy_decisions_no_delete
BEFORE DELETE ON pm_mock_policy_decisions
BEGIN
  SELECT RAISE(ABORT, 'Mock policy decisions are append-only');
END;

CREATE TRIGGER pm_mock_settlement_receipts_no_update
BEFORE UPDATE ON pm_mock_settlement_receipts
BEGIN
  SELECT RAISE(ABORT, 'Mock settlement receipts are append-only');
END;

CREATE TRIGGER pm_mock_settlement_receipts_no_delete
BEFORE DELETE ON pm_mock_settlement_receipts
BEGIN
  SELECT RAISE(ABORT, 'Mock settlement receipts are append-only');
END;

CREATE TRIGGER pm_payment_projections_mock_evidence_insert
BEFORE INSERT ON pm_payment_projections
WHEN NEW.status = 'DEMO_CONFIRMED' AND NOT (
  NEW.settlement_mode = 'mock'
  AND NEW.receipt_id IS NOT NULL AND length(trim(NEW.receipt_id)) > 0
  AND coalesce(NEW.transaction_hash, '') = ''
  AND coalesce(NEW.explorer_url, '') = ''
  AND NEW.confirmed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Mock confirmation evidence is incomplete');
END;

CREATE TRIGGER pm_payment_projections_mock_evidence_update
BEFORE UPDATE ON pm_payment_projections
WHEN NEW.status = 'DEMO_CONFIRMED' AND NOT (
  NEW.settlement_mode = 'mock'
  AND NEW.receipt_id IS NOT NULL AND length(trim(NEW.receipt_id)) > 0
  AND coalesce(NEW.transaction_hash, '') = ''
  AND coalesce(NEW.explorer_url, '') = ''
  AND NEW.confirmed_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Mock confirmation evidence is incomplete');
END;
