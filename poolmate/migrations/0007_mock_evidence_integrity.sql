-- Quarantine legacy Demo projections that cannot satisfy the persisted Mock evidence contract.
UPDATE pm_orders
SET state = 'PAYMENT_UNKNOWN', updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT r.order_id
  FROM pm_payment_requests r
  JOIN pm_payment_projections p ON p.payment_request_id = r.id
  WHERE p.status = 'DEMO_CONFIRMED' AND (
    p.settlement_mode <> 'mock'
    OR p.receipt_id IS NULL OR length(trim(p.receipt_id)) = 0
    OR coalesce(p.transaction_hash, '') <> ''
    OR coalesce(p.explorer_url, '') <> ''
    OR p.confirmed_at IS NULL
  )
);

UPDATE pm_payment_requests
SET status = 'unknown', updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT payment_request_id
  FROM pm_payment_projections
  WHERE status = 'DEMO_CONFIRMED' AND (
    settlement_mode <> 'mock'
    OR receipt_id IS NULL OR length(trim(receipt_id)) = 0
    OR coalesce(transaction_hash, '') <> ''
    OR coalesce(explorer_url, '') <> ''
    OR confirmed_at IS NULL
  )
);

UPDATE pm_outbox
SET status = 'unknown', last_error_code = 'LEGACY_MOCK_EVIDENCE_INVALID',
    available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE payment_request_id IN (
  SELECT payment_request_id
  FROM pm_payment_projections
  WHERE status = 'DEMO_CONFIRMED' AND (
    settlement_mode <> 'mock'
    OR receipt_id IS NULL OR length(trim(receipt_id)) = 0
    OR coalesce(transaction_hash, '') <> ''
    OR coalesce(explorer_url, '') <> ''
    OR confirmed_at IS NULL
  )
);

UPDATE pm_payment_projections
SET status = 'UNKNOWN', error_code = 'LEGACY_MOCK_EVIDENCE_INVALID',
    error_message = 'Legacy Mock evidence was incomplete or claimed chain fields.',
    receipt_id = NULL, transaction_hash = NULL, explorer_url = NULL,
    confirmed_at = NULL, updated_at = CURRENT_TIMESTAMP
WHERE status = 'DEMO_CONFIRMED' AND (
  settlement_mode <> 'mock'
  OR receipt_id IS NULL OR length(trim(receipt_id)) = 0
  OR coalesce(transaction_hash, '') <> ''
  OR coalesce(explorer_url, '') <> ''
  OR confirmed_at IS NULL
);

CREATE TRIGGER pm_mock_policy_decisions_state_insert
BEFORE INSERT ON pm_mock_policy_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM pm_mock_payment_operations o
  WHERE o.operation_id = NEW.operation_id
    AND ((o.state = 'DEMO_CONFIRMED' AND NEW.outcome = 'approved')
      OR (o.state = 'POLICY_REJECTED' AND NEW.outcome = 'rejected'))
)
BEGIN
  SELECT RAISE(ABORT, 'Mock policy decision does not match operation state');
END;

CREATE TRIGGER pm_mock_settlement_receipts_state_insert
BEFORE INSERT ON pm_mock_settlement_receipts
WHEN NOT EXISTS (
  SELECT 1
  FROM pm_mock_payment_operations o
  JOIN pm_mock_policy_decisions d ON d.operation_id = o.operation_id
  WHERE o.operation_id = NEW.operation_id
    AND o.state = 'DEMO_CONFIRMED'
    AND d.outcome = 'approved'
)
BEGIN
  SELECT RAISE(ABORT, 'Mock receipt requires an approved operation');
END;

CREATE TRIGGER pm_payment_projections_mock_trace_insert
BEFORE INSERT ON pm_payment_projections
WHEN NEW.status = 'DEMO_CONFIRMED' AND NOT EXISTS (
  SELECT 1
  FROM pm_mock_payment_operations o
  JOIN pm_mock_policy_decisions d ON d.operation_id = o.operation_id
  JOIN pm_mock_settlement_receipts r ON r.operation_id = o.operation_id
  WHERE o.operation_id = NEW.operation_id
    AND o.payment_request_id = NEW.payment_request_id
    AND o.state = 'DEMO_CONFIRMED'
    AND d.outcome = 'approved'
    AND r.id = NEW.receipt_id
)
BEGIN
  SELECT RAISE(ABORT, 'Mock projection requires its persisted evidence trace');
END;

CREATE TRIGGER pm_payment_projections_mock_trace_update
BEFORE UPDATE ON pm_payment_projections
WHEN NEW.status = 'DEMO_CONFIRMED' AND NOT EXISTS (
  SELECT 1
  FROM pm_mock_payment_operations o
  JOIN pm_mock_policy_decisions d ON d.operation_id = o.operation_id
  JOIN pm_mock_settlement_receipts r ON r.operation_id = o.operation_id
  WHERE o.operation_id = NEW.operation_id
    AND o.payment_request_id = NEW.payment_request_id
    AND o.state = 'DEMO_CONFIRMED'
    AND d.outcome = 'approved'
    AND r.id = NEW.receipt_id
)
BEGIN
  SELECT RAISE(ABORT, 'Mock projection requires its persisted evidence trace');
END;
