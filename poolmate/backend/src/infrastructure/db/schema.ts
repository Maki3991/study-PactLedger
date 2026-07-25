import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const migrations = sqliteTable("pm_migrations", {
  filename: text("filename").primaryKey(),
  checksum: text("checksum").notNull(),
  appliedAt: text("applied_at").notNull()
});

export const systemMeta = sqliteTable("pm_system_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const groups = sqliteTable("pm_groups", {
  id: text("id").primaryKey(),
  telegramChatId: text("telegram_chat_id").notNull().unique(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const orders = sqliteTable(
  "pm_orders",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    ownerUserId: text("owner_user_id").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    fundingMode: text("funding_mode").notNull(),
    targetUnits: integer("target_units").notNull(),
    sourceIdempotencyKey: text("source_idempotency_key").unique(),
    requestHash: text("request_hash"),
    terminalState: text("terminal_state"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("pm_orders_group_created_idx").on(table.groupId, table.createdAt),
    index("pm_orders_state_updated_idx").on(table.state, table.updatedAt)
  ]
);

export const orderCancellations = sqliteTable("pm_order_cancellations", {
  orderId: text("order_id")
    .primaryKey()
    .references(() => orders.id),
  idempotencyKey: text("idempotency_key").unique(),
  requestHash: text("request_hash").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  createdAt: text("created_at").notNull()
});

export const participants = sqliteTable(
  "pm_participants",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    displayName: text("display_name").notNull(),
    units: integer("units").notNull(),
    joinedAt: text("joined_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("pm_participants_order_user_idx").on(
      table.orderId,
      table.userId
    ),
    index("pm_participants_order_idx").on(table.orderId, table.joinedAt)
  ]
);

export const checkoutSnapshots = sqliteTable(
  "pm_checkout_snapshots",
  {
    id: text("id").primaryKey(),
    checkoutId: text("checkout_id").notNull(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    version: integer("version").notNull(),
    hash: text("hash").notNull().unique(),
    merchantId: text("merchant_id").notNull(),
    merchantDisplayName: text("merchant_display_name").notNull(),
    payeeId: text("payee_id").notNull(),
    assetId: text("asset_id").notNull(),
    totalAmountAtomic: text("total_amount_atomic").notNull(),
    expiresAt: text("expires_at").notNull(),
    quoteReference: text("quote_reference").notNull(),
    sourceIdempotencyKey: text("source_idempotency_key").unique(),
    createdAt: text("created_at").notNull(),
    hashAlgorithm: text("hash_algorithm").notNull(),
    canonicalizationVersion: text("canonicalization_version").notNull(),
    isCanonical: integer("is_canonical", { mode: "boolean" }).notNull(),
    itemsJson: text("items_json").notNull(),
    goodsAmountAtomic: text("goods_amount_atomic").notNull(),
    shippingAmountAtomic: text("shipping_amount_atomic").notNull(),
    discountAmountAtomic: text("discount_amount_atomic").notNull(),
    feeAmountAtomic: text("fee_amount_atomic").notNull(),
    requestHash: text("request_hash"),
    sourceProtocol: text("source_protocol").notNull()
  },
  (table) => [
    uniqueIndex("pm_checkout_order_version_unique_idx").on(
      table.orderId,
      table.version
    ),
    uniqueIndex("pm_checkout_identity_version_idx").on(
      table.checkoutId,
      table.version
    ),
    index("pm_checkout_order_version_idx").on(table.orderId, table.version)
  ]
);

export const allocations = sqliteTable(
  "pm_allocations",
  {
    id: text("id").primaryKey(),
    checkoutId: text("checkout_id")
      .notNull()
      .references(() => checkoutSnapshots.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    assetId: text("asset_id").notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    strategy: text("strategy").notNull(),
    status: text("status").notNull(),
    goodsAmountAtomic: text("goods_amount_atomic").notNull(),
    shippingAmountAtomic: text("shipping_amount_atomic").notNull(),
    discountAmountAtomic: text("discount_amount_atomic").notNull(),
    feeAmountAtomic: text("fee_amount_atomic").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("pm_allocations_checkout_participant_idx").on(
      table.checkoutId,
      table.participantId
    )
  ]
);

export const userConfirmations = sqliteTable(
  "pm_user_confirmations",
  {
    id: text("id").primaryKey(),
    checkoutId: text("checkout_id")
      .notNull()
      .references(() => checkoutSnapshots.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull(),
    actedByUserId: text("acted_by_user_id"),
    confirmedAt: text("confirmed_at"),
    declinedAt: text("declined_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("pm_confirmations_checkout_participant_idx").on(
      table.checkoutId,
      table.participantId
    ),
    index("pm_confirmations_checkout_status_idx").on(
      table.checkoutId,
      table.status
    )
  ]
);

export const confirmationSets = sqliteTable("pm_confirmation_sets", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  checkoutId: text("checkout_id")
    .notNull()
    .unique()
    .references(() => checkoutSnapshots.id),
  createdAt: text("created_at").notNull()
});

export const paymentRequests = sqliteTable(
  "pm_payment_requests",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    checkoutId: text("checkout_id")
      .notNull()
      .unique()
      .references(() => checkoutSnapshots.id),
    checkoutVersion: integer("checkout_version").notNull(),
    checkoutHash: text("checkout_hash").notNull(),
    confirmationSetId: text("confirmation_set_id")
      .notNull()
      .unique()
      .references(() => confirmationSets.id),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    payerRef: text("payer_ref").notNull(),
    payeeId: text("payee_id").notNull(),
    assetId: text("asset_id").notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    expiresAt: text("expires_at").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("pm_payment_requests_status_created_idx").on(
      table.status,
      table.createdAt
    )
  ]
);

export const operationIdempotency = sqliteTable(
  "pm_operation_idempotency",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    operation: text("operation").notNull(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    actorUserId: text("actor_user_id").notNull(),
    requestHash: text("request_hash").notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("pm_operation_idempotency_order_idx").on(
      table.orderId,
      table.createdAt
    )
  ]
);

export const paymentProjections = sqliteTable(
  "pm_payment_projections",
  {
    paymentRequestId: text("payment_request_id")
      .primaryKey()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    operationId: text("operation_id").notNull().unique(),
    status: text("status").notNull(),
    settlementMode: text("settlement_mode").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    receiptId: text("receipt_id"),
    transactionHash: text("transaction_hash"),
    explorerUrl: text("explorer_url"),
    confirmedAt: text("confirmed_at"),
    attempts: integer("attempts").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("pm_payment_projections_status_updated_idx").on(
      table.status,
      table.updatedAt
    )
  ]
);

export const outbox = sqliteTable(
  "pm_outbox",
  {
    id: text("id").primaryKey(),
    paymentRequestId: text("payment_request_id")
      .notNull()
      .unique()
      .references(() => paymentRequests.id, { onDelete: "cascade" }),
    operationId: text("operation_id").notNull().unique(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull(),
    lastErrorCode: text("last_error_code"),
    availableAt: text("available_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("pm_outbox_status_available_idx").on(table.status, table.availableAt)
  ]
);

export const mockPaymentOperations = sqliteTable("pm_mock_payment_operations", {
  operationId: text("operation_id").primaryKey(),
  paymentRequestId: text("payment_request_id")
    .notNull()
    .unique()
    .references(() => paymentRequests.id),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  requestHash: text("request_hash").notNull(),
  requestJson: text("request_json").notNull(),
  state: text("state").notNull(),
  createdAt: text("created_at").notNull()
});

export const mockPolicyDecisions = sqliteTable("pm_mock_policy_decisions", {
  id: text("id").primaryKey(),
  operationId: text("operation_id")
    .notNull()
    .unique()
    .references(() => mockPaymentOperations.operationId),
  outcome: text("outcome").notNull(),
  code: text("code").notNull(),
  reason: text("reason").notNull(),
  checksJson: text("checks_json").notNull(),
  evaluatedAt: text("evaluated_at").notNull()
});

export const mockSettlementReceipts = sqliteTable(
  "pm_mock_settlement_receipts",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .unique()
      .references(() => mockPaymentOperations.operationId),
    status: text("status").notNull(),
    transactionHash: text("transaction_hash").notNull(),
    explorerUrl: text("explorer_url").notNull(),
    confirmedAt: text("confirmed_at").notNull(),
    createdAt: text("created_at").notNull()
  }
);

export const schema = {
  migrations,
  systemMeta,
  groups,
  orders,
  orderCancellations,
  participants,
  checkoutSnapshots,
  allocations,
  userConfirmations,
  confirmationSets,
  paymentRequests,
  operationIdempotency,
  paymentProjections,
  outbox,
  mockPaymentOperations,
  mockPolicyDecisions,
  mockSettlementReceipts
};
