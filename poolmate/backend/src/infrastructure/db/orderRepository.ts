import type Database from "better-sqlite3";
import type {
  CheckoutItemView,
  FundingMode,
  OrderDetailView,
  OrderState
} from "@poolmate/shared";
import type { PoolMateDatabase } from "./database.js";

export interface GroupRow {
  id: string;
  telegramChatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderRow {
  id: string;
  groupId: string;
  ownerUserId: string;
  title: string;
  state: OrderState;
  fundingMode: FundingMode;
  targetUnits: number;
  sourceIdempotencyKey: string | null;
  requestHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParticipantRow {
  id: string;
  orderId: string;
  userId: string;
  displayName: string;
  units: number;
  joinedAt: string;
  updatedAt: string;
}

export interface CheckoutRow {
  id: string;
  orderId: string;
  version: number;
  hash: string;
  merchantId: string;
  merchantDisplayName: string;
  payeeId: string;
  hashAlgorithm: "SHA-256";
  canonicalizationVersion: "poolmate-checkout-json-v1";
  isCanonical: boolean;
  items: CheckoutItemView[];
  assetId: string;
  goodsAmountAtomic: string;
  shippingAmountAtomic: string;
  discountAmountAtomic: string;
  feeAmountAtomic: string;
  totalAmountAtomic: string;
  expiresAt: string;
  quoteReference: string;
  sourceIdempotencyKey: string | null;
  requestHash: string | null;
  createdAt: string;
}

export interface AllocationRow {
  participantId: string;
  userId: string;
  displayName: string;
  units: number;
  assetId: string;
  amountAtomic: string;
  confirmationStatus:
    | "pending"
    | "confirmed"
    | "declined"
    | "superseded"
    | "expired";
  confirmedAt: string | null;
  declinedAt: string | null;
}

export interface PaymentRequestRow {
  id: string;
  orderId: string;
  checkoutId: string;
  checkoutVersion: number;
  checkoutHash: string;
  confirmationSetId: string;
  idempotencyKey: string;
  payerRef: string;
  payeeId: string;
  assetId: string;
  amountAtomic: string;
  expiresAt: string;
  status: "ready";
  createdAt: string;
}

export interface ConfirmationLookupRow extends CheckoutRow {
  confirmationId: string;
  participantId: string;
  participantUserId: string;
  participantDisplayName: string;
  participantUnits: number;
  orderTitle: string;
  orderState: OrderState;
  confirmationStatus: AllocationRow["confirmationStatus"];
  confirmedAt: string | null;
  declinedAt: string | null;
  allocationAmountAtomic: string;
}

export interface OperationIdempotencyRow {
  idempotencyKey: string;
  operation: "claim" | "leave" | "remind";
  orderId: string;
  actorUserId: string;
  requestHash: string;
  result: OrderDetailView;
  createdAt: string;
}

export interface PendingConfirmationRow {
  confirmationId: string;
  participantId: string;
  userId: string;
  displayName: string;
}

interface NewCheckout extends CheckoutRow {
  allocations: Array<{
    id: string;
    participantId: string;
    assetId: string;
    amountAtomic: string;
    confirmationId: string;
    tokenHash: string;
  }>;
}

interface NewPaymentRequest extends PaymentRequestRow {
  updatedAt: string;
}

function mapGroup(row: Record<string, unknown>): GroupRow {
  return {
    id: String(row.id),
    telegramChatId: String(row.telegram_chat_id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapOrder(row: Record<string, unknown>): OrderRow {
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    ownerUserId: String(row.owner_user_id),
    title: String(row.title),
    state: String(row.state) as OrderState,
    fundingMode: String(row.funding_mode) as FundingMode,
    targetUnits: Number(row.target_units),
    sourceIdempotencyKey:
      row.source_idempotency_key === null
        ? null
        : String(row.source_idempotency_key),
    requestHash: row.request_hash === null ? null : String(row.request_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapParticipant(row: Record<string, unknown>): ParticipantRow {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    userId: String(row.user_id),
    displayName: String(row.display_name),
    units: Number(row.units),
    joinedAt: String(row.joined_at),
    updatedAt: String(row.updated_at)
  };
}

function mapCheckout(row: Record<string, unknown>): CheckoutRow {
  const items = JSON.parse(String(row.items_json)) as CheckoutItemView[];
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    version: Number(row.version),
    hash: String(row.hash),
    merchantId: String(row.merchant_id),
    merchantDisplayName: String(row.merchant_display_name),
    payeeId: String(row.payee_id),
    hashAlgorithm: String(row.hash_algorithm) as "SHA-256",
    canonicalizationVersion: String(
      row.canonicalization_version
    ) as "poolmate-checkout-json-v1",
    isCanonical: Number(row.is_canonical) === 1,
    items,
    assetId: String(row.asset_id),
    goodsAmountAtomic: String(row.goods_amount_atomic),
    shippingAmountAtomic: String(row.shipping_amount_atomic),
    discountAmountAtomic: String(row.discount_amount_atomic),
    feeAmountAtomic: String(row.fee_amount_atomic),
    totalAmountAtomic: String(row.total_amount_atomic),
    expiresAt: String(row.expires_at),
    quoteReference: String(row.quote_reference),
    sourceIdempotencyKey:
      row.source_idempotency_key === null
        ? null
        : String(row.source_idempotency_key),
    requestHash: row.request_hash === null ? null : String(row.request_hash),
    createdAt: String(row.created_at)
  };
}

export class OrderTransaction {
  constructor(private readonly connection: Database.Database) {}

  upsertGroup(input: {
    id: string;
    telegramChatId: string;
    title: string;
    now: string;
  }): GroupRow {
    this.connection
      .prepare(
        `INSERT INTO pm_groups (id, telegram_chat_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(telegram_chat_id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`
      )
      .run(input.id, input.telegramChatId, input.title, input.now, input.now);
    return this.getGroupByChatId(input.telegramChatId)!;
  }

  getGroup(id: string): GroupRow | undefined {
    const row = this.connection
      .prepare("SELECT * FROM pm_groups WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapGroup(row) : undefined;
  }

  getGroupByChatId(telegramChatId: string): GroupRow | undefined {
    const row = this.connection
      .prepare("SELECT * FROM pm_groups WHERE telegram_chat_id = ?")
      .get(telegramChatId) as Record<string, unknown> | undefined;
    return row ? mapGroup(row) : undefined;
  }

  insertOrder(row: OrderRow): OrderRow {
    const result = this.connection
      .prepare(
        `INSERT OR IGNORE INTO pm_orders
         (id, group_id, owner_user_id, title, state, funding_mode, target_units,
          source_idempotency_key, request_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.groupId,
        row.ownerUserId,
        row.title,
        row.state,
        row.fundingMode,
        row.targetUnits,
        row.sourceIdempotencyKey,
        row.requestHash,
        row.createdAt,
        row.updatedAt
      );
    if (result.changes === 0 && row.sourceIdempotencyKey) {
      const existing = this.getOrderBySourceKey(row.sourceIdempotencyKey);
      if (existing) return existing;
    }
    return this.getOrder(row.id)!;
  }

  getOrder(id: string): OrderRow | undefined {
    const row = this.connection
      .prepare("SELECT * FROM pm_orders WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapOrder(row) : undefined;
  }

  getOrderBySourceKey(key: string): OrderRow | undefined {
    const row = this.connection
      .prepare("SELECT * FROM pm_orders WHERE source_idempotency_key = ?")
      .get(key) as Record<string, unknown> | undefined;
    return row ? mapOrder(row) : undefined;
  }

  listOrders(): OrderRow[] {
    return (
      this.connection
        .prepare("SELECT * FROM pm_orders ORDER BY updated_at DESC, id")
        .all() as Record<string, unknown>[]
    ).map(mapOrder);
  }

  updateOrderState(id: string, state: OrderState, now: string): void {
    this.connection
      .prepare("UPDATE pm_orders SET state = ?, updated_at = ? WHERE id = ?")
      .run(state, now, id);
  }

  participants(orderId: string): ParticipantRow[] {
    return (
      this.connection
        .prepare(
          "SELECT * FROM pm_participants WHERE order_id = ? ORDER BY joined_at, id"
        )
        .all(orderId) as Record<string, unknown>[]
    ).map(mapParticipant);
  }

  getParticipantByUser(
    orderId: string,
    userId: string
  ): ParticipantRow | undefined {
    const row = this.connection
      .prepare(
        "SELECT * FROM pm_participants WHERE order_id = ? AND user_id = ?"
      )
      .get(orderId, userId) as Record<string, unknown> | undefined;
    return row ? mapParticipant(row) : undefined;
  }

  upsertParticipant(row: ParticipantRow): void {
    this.connection
      .prepare(
        `INSERT INTO pm_participants
         (id, order_id, user_id, display_name, units, joined_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(order_id, user_id) DO UPDATE SET
           display_name = excluded.display_name,
           units = excluded.units,
           updated_at = excluded.updated_at`
      )
      .run(
        row.id,
        row.orderId,
        row.userId,
        row.displayName,
        row.units,
        row.joinedAt,
        row.updatedAt
      );
  }

  deleteParticipant(orderId: string, userId: string): boolean {
    return (
      this.connection
        .prepare(
          "DELETE FROM pm_participants WHERE order_id = ? AND user_id = ?"
        )
        .run(orderId, userId).changes > 0
    );
  }

  latestCheckout(orderId: string): CheckoutRow | undefined {
    const row = this.connection
      .prepare(
        "SELECT * FROM pm_checkout_snapshots WHERE order_id = ? ORDER BY version DESC LIMIT 1"
      )
      .get(orderId) as Record<string, unknown> | undefined;
    return row ? mapCheckout(row) : undefined;
  }

  latestCanonicalCheckout(orderId: string): CheckoutRow | undefined {
    const row = this.connection
      .prepare(
        `SELECT * FROM pm_checkout_snapshots
         WHERE order_id = ? AND is_canonical = 1
         ORDER BY version DESC LIMIT 1`
      )
      .get(orderId) as Record<string, unknown> | undefined;
    return row ? mapCheckout(row) : undefined;
  }

  checkoutBySourceKey(sourceIdempotencyKey: string): CheckoutRow | undefined {
    const row = this.connection
      .prepare(
        "SELECT * FROM pm_checkout_snapshots WHERE source_idempotency_key = ?"
      )
      .get(sourceIdempotencyKey) as Record<string, unknown> | undefined;
    return row ? mapCheckout(row) : undefined;
  }

  supersedeConfirmations(orderId: string, now: string): void {
    this.connection
      .prepare(
        `UPDATE pm_user_confirmations
         SET status = 'superseded', updated_at = ?
         WHERE status IN ('pending', 'confirmed', 'declined') AND checkout_id IN
           (SELECT id FROM pm_checkout_snapshots WHERE order_id = ?)`
      )
      .run(now, orderId);
  }

  insertCheckout(row: NewCheckout): void {
    this.connection
      .prepare(
        `INSERT INTO pm_checkout_snapshots
         (id, order_id, version, hash, merchant_id, merchant_display_name,
          payee_id, hash_algorithm, canonicalization_version, is_canonical, items_json,
          asset_id, goods_amount_atomic, shipping_amount_atomic,
          discount_amount_atomic, fee_amount_atomic, total_amount_atomic,
          expires_at, quote_reference, source_idempotency_key, request_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.orderId,
        row.version,
        row.hash,
        row.merchantId,
        row.merchantDisplayName,
        row.payeeId,
        row.hashAlgorithm,
        row.canonicalizationVersion,
        JSON.stringify(row.items),
        row.assetId,
        row.goodsAmountAtomic,
        row.shippingAmountAtomic,
        row.discountAmountAtomic,
        row.feeAmountAtomic,
        row.totalAmountAtomic,
        row.expiresAt,
        row.quoteReference,
        row.sourceIdempotencyKey,
        row.requestHash,
        row.createdAt
      );
    const allocationStatement = this.connection.prepare(
      `INSERT INTO pm_allocations
       (id, checkout_id, participant_id, asset_id, amount_atomic, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const confirmationStatement = this.connection.prepare(
      `INSERT INTO pm_user_confirmations
       (id, checkout_id, participant_id, token_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    );
    for (const allocation of row.allocations) {
      allocationStatement.run(
        allocation.id,
        row.id,
        allocation.participantId,
        allocation.assetId,
        allocation.amountAtomic,
        row.createdAt
      );
      confirmationStatement.run(
        allocation.confirmationId,
        row.id,
        allocation.participantId,
        allocation.tokenHash,
        row.createdAt,
        row.createdAt
      );
    }
  }

  allocations(checkoutId: string): AllocationRow[] {
    return this.connection
      .prepare(
        `SELECT p.id AS participant_id, p.user_id, p.display_name, p.units,
                a.asset_id, a.amount_atomic, c.status AS confirmation_status,
                c.confirmed_at, c.declined_at
         FROM pm_allocations a
         JOIN pm_participants p ON p.id = a.participant_id
         JOIN pm_user_confirmations c
           ON c.checkout_id = a.checkout_id AND c.participant_id = a.participant_id
         WHERE a.checkout_id = ?
         ORDER BY p.joined_at, p.id`
      )
      .all(checkoutId)
      .map((row) => {
        const value = row as Record<string, unknown>;
        return {
          participantId: String(value.participant_id),
          userId: String(value.user_id),
          displayName: String(value.display_name),
          units: Number(value.units),
          assetId: String(value.asset_id),
          amountAtomic: String(value.amount_atomic),
          confirmationStatus: String(
            value.confirmation_status
          ) as AllocationRow["confirmationStatus"],
          confirmedAt:
            value.confirmed_at === null ? null : String(value.confirmed_at),
          declinedAt:
            value.declined_at === null ? null : String(value.declined_at)
        };
      });
  }

  paymentRequest(orderId: string): PaymentRequestRow | undefined {
    const row = this.connection
      .prepare(
        `SELECT r.* FROM pm_payment_requests r
         JOIN pm_checkout_snapshots c ON c.id = r.checkout_id
         WHERE r.order_id = ? AND r.status = 'ready' AND c.is_canonical = 1
         ORDER BY r.created_at DESC LIMIT 1`
      )
      .get(orderId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      orderId: String(row.order_id),
      checkoutId: String(row.checkout_id),
      checkoutVersion: Number(row.checkout_version),
      checkoutHash: String(row.checkout_hash),
      confirmationSetId: String(row.confirmation_set_id),
      idempotencyKey: String(row.idempotency_key),
      payerRef: String(row.payer_ref),
      payeeId: String(row.payee_id),
      assetId: String(row.asset_id),
      amountAtomic: String(row.amount_atomic),
      expiresAt: String(row.expires_at),
      status: String(row.status) as "ready",
      createdAt: String(row.created_at)
    };
  }

  confirmationByTokenHash(
    tokenHash: string
  ): ConfirmationLookupRow | undefined {
    const row = this.connection
      .prepare(
        `SELECT c.id AS confirmation_id, c.participant_id,
                c.status AS confirmation_status, c.confirmed_at, c.declined_at,
                p.user_id AS participant_user_id,
                p.display_name AS participant_display_name, p.units AS participant_units,
                o.title AS order_title, o.state AS order_state,
                a.amount_atomic AS allocation_amount_atomic,
                s.*
         FROM pm_user_confirmations c
         JOIN pm_participants p ON p.id = c.participant_id
         JOIN pm_checkout_snapshots s ON s.id = c.checkout_id
         JOIN pm_orders o ON o.id = s.order_id
         JOIN pm_allocations a
           ON a.checkout_id = s.id AND a.participant_id = c.participant_id
         WHERE c.token_hash = ?`
      )
      .get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      ...mapCheckout(row),
      confirmationId: String(row.confirmation_id),
      participantId: String(row.participant_id),
      participantUserId: String(row.participant_user_id),
      participantDisplayName: String(row.participant_display_name),
      participantUnits: Number(row.participant_units),
      orderTitle: String(row.order_title),
      orderState: String(row.order_state) as OrderState,
      confirmationStatus: String(
        row.confirmation_status
      ) as ConfirmationLookupRow["confirmationStatus"],
      confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
      declinedAt: row.declined_at === null ? null : String(row.declined_at),
      allocationAmountAtomic: String(row.allocation_amount_atomic)
    };
  }

  expireConfirmation(id: string, now: string): void {
    this.connection
      .prepare(
        `UPDATE pm_user_confirmations
         SET status = 'expired', updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(now, id);
  }

  confirm(id: string, actorUserId: string, now: string): boolean {
    const result = this.connection
      .prepare(
        `UPDATE pm_user_confirmations
         SET status = 'confirmed', acted_by_user_id = ?, confirmed_at = ?,
             declined_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(actorUserId, now, now, id);
    return result.changes > 0;
  }

  decline(id: string, actorUserId: string, now: string): boolean {
    const result = this.connection
      .prepare(
        `UPDATE pm_user_confirmations
         SET status = 'declined', acted_by_user_id = ?, declined_at = ?,
             confirmed_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(actorUserId, now, now, id);
    return result.changes > 0;
  }

  rotateConfirmationToken(
    confirmationId: string,
    nextTokenHash: string,
    now: string
  ): boolean {
    return (
      this.connection
        .prepare(
          `UPDATE pm_user_confirmations
           SET token_hash = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`
        )
        .run(nextTokenHash, now, confirmationId).changes > 0
    );
  }

  pendingConfirmations(checkoutId: string): PendingConfirmationRow[] {
    return (
      this.connection
        .prepare(
          `SELECT c.id AS confirmation_id, c.participant_id,
                  p.user_id, p.display_name
           FROM pm_user_confirmations c
           JOIN pm_participants p ON p.id = c.participant_id
           WHERE c.checkout_id = ? AND c.status = 'pending'
           ORDER BY p.joined_at, p.id`
        )
        .all(checkoutId) as Record<string, unknown>[]
    ).map((row) => ({
      confirmationId: String(row.confirmation_id),
      participantId: String(row.participant_id),
      userId: String(row.user_id),
      displayName: String(row.display_name)
    }));
  }

  allConfirmationsConfirmed(checkoutId: string): boolean {
    const row = this.connection
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed
         FROM pm_user_confirmations WHERE checkout_id = ?`
      )
      .get(checkoutId) as { total: number; confirmed: number | null };
    return row.total > 0 && row.confirmed === row.total;
  }

  operationIdempotency(key: string): OperationIdempotencyRow | undefined {
    const row = this.connection
      .prepare(
        "SELECT * FROM pm_operation_idempotency WHERE idempotency_key = ?"
      )
      .get(key) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      idempotencyKey: String(row.idempotency_key),
      operation: String(row.operation) as OperationIdempotencyRow["operation"],
      orderId: String(row.order_id),
      actorUserId: String(row.actor_user_id),
      requestHash: String(row.request_hash),
      result: JSON.parse(String(row.result_json)) as OrderDetailView,
      createdAt: String(row.created_at)
    };
  }

  insertOperationIdempotency(row: OperationIdempotencyRow): void {
    this.connection
      .prepare(
        `INSERT INTO pm_operation_idempotency
         (idempotency_key, operation, order_id, actor_user_id, request_hash,
          result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.idempotencyKey,
        row.operation,
        row.orderId,
        row.actorUserId,
        row.requestHash,
        JSON.stringify(row.result),
        row.createdAt
      );
  }

  ensureConfirmationSet(input: {
    id: string;
    orderId: string;
    checkoutId: string;
    now: string;
  }): string {
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO pm_confirmation_sets
         (id, order_id, checkout_id, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(input.id, input.orderId, input.checkoutId, input.now);
    const row = this.connection
      .prepare("SELECT id FROM pm_confirmation_sets WHERE checkout_id = ?")
      .get(input.checkoutId) as { id: string };
    return row.id;
  }

  ensurePaymentRequest(row: NewPaymentRequest): boolean {
    return (
      this.connection
        .prepare(
          `INSERT OR IGNORE INTO pm_payment_requests
           (id, order_id, checkout_id, checkout_version, checkout_hash,
            confirmation_set_id, idempotency_key, payer_ref, payee_id, asset_id,
            amount_atomic, expires_at, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.orderId,
          row.checkoutId,
          row.checkoutVersion,
          row.checkoutHash,
          row.confirmationSetId,
          row.idempotencyKey,
          row.payerRef,
          row.payeeId,
          row.assetId,
          row.amountAtomic,
          row.expiresAt,
          row.status,
          row.createdAt,
          row.updatedAt
        ).changes > 0
    );
  }
}

export class OrderRepository {
  constructor(private readonly database: PoolMateDatabase) {}

  read<T>(operation: (transaction: OrderTransaction) => T): T {
    return this.database.read((connection) =>
      operation(new OrderTransaction(connection))
    );
  }

  immediate<T>(operation: (transaction: OrderTransaction) => T): T {
    return this.database.immediate((connection) =>
      operation(new OrderTransaction(connection))
    );
  }
}
