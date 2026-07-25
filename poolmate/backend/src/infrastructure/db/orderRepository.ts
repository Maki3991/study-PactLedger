import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type {
  AllocationStrategy,
  CheckoutItemView,
  FundingMode,
  OrderCancellationView,
  OrderDetailView,
  OrderState,
  PaymentOutboxView,
  PaymentAllocationStatus,
  PaymentProjectionStatus,
  SettlementMode
} from "@poolmate/shared";
import type { PoolMateDatabase } from "./database.js";
import {
  allocations as allocationTable,
  checkoutSnapshots,
  confirmationSets,
  groups,
  operationIdempotency as operationIdempotencyTable,
  orderCancellations,
  orders,
  outbox,
  participants as participantTable,
  paymentProjections,
  paymentRequests,
  userConfirmations
} from "./schema.js";

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
  cancellation: OrderCancellationView | null;
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
  checkoutId: string;
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
  sourceProtocol: "A2A" | "MOCK";
  createdAt: string;
}

export interface AllocationRow {
  id: string;
  participantId: string;
  userId: string;
  displayName: string;
  units: number;
  assetId: string;
  strategy: AllocationStrategy;
  status: PaymentAllocationStatus;
  goodsAmountAtomic: string;
  shippingAmountAtomic: string;
  discountAmountAtomic: string;
  feeAmountAtomic: string;
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
  checkoutSnapshotId: string;
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
  status:
    | "ready"
    | "submitting"
    | "submitted"
    | "confirmed"
    | "demo_confirmed"
    | "failed"
    | "unknown";
  createdAt: string;
}

export interface PaymentProjectionRow {
  paymentRequestId: string;
  operationId: string;
  status: PaymentProjectionStatus;
  settlementMode: SettlementMode;
  errorCode: string | null;
  errorMessage: string | null;
  receiptId: string | null;
  transactionHash: string | null;
  explorerUrl: string | null;
  confirmedAt: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentOutboxRow {
  id: string;
  paymentRequestId: string;
  operationId: string;
  status: PaymentOutboxView["status"];
  attempts: number;
  lastErrorCode: string | null;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
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
  allocationId: string;
  allocationStrategy: AllocationStrategy;
  allocationStatus: PaymentAllocationStatus;
  allocationGoodsAmountAtomic: string;
  allocationShippingAmountAtomic: string;
  allocationDiscountAmountAtomic: string;
  allocationFeeAmountAtomic: string;
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
    strategy: AllocationStrategy;
    status: PaymentAllocationStatus;
    goodsAmountAtomic: string;
    shippingAmountAtomic: string;
    discountAmountAtomic: string;
    feeAmountAtomic: string;
    amountAtomic: string;
    confirmationId: string;
    tokenHash: string;
  }>;
}

interface NewPaymentRequest extends PaymentRequestRow {
  updatedAt: string;
}

export interface PaymentStateUpdate {
  requestStatus: PaymentRequestRow["status"];
  projectionStatus: PaymentProjectionStatus;
  settlementMode: SettlementMode;
  outboxStatus: PaymentOutboxRow["status"];
  orderState: OrderState;
  errorCode?: string;
  errorMessage?: string;
  receipt?: {
    receiptId: string;
    transactionHash: string;
    explorerUrl: string;
    confirmedAt: string;
  };
  availableAt: string;
  now: string;
}

export type PaymentSubmissionClaim = "claimed" | "busy" | "expired";

type OrmConnection = PoolMateDatabase["orm"];
type GroupRecord = typeof groups.$inferSelect;
type OrderRecord = typeof orders.$inferSelect;
type CancellationRecord = typeof orderCancellations.$inferSelect;
type ParticipantRecord = typeof participantTable.$inferSelect;
type CheckoutRecord = typeof checkoutSnapshots.$inferSelect;
type PaymentRequestRecord = typeof paymentRequests.$inferSelect;
type PaymentProjectionRecord = typeof paymentProjections.$inferSelect;
type OutboxRecord = typeof outbox.$inferSelect;

function mapGroup(row: GroupRecord): GroupRow {
  return row;
}

function mapOrder(
  row: OrderRecord,
  cancellation?: CancellationRecord | null
): OrderRow {
  return {
    id: row.id,
    groupId: row.groupId,
    ownerUserId: row.ownerUserId,
    title: row.title,
    state: (row.terminalState ?? row.state) as OrderState,
    fundingMode: row.fundingMode as FundingMode,
    targetUnits: row.targetUnits,
    sourceIdempotencyKey: row.sourceIdempotencyKey,
    requestHash: row.requestHash,
    cancellation: cancellation
      ? {
          actorType:
            cancellation.actorType as OrderCancellationView["actorType"],
          actorId: cancellation.actorId,
          reasonCode:
            cancellation.reasonCode as OrderCancellationView["reasonCode"],
          canceledAt: cancellation.createdAt
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapParticipant(row: ParticipantRecord): ParticipantRow {
  return row;
}

function mapCheckout(row: CheckoutRecord): CheckoutRow {
  return {
    id: row.id,
    checkoutId: row.checkoutId,
    orderId: row.orderId,
    version: row.version,
    hash: row.hash,
    merchantId: row.merchantId,
    merchantDisplayName: row.merchantDisplayName,
    payeeId: row.payeeId,
    hashAlgorithm: row.hashAlgorithm as "SHA-256",
    canonicalizationVersion:
      row.canonicalizationVersion as "poolmate-checkout-json-v1",
    isCanonical: row.isCanonical,
    items: JSON.parse(row.itemsJson) as CheckoutItemView[],
    assetId: row.assetId,
    goodsAmountAtomic: row.goodsAmountAtomic,
    shippingAmountAtomic: row.shippingAmountAtomic,
    discountAmountAtomic: row.discountAmountAtomic,
    feeAmountAtomic: row.feeAmountAtomic,
    totalAmountAtomic: row.totalAmountAtomic,
    expiresAt: row.expiresAt,
    quoteReference: row.quoteReference,
    sourceIdempotencyKey: row.sourceIdempotencyKey,
    requestHash: row.requestHash,
    sourceProtocol: row.sourceProtocol as "A2A" | "MOCK",
    createdAt: row.createdAt
  };
}

function mapPaymentRequest(
  row: PaymentRequestRecord,
  merchantCheckoutId: string
): PaymentRequestRow {
  return {
    id: row.id,
    orderId: row.orderId,
    checkoutSnapshotId: row.checkoutId,
    checkoutId: merchantCheckoutId,
    checkoutVersion: row.checkoutVersion,
    checkoutHash: row.checkoutHash,
    confirmationSetId: row.confirmationSetId,
    idempotencyKey: row.idempotencyKey,
    payerRef: row.payerRef,
    payeeId: row.payeeId,
    assetId: row.assetId,
    amountAtomic: row.amountAtomic,
    expiresAt: row.expiresAt,
    status: row.status as PaymentRequestRow["status"],
    createdAt: row.createdAt
  };
}

function mapPaymentProjection(
  row: PaymentProjectionRecord
): PaymentProjectionRow {
  return {
    ...row,
    status: row.status as PaymentProjectionStatus,
    settlementMode: row.settlementMode as SettlementMode
  };
}

function mapPaymentOutbox(row: OutboxRecord): PaymentOutboxRow {
  return { ...row, status: row.status as PaymentOutboxRow["status"] };
}

export class OrderTransaction {
  constructor(private readonly connection: OrmConnection) {}

  upsertGroup(input: {
    id: string;
    telegramChatId: string;
    title: string;
    now: string;
  }): GroupRow {
    this.connection
      .insert(groups)
      .values({
        id: input.id,
        telegramChatId: input.telegramChatId,
        title: input.title,
        createdAt: input.now,
        updatedAt: input.now
      })
      .onConflictDoUpdate({
        target: groups.telegramChatId,
        set: { title: input.title, updatedAt: input.now }
      })
      .run();
    return this.getGroupByChatId(input.telegramChatId)!;
  }

  getGroup(id: string): GroupRow | undefined {
    const row = this.connection
      .select()
      .from(groups)
      .where(eq(groups.id, id))
      .get();
    return row ? mapGroup(row) : undefined;
  }

  getGroupByChatId(telegramChatId: string): GroupRow | undefined {
    const row = this.connection
      .select()
      .from(groups)
      .where(eq(groups.telegramChatId, telegramChatId))
      .get();
    return row ? mapGroup(row) : undefined;
  }

  insertOrder(row: OrderRow): OrderRow {
    const result = this.connection
      .insert(orders)
      .values({
        id: row.id,
        groupId: row.groupId,
        ownerUserId: row.ownerUserId,
        title: row.title,
        state: row.state,
        fundingMode: row.fundingMode,
        targetUnits: row.targetUnits,
        sourceIdempotencyKey: row.sourceIdempotencyKey,
        requestHash: row.requestHash,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      })
      .onConflictDoNothing()
      .run();
    if (result.changes === 0 && row.sourceIdempotencyKey) {
      const existing = this.getOrderBySourceKey(row.sourceIdempotencyKey);
      if (existing) return existing;
    }
    return this.getOrder(row.id)!;
  }

  getOrder(id: string): OrderRow | undefined {
    return this.findOrder(eq(orders.id, id));
  }

  getOrderBySourceKey(key: string): OrderRow | undefined {
    return this.findOrder(eq(orders.sourceIdempotencyKey, key));
  }

  private findOrder(condition: ReturnType<typeof eq>): OrderRow | undefined {
    const row = this.connection
      .select({ order: orders, cancellation: orderCancellations })
      .from(orders)
      .leftJoin(orderCancellations, eq(orderCancellations.orderId, orders.id))
      .where(condition)
      .get();
    return row ? mapOrder(row.order, row.cancellation) : undefined;
  }

  claimOrderRequestHash(id: string, requestHash: string): boolean {
    return (
      this.connection
        .update(orders)
        .set({ requestHash })
        .where(and(eq(orders.id, id), isNull(orders.requestHash)))
        .run().changes === 1
    );
  }

  listOrders(): OrderRow[] {
    return this.connection
      .select({ order: orders, cancellation: orderCancellations })
      .from(orders)
      .leftJoin(orderCancellations, eq(orderCancellations.orderId, orders.id))
      .orderBy(desc(orders.updatedAt), asc(orders.id))
      .all()
      .map((row) => mapOrder(row.order, row.cancellation));
  }

  updateOrderState(id: string, state: OrderState, now: string): void {
    this.connection
      .update(orders)
      .set({ state, updatedAt: now })
      .where(and(eq(orders.id, id), isNull(orders.terminalState)))
      .run();
  }

  cancellationByIdempotencyKey(key: string): OrderRow | undefined {
    const cancellation = this.connection
      .select({ orderId: orderCancellations.orderId })
      .from(orderCancellations)
      .where(eq(orderCancellations.idempotencyKey, key))
      .get();
    return cancellation ? this.getOrder(cancellation.orderId) : undefined;
  }

  cancelOrder(input: {
    orderId: string;
    idempotencyKey: string | null;
    requestHash: string;
    actorType: OrderCancellationView["actorType"];
    actorId: string;
    reasonCode: OrderCancellationView["reasonCode"];
    now: string;
  }): void {
    this.connection
      .insert(orderCancellations)
      .values({
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        actorType: input.actorType,
        actorId: input.actorId,
        reasonCode: input.reasonCode,
        createdAt: input.now
      })
      .run();
    this.connection
      .update(orders)
      .set({ terminalState: "CANCELED", updatedAt: input.now })
      .where(and(eq(orders.id, input.orderId), isNull(orders.terminalState)))
      .run();
  }

  terminatePaymentForCanceledOrder(orderId: string, now: string): void {
    const request = this.paymentRequest(orderId);
    if (!request) return;
    this.connection
      .update(paymentRequests)
      .set({ status: "failed", updatedAt: now })
      .where(
        and(
          eq(paymentRequests.id, request.id),
          eq(paymentRequests.status, "ready")
        )
      )
      .run();
    this.connection
      .update(paymentProjections)
      .set({
        status: "FAILED",
        errorCode: "ORDER_CANCELED",
        errorMessage: "Order canceled before payment submission.",
        updatedAt: now
      })
      .where(
        and(
          eq(paymentProjections.paymentRequestId, request.id),
          inArray(paymentProjections.status, ["READY", "UNAVAILABLE"])
        )
      )
      .run();
    this.connection
      .update(outbox)
      .set({
        status: "completed",
        lastErrorCode: "ORDER_CANCELED",
        availableAt: now,
        updatedAt: now
      })
      .where(
        and(
          eq(outbox.paymentRequestId, request.id),
          inArray(outbox.status, ["pending", "blocked"])
        )
      )
      .run();
  }

  participants(orderId: string): ParticipantRow[] {
    return this.connection
      .select()
      .from(participantTable)
      .where(eq(participantTable.orderId, orderId))
      .orderBy(asc(participantTable.joinedAt), asc(participantTable.id))
      .all()
      .map(mapParticipant);
  }

  getParticipantByUser(
    orderId: string,
    userId: string
  ): ParticipantRow | undefined {
    const row = this.connection
      .select()
      .from(participantTable)
      .where(
        and(
          eq(participantTable.orderId, orderId),
          eq(participantTable.userId, userId)
        )
      )
      .get();
    return row ? mapParticipant(row) : undefined;
  }

  upsertParticipant(row: ParticipantRow): void {
    this.connection
      .insert(participantTable)
      .values(row)
      .onConflictDoUpdate({
        target: [participantTable.orderId, participantTable.userId],
        set: {
          displayName: row.displayName,
          units: row.units,
          updatedAt: row.updatedAt
        }
      })
      .run();
  }

  deleteParticipant(orderId: string, userId: string): boolean {
    return (
      this.connection
        .delete(participantTable)
        .where(
          and(
            eq(participantTable.orderId, orderId),
            eq(participantTable.userId, userId)
          )
        )
        .run().changes > 0
    );
  }

  latestCheckout(orderId: string): CheckoutRow | undefined {
    const row = this.connection
      .select()
      .from(checkoutSnapshots)
      .where(eq(checkoutSnapshots.orderId, orderId))
      .orderBy(desc(checkoutSnapshots.version))
      .limit(1)
      .get();
    return row ? mapCheckout(row) : undefined;
  }

  latestCanonicalCheckout(orderId: string): CheckoutRow | undefined {
    const row = this.connection
      .select()
      .from(checkoutSnapshots)
      .where(
        and(
          eq(checkoutSnapshots.orderId, orderId),
          eq(checkoutSnapshots.isCanonical, true)
        )
      )
      .orderBy(desc(checkoutSnapshots.version))
      .limit(1)
      .get();
    return row ? mapCheckout(row) : undefined;
  }

  checkoutBySourceKey(sourceIdempotencyKey: string): CheckoutRow | undefined {
    const row = this.connection
      .select()
      .from(checkoutSnapshots)
      .where(eq(checkoutSnapshots.sourceIdempotencyKey, sourceIdempotencyKey))
      .get();
    return row ? mapCheckout(row) : undefined;
  }

  claimCheckoutRequestHash(id: string, requestHash: string): boolean {
    return (
      this.connection
        .update(checkoutSnapshots)
        .set({ requestHash })
        .where(
          and(
            eq(checkoutSnapshots.id, id),
            isNull(checkoutSnapshots.requestHash)
          )
        )
        .run().changes === 1
    );
  }

  supersedeConfirmations(orderId: string, now: string): void {
    const checkoutIds = this.connection
      .select({ id: checkoutSnapshots.id })
      .from(checkoutSnapshots)
      .where(eq(checkoutSnapshots.orderId, orderId));
    this.connection
      .update(userConfirmations)
      .set({ status: "superseded", updatedAt: now })
      .where(
        and(
          inArray(userConfirmations.status, [
            "pending",
            "confirmed",
            "declined"
          ]),
          inArray(userConfirmations.checkoutId, checkoutIds)
        )
      )
      .run();
    this.connection
      .update(allocationTable)
      .set({ status: "INVALIDATED" })
      .where(
        and(
          inArray(allocationTable.checkoutId, checkoutIds),
          inArray(allocationTable.status, [
            "CALCULATED",
            "CONFIRMATION_PENDING",
            "CONFIRMED",
            "FAILED"
          ])
        )
      )
      .run();
  }

  insertCheckout(row: NewCheckout): void {
    this.connection
      .insert(checkoutSnapshots)
      .values({
        id: row.id,
        checkoutId: row.checkoutId,
        orderId: row.orderId,
        version: row.version,
        hash: row.hash,
        merchantId: row.merchantId,
        merchantDisplayName: row.merchantDisplayName,
        payeeId: row.payeeId,
        hashAlgorithm: row.hashAlgorithm,
        canonicalizationVersion: row.canonicalizationVersion,
        isCanonical: true,
        itemsJson: JSON.stringify(row.items),
        assetId: row.assetId,
        goodsAmountAtomic: row.goodsAmountAtomic,
        shippingAmountAtomic: row.shippingAmountAtomic,
        discountAmountAtomic: row.discountAmountAtomic,
        feeAmountAtomic: row.feeAmountAtomic,
        totalAmountAtomic: row.totalAmountAtomic,
        expiresAt: row.expiresAt,
        quoteReference: row.quoteReference,
        sourceIdempotencyKey: row.sourceIdempotencyKey,
        requestHash: row.requestHash,
        sourceProtocol: row.sourceProtocol,
        createdAt: row.createdAt
      })
      .run();
    for (const allocation of row.allocations) {
      this.connection
        .insert(allocationTable)
        .values({
          id: allocation.id,
          checkoutId: row.id,
          participantId: allocation.participantId,
          assetId: allocation.assetId,
          strategy: allocation.strategy,
          status: allocation.status,
          goodsAmountAtomic: allocation.goodsAmountAtomic,
          shippingAmountAtomic: allocation.shippingAmountAtomic,
          discountAmountAtomic: allocation.discountAmountAtomic,
          feeAmountAtomic: allocation.feeAmountAtomic,
          amountAtomic: allocation.amountAtomic,
          createdAt: row.createdAt
        })
        .run();
      this.connection
        .insert(userConfirmations)
        .values({
          id: allocation.confirmationId,
          checkoutId: row.id,
          participantId: allocation.participantId,
          tokenHash: allocation.tokenHash,
          status: "pending",
          createdAt: row.createdAt,
          updatedAt: row.createdAt
        })
        .run();
    }
  }

  allocations(checkoutId: string): AllocationRow[] {
    return this.connection
      .select({
        participant: participantTable,
        allocation: allocationTable,
        confirmation: userConfirmations
      })
      .from(allocationTable)
      .innerJoin(
        participantTable,
        eq(participantTable.id, allocationTable.participantId)
      )
      .innerJoin(
        userConfirmations,
        and(
          eq(userConfirmations.checkoutId, allocationTable.checkoutId),
          eq(userConfirmations.participantId, allocationTable.participantId)
        )
      )
      .where(eq(allocationTable.checkoutId, checkoutId))
      .orderBy(asc(participantTable.joinedAt), asc(participantTable.id))
      .all()
      .map(({ participant, allocation, confirmation }) => ({
        id: allocation.id,
        participantId: participant.id,
        userId: participant.userId,
        displayName: participant.displayName,
        units: participant.units,
        assetId: allocation.assetId,
        strategy: allocation.strategy as AllocationStrategy,
        status: allocation.status as PaymentAllocationStatus,
        goodsAmountAtomic: allocation.goodsAmountAtomic,
        shippingAmountAtomic: allocation.shippingAmountAtomic,
        discountAmountAtomic: allocation.discountAmountAtomic,
        feeAmountAtomic: allocation.feeAmountAtomic,
        amountAtomic: allocation.amountAtomic,
        confirmationStatus:
          confirmation.status as AllocationRow["confirmationStatus"],
        confirmedAt: confirmation.confirmedAt,
        declinedAt: confirmation.declinedAt
      }));
  }

  paymentRequest(orderId: string): PaymentRequestRow | undefined {
    const row = this.connection
      .select({ request: paymentRequests, checkout: checkoutSnapshots })
      .from(paymentRequests)
      .innerJoin(
        checkoutSnapshots,
        eq(checkoutSnapshots.id, paymentRequests.checkoutId)
      )
      .where(
        and(
          eq(paymentRequests.orderId, orderId),
          eq(checkoutSnapshots.isCanonical, true)
        )
      )
      .orderBy(desc(paymentRequests.createdAt))
      .limit(1)
      .get();
    return row
      ? mapPaymentRequest(row.request, row.checkout.checkoutId)
      : undefined;
  }

  paymentRequestById(id: string): PaymentRequestRow | undefined {
    const row = this.connection
      .select({ request: paymentRequests, checkout: checkoutSnapshots })
      .from(paymentRequests)
      .innerJoin(
        checkoutSnapshots,
        eq(checkoutSnapshots.id, paymentRequests.checkoutId)
      )
      .where(eq(paymentRequests.id, id))
      .get();
    return row
      ? mapPaymentRequest(row.request, row.checkout.checkoutId)
      : undefined;
  }

  paymentProjection(
    paymentRequestId: string
  ): PaymentProjectionRow | undefined {
    const row = this.connection
      .select()
      .from(paymentProjections)
      .where(eq(paymentProjections.paymentRequestId, paymentRequestId))
      .get();
    return row ? mapPaymentProjection(row) : undefined;
  }

  paymentProjectionByOperation(
    operationId: string
  ): PaymentProjectionRow | undefined {
    const row = this.connection
      .select()
      .from(paymentProjections)
      .where(eq(paymentProjections.operationId, operationId))
      .get();
    return row ? mapPaymentProjection(row) : undefined;
  }

  paymentOutbox(paymentRequestId: string): PaymentOutboxRow | undefined {
    const row = this.connection
      .select()
      .from(outbox)
      .where(eq(outbox.paymentRequestId, paymentRequestId))
      .get();
    return row ? mapPaymentOutbox(row) : undefined;
  }

  recoverablePaymentOrderIds(
    settlementMode: Exclude<SettlementMode, "disabled">,
    now: string
  ): string[] {
    return this.connection
      .select({ orderId: paymentRequests.orderId })
      .from(paymentRequests)
      .innerJoin(
        paymentProjections,
        eq(paymentProjections.paymentRequestId, paymentRequests.id)
      )
      .innerJoin(outbox, eq(outbox.paymentRequestId, paymentRequests.id))
      .innerJoin(orders, eq(orders.id, paymentRequests.orderId))
      .where(
        and(
          eq(paymentProjections.settlementMode, settlementMode),
          isNull(orders.terminalState),
          or(
            inArray(paymentProjections.status, ["SUBMITTED", "UNKNOWN"]),
            and(
              eq(paymentProjections.status, "SUBMITTING"),
              eq(outbox.status, "processing"),
              lte(outbox.availableAt, now)
            )
          )
        )
      )
      .orderBy(asc(paymentProjections.updatedAt), asc(paymentRequests.orderId))
      .all()
      .map((row) => row.orderId);
  }

  confirmationByTokenHash(
    tokenHash: string
  ): ConfirmationLookupRow | undefined {
    const row = this.connection
      .select({
        confirmation: userConfirmations,
        participant: participantTable,
        checkout: checkoutSnapshots,
        order: orders,
        allocation: allocationTable
      })
      .from(userConfirmations)
      .innerJoin(
        participantTable,
        eq(participantTable.id, userConfirmations.participantId)
      )
      .innerJoin(
        checkoutSnapshots,
        eq(checkoutSnapshots.id, userConfirmations.checkoutId)
      )
      .innerJoin(orders, eq(orders.id, checkoutSnapshots.orderId))
      .innerJoin(
        allocationTable,
        and(
          eq(allocationTable.checkoutId, checkoutSnapshots.id),
          eq(allocationTable.participantId, participantTable.id)
        )
      )
      .where(eq(userConfirmations.tokenHash, tokenHash))
      .get();
    if (!row) return undefined;
    return {
      ...mapCheckout(row.checkout),
      confirmationId: row.confirmation.id,
      participantId: row.participant.id,
      participantUserId: row.participant.userId,
      participantDisplayName: row.participant.displayName,
      participantUnits: row.participant.units,
      orderTitle: row.order.title,
      orderState: (row.order.terminalState ?? row.order.state) as OrderState,
      confirmationStatus: row.confirmation
        .status as ConfirmationLookupRow["confirmationStatus"],
      confirmedAt: row.confirmation.confirmedAt,
      declinedAt: row.confirmation.declinedAt,
      allocationId: row.allocation.id,
      allocationStrategy: row.allocation.strategy as AllocationStrategy,
      allocationStatus: row.allocation.status as PaymentAllocationStatus,
      allocationGoodsAmountAtomic: row.allocation.goodsAmountAtomic,
      allocationShippingAmountAtomic: row.allocation.shippingAmountAtomic,
      allocationDiscountAmountAtomic: row.allocation.discountAmountAtomic,
      allocationFeeAmountAtomic: row.allocation.feeAmountAtomic,
      allocationAmountAtomic: row.allocation.amountAtomic
    };
  }

  expireConfirmation(id: string, now: string): void {
    const confirmation = this.connection
      .select({
        checkoutId: userConfirmations.checkoutId,
        participantId: userConfirmations.participantId
      })
      .from(userConfirmations)
      .where(eq(userConfirmations.id, id))
      .get();
    this.connection
      .update(userConfirmations)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(userConfirmations.id, id),
          eq(userConfirmations.status, "pending")
        )
      )
      .run();
    if (confirmation) {
      this.connection
        .update(allocationTable)
        .set({ status: "FAILED" })
        .where(
          and(
            eq(allocationTable.checkoutId, confirmation.checkoutId),
            eq(allocationTable.participantId, confirmation.participantId),
            eq(allocationTable.status, "CONFIRMATION_PENDING")
          )
        )
        .run();
    }
  }

  confirm(id: string, actorUserId: string, now: string): boolean {
    const confirmation = this.connection
      .select({
        checkoutId: userConfirmations.checkoutId,
        participantId: userConfirmations.participantId
      })
      .from(userConfirmations)
      .where(eq(userConfirmations.id, id))
      .get();
    const changed =
      this.connection
        .update(userConfirmations)
        .set({
          status: "confirmed",
          actedByUserId: actorUserId,
          confirmedAt: now,
          declinedAt: null,
          updatedAt: now
        })
        .where(
          and(
            eq(userConfirmations.id, id),
            eq(userConfirmations.status, "pending")
          )
        )
        .run().changes > 0;
    if (changed && confirmation) {
      this.connection
        .update(allocationTable)
        .set({ status: "CONFIRMED" })
        .where(
          and(
            eq(allocationTable.checkoutId, confirmation.checkoutId),
            eq(allocationTable.participantId, confirmation.participantId),
            eq(allocationTable.status, "CONFIRMATION_PENDING")
          )
        )
        .run();
    }
    return changed;
  }

  decline(id: string, actorUserId: string, now: string): boolean {
    const confirmation = this.connection
      .select({
        checkoutId: userConfirmations.checkoutId,
        participantId: userConfirmations.participantId
      })
      .from(userConfirmations)
      .where(eq(userConfirmations.id, id))
      .get();
    const changed =
      this.connection
        .update(userConfirmations)
        .set({
          status: "declined",
          actedByUserId: actorUserId,
          declinedAt: now,
          confirmedAt: null,
          updatedAt: now
        })
        .where(
          and(
            eq(userConfirmations.id, id),
            eq(userConfirmations.status, "pending")
          )
        )
        .run().changes > 0;
    if (changed && confirmation) {
      this.connection
        .update(allocationTable)
        .set({ status: "FAILED" })
        .where(
          and(
            eq(allocationTable.checkoutId, confirmation.checkoutId),
            eq(allocationTable.participantId, confirmation.participantId),
            eq(allocationTable.status, "CONFIRMATION_PENDING")
          )
        )
        .run();
    }
    return changed;
  }

  rotateConfirmationToken(
    confirmationId: string,
    nextTokenHash: string,
    now: string
  ): boolean {
    return (
      this.connection
        .update(userConfirmations)
        .set({ tokenHash: nextTokenHash, updatedAt: now })
        .where(
          and(
            eq(userConfirmations.id, confirmationId),
            eq(userConfirmations.status, "pending")
          )
        )
        .run().changes > 0
    );
  }

  pendingConfirmations(checkoutId: string): PendingConfirmationRow[] {
    return this.connection
      .select({
        confirmation: userConfirmations,
        participant: participantTable
      })
      .from(userConfirmations)
      .innerJoin(
        participantTable,
        eq(participantTable.id, userConfirmations.participantId)
      )
      .where(
        and(
          eq(userConfirmations.checkoutId, checkoutId),
          eq(userConfirmations.status, "pending")
        )
      )
      .orderBy(asc(participantTable.joinedAt), asc(participantTable.id))
      .all()
      .map(({ confirmation, participant }) => ({
        confirmationId: confirmation.id,
        participantId: participant.id,
        userId: participant.userId,
        displayName: participant.displayName
      }));
  }

  allConfirmationsConfirmed(checkoutId: string): boolean {
    const confirmations = this.connection
      .select({ status: userConfirmations.status })
      .from(userConfirmations)
      .where(eq(userConfirmations.checkoutId, checkoutId))
      .all();
    return (
      confirmations.length > 0 &&
      confirmations.every((row) => row.status === "confirmed")
    );
  }

  operationIdempotency(key: string): OperationIdempotencyRow | undefined {
    const row = this.connection
      .select()
      .from(operationIdempotencyTable)
      .where(eq(operationIdempotencyTable.idempotencyKey, key))
      .get();
    if (!row) return undefined;
    return {
      idempotencyKey: row.idempotencyKey,
      operation: row.operation as OperationIdempotencyRow["operation"],
      orderId: row.orderId,
      actorUserId: row.actorUserId,
      requestHash: row.requestHash,
      result: JSON.parse(row.resultJson) as OrderDetailView,
      createdAt: row.createdAt
    };
  }

  insertOperationIdempotency(row: OperationIdempotencyRow): void {
    this.connection
      .insert(operationIdempotencyTable)
      .values({
        idempotencyKey: row.idempotencyKey,
        operation: row.operation,
        orderId: row.orderId,
        actorUserId: row.actorUserId,
        requestHash: row.requestHash,
        resultJson: JSON.stringify(row.result),
        createdAt: row.createdAt
      })
      .run();
  }

  ensureConfirmationSet(input: {
    id: string;
    orderId: string;
    checkoutId: string;
    now: string;
  }): string {
    this.connection
      .insert(confirmationSets)
      .values({
        id: input.id,
        orderId: input.orderId,
        checkoutId: input.checkoutId,
        createdAt: input.now
      })
      .onConflictDoNothing()
      .run();
    return this.connection
      .select({ id: confirmationSets.id })
      .from(confirmationSets)
      .where(eq(confirmationSets.checkoutId, input.checkoutId))
      .get()!.id;
  }

  ensurePaymentRequest(row: NewPaymentRequest): boolean {
    return (
      this.connection
        .insert(paymentRequests)
        .values({
          id: row.id,
          orderId: row.orderId,
          checkoutId: row.checkoutSnapshotId,
          checkoutVersion: row.checkoutVersion,
          checkoutHash: row.checkoutHash,
          confirmationSetId: row.confirmationSetId,
          idempotencyKey: row.idempotencyKey,
          payerRef: row.payerRef,
          payeeId: row.payeeId,
          assetId: row.assetId,
          amountAtomic: row.amountAtomic,
          expiresAt: row.expiresAt,
          status: row.status,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        })
        .onConflictDoNothing()
        .run().changes > 0
    );
  }

  ensurePaymentWorkflow(input: {
    paymentRequest: NewPaymentRequest;
    operationId: string;
    outboxId: string;
    now: string;
  }): boolean {
    const created = this.ensurePaymentRequest(input.paymentRequest);
    const request = this.paymentRequestById(input.paymentRequest.id);
    if (!request) {
      throw new Error("Payment request could not be loaded after insertion.");
    }
    if (
      request.idempotencyKey !== input.paymentRequest.idempotencyKey ||
      request.orderId !== input.paymentRequest.orderId ||
      request.checkoutSnapshotId !== input.paymentRequest.checkoutSnapshotId ||
      request.checkoutId !== input.paymentRequest.checkoutId
    ) {
      throw new Error("Payment request identity conflict.");
    }
    this.connection
      .insert(paymentProjections)
      .values({
        paymentRequestId: request.id,
        operationId: input.operationId,
        status: "READY",
        settlementMode: "disabled",
        attempts: 0,
        createdAt: input.now,
        updatedAt: input.now
      })
      .onConflictDoNothing()
      .run();
    this.connection
      .insert(outbox)
      .values({
        id: input.outboxId,
        paymentRequestId: request.id,
        operationId: input.operationId,
        status: "pending",
        attempts: 0,
        availableAt: input.now,
        createdAt: input.now,
        updatedAt: input.now
      })
      .onConflictDoNothing()
      .run();
    return created;
  }

  claimPaymentSubmission(
    paymentRequestId: string,
    settlementMode: SettlementMode,
    leaseUntil: string,
    now: string
  ): PaymentSubmissionClaim {
    const request = this.paymentRequestById(paymentRequestId);
    if (!request) return "busy";
    const expiry = new Date(request.expiresAt).getTime();
    if (!Number.isFinite(expiry) || expiry <= new Date(now).getTime())
      return "expired";
    const paymentOutbox = this.paymentOutbox(paymentRequestId);
    const projection = this.paymentProjection(paymentRequestId);
    const order = this.getOrder(request.orderId);
    if (
      !paymentOutbox ||
      !projection ||
      !order ||
      order.state === "CANCELED" ||
      !["pending", "blocked"].includes(paymentOutbox.status) ||
      paymentOutbox.availableAt > now ||
      !["READY", "UNAVAILABLE"].includes(projection.status)
    ) {
      return "busy";
    }
    const claimed = this.connection
      .update(outbox)
      .set({
        status: "processing",
        attempts: paymentOutbox.attempts + 1,
        lastErrorCode: null,
        availableAt: leaseUntil,
        updatedAt: now
      })
      .where(
        and(
          eq(outbox.paymentRequestId, paymentRequestId),
          inArray(outbox.status, ["pending", "blocked"]),
          lte(outbox.availableAt, now)
        )
      )
      .run().changes;
    if (claimed === 0) return "busy";
    this.connection
      .update(paymentRequests)
      .set({ status: "submitting", updatedAt: now })
      .where(eq(paymentRequests.id, paymentRequestId))
      .run();
    this.connection
      .update(paymentProjections)
      .set({
        status: "SUBMITTING",
        settlementMode,
        errorCode: null,
        errorMessage: null,
        attempts: projection.attempts + 1,
        updatedAt: now
      })
      .where(eq(paymentProjections.paymentRequestId, paymentRequestId))
      .run();
    return "claimed";
  }

  claimPaymentRecovery(
    paymentRequestId: string,
    leaseUntil: string,
    now: string
  ): boolean {
    let projection = this.paymentProjection(paymentRequestId);
    let paymentOutbox = this.paymentOutbox(paymentRequestId);
    if (!projection || !paymentOutbox) return false;
    if (
      projection.status === "SUBMITTING" &&
      paymentOutbox.status === "processing" &&
      paymentOutbox.availableAt <= now
    ) {
      this.connection
        .update(paymentProjections)
        .set({
          status: "UNKNOWN",
          errorCode: "PAYMENT_OPERATION_UNKNOWN",
          errorMessage: "Submission lease expired and requires recovery.",
          updatedAt: now
        })
        .where(eq(paymentProjections.paymentRequestId, paymentRequestId))
        .run();
      this.connection
        .update(paymentRequests)
        .set({ status: "unknown", updatedAt: now })
        .where(
          and(
            eq(paymentRequests.id, paymentRequestId),
            eq(paymentRequests.status, "submitting")
          )
        )
        .run();
      this.connection
        .update(outbox)
        .set({ status: "unknown", updatedAt: now })
        .where(
          and(
            eq(outbox.paymentRequestId, paymentRequestId),
            eq(outbox.status, "processing")
          )
        )
        .run();
      const request = this.paymentRequestById(paymentRequestId);
      if (request)
        this.updateOrderState(request.orderId, "PAYMENT_UNKNOWN", now);
      projection = this.paymentProjection(paymentRequestId);
      paymentOutbox = this.paymentOutbox(paymentRequestId);
    }
    if (
      !projection ||
      !paymentOutbox ||
      !["SUBMITTED", "UNKNOWN"].includes(projection.status) ||
      !(
        ["unknown", "completed"].includes(paymentOutbox.status) ||
        (paymentOutbox.status === "processing" &&
          paymentOutbox.availableAt <= now)
      )
    ) {
      return false;
    }
    const claimed = this.connection
      .update(outbox)
      .set({
        status: "processing",
        attempts: paymentOutbox.attempts + 1,
        lastErrorCode: null,
        availableAt: leaseUntil,
        updatedAt: now
      })
      .where(eq(outbox.paymentRequestId, paymentRequestId))
      .run().changes;
    if (claimed === 0) return false;
    this.connection
      .update(paymentProjections)
      .set({ attempts: projection.attempts + 1, updatedAt: now })
      .where(eq(paymentProjections.paymentRequestId, paymentRequestId))
      .run();
    return true;
  }

  updatePaymentState(
    paymentRequestId: string,
    update: PaymentStateUpdate
  ): void {
    this.assertPaymentState(update);
    const request = this.paymentRequestById(paymentRequestId);
    if (!request) throw new Error("Payment request not found.");
    this.connection
      .update(paymentRequests)
      .set({ status: update.requestStatus, updatedAt: update.now })
      .where(eq(paymentRequests.id, paymentRequestId))
      .run();
    this.connection
      .update(paymentProjections)
      .set({
        status: update.projectionStatus,
        settlementMode: update.settlementMode,
        errorCode: update.errorCode ?? null,
        errorMessage: update.errorMessage ?? null,
        receiptId: update.receipt?.receiptId ?? null,
        transactionHash: update.receipt?.transactionHash ?? null,
        explorerUrl: update.receipt?.explorerUrl ?? null,
        confirmedAt: update.receipt?.confirmedAt ?? null,
        updatedAt: update.now
      })
      .where(eq(paymentProjections.paymentRequestId, paymentRequestId))
      .run();
    this.connection
      .update(outbox)
      .set({
        status: update.outboxStatus,
        lastErrorCode: update.errorCode ?? null,
        availableAt: update.availableAt,
        updatedAt: update.now
      })
      .where(eq(outbox.paymentRequestId, paymentRequestId))
      .run();
    if (update.projectionStatus === "CONFIRMED") {
      this.connection
        .update(allocationTable)
        .set({ status: "CAPTURED" })
        .where(eq(allocationTable.checkoutId, request.checkoutSnapshotId))
        .run();
    } else if (update.projectionStatus === "FAILED") {
      this.connection
        .update(allocationTable)
        .set({ status: "FAILED" })
        .where(
          and(
            eq(allocationTable.checkoutId, request.checkoutSnapshotId),
            inArray(allocationTable.status, [
              "CONFIRMATION_PENDING",
              "CONFIRMED"
            ])
          )
        )
        .run();
    }
    this.updateOrderState(request.orderId, update.orderState, update.now);
  }

  private assertPaymentState(update: PaymentStateUpdate): void {
    if (update.projectionStatus === "DEMO_CONFIRMED") {
      const receipt = update.receipt;
      if (
        update.settlementMode !== "mock" ||
        !receipt?.receiptId ||
        receipt.transactionHash !== "" ||
        receipt.explorerUrl !== "" ||
        !Number.isFinite(new Date(receipt.confirmedAt).getTime()) ||
        update.requestStatus !== "demo_confirmed" ||
        update.orderState !== "DEMO_CONFIRMED"
      ) {
        throw new Error("Mock payment evidence is incomplete.");
      }
    }
    if (update.projectionStatus === "CONFIRMED") {
      const receipt = update.receipt;
      let explorerIsHttps = false;
      try {
        explorerIsHttps =
          new URL(receipt?.explorerUrl ?? "").protocol === "https:";
      } catch {
        explorerIsHttps = false;
      }
      if (
        (update.settlementMode !== "testnet" &&
          update.settlementMode !== "live") ||
        !receipt?.receiptId ||
        !receipt.transactionHash ||
        !explorerIsHttps ||
        !Number.isFinite(new Date(receipt.confirmedAt).getTime()) ||
        update.requestStatus !== "confirmed" ||
        update.orderState !== "PAID"
      ) {
        throw new Error("Confirmed payment evidence is incomplete.");
      }
    }
    if (
      (update.requestStatus === "confirmed" || update.orderState === "PAID") &&
      update.projectionStatus !== "CONFIRMED"
    ) {
      throw new Error("Paid state requires a confirmed payment projection.");
    }
  }

  updatePaymentStateIfCurrent(
    paymentRequestId: string,
    operationId: string,
    allowedStatuses: PaymentProjectionStatus[],
    update: PaymentStateUpdate
  ): boolean {
    const projection = this.paymentProjectionByOperation(operationId);
    if (
      !projection ||
      projection.paymentRequestId !== paymentRequestId ||
      !allowedStatuses.includes(projection.status)
    ) {
      return false;
    }
    this.updatePaymentState(paymentRequestId, update);
    return true;
  }
}

export class OrderRepository {
  constructor(private readonly database: PoolMateDatabase) {}

  read<T>(operation: (transaction: OrderTransaction) => T): T {
    return this.database.ormRead((connection) =>
      operation(new OrderTransaction(connection))
    );
  }

  immediate<T>(operation: (transaction: OrderTransaction) => T): T {
    return this.database.ormImmediate((connection) =>
      operation(new OrderTransaction(connection))
    );
  }
}
