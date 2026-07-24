import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  CheckoutItemView,
  CheckoutView,
  ClaimOrderRequest,
  ConfirmationResult,
  ConfirmationView,
  CreateGroupRequest,
  CreateOrderRequest,
  FinalizeCheckoutRequest,
  FinalizeCheckoutResult,
  GroupView,
  OrderDetailView,
  OrderState,
  OrderSummaryView,
  ParticipantView,
  PaymentOutboxView,
  PaymentProjectionView,
  PoolMatePaymentRequest,
  UpdateClaimRequest
} from "@poolmate/shared";
import { allocateExactly, parseAtomicAmount } from "../domain/allocation.js";
import { hashCheckout } from "../domain/checkoutHash.js";
import { DomainError } from "../domain/domainError.js";
import type {
  CheckoutRow,
  ConfirmationLookupRow,
  OrderRow,
  OrderTransaction,
  ParticipantRow,
  PaymentOutboxRow,
  PaymentProjectionRow,
  PaymentRequestRow
} from "../infrastructure/db/orderRepository.js";
import { OrderRepository } from "../infrastructure/db/orderRepository.js";
import type {
  MerchantQuote,
  MerchantQuoteProvider
} from "./ports/merchantQuoteProvider.js";

export interface OrderServiceOptions {
  repository: OrderRepository;
  merchantQuoteProvider: MerchantQuoteProvider;
  publicBaseUrl: string;
  payerRef: string;
  now?: () => Date;
  createId?: () => string;
  createToken?: () => string;
}

interface PrivateConfirmationDelivery {
  participantId: string;
  displayName: string;
  telegramUserId: string;
  url: string;
}

function stableDigest(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}

function stableId(prefix: string, material: string): string {
  return `${prefix}_${stableDigest(material).slice(0, 24)}`;
}

function tokenHash(token: string): string {
  return stableDigest(`poolmate-confirmation:${token}`);
}

function confirmationUrl(publicBaseUrl: string, token: string): string {
  const url = new URL("/confirm", publicBaseUrl);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DomainError(
      "INVALID_REQUEST",
      `${field} must be a positive safe integer.`,
      400
    );
  }
}

function requireText(value: string, field: string, maxLength = 120): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new DomainError(
      "INVALID_REQUEST",
      `${field} must contain 1-${maxLength} characters.`,
      400
    );
  }
  return normalized;
}

function requireAtomic(value: string, field: string): bigint {
  try {
    return parseAtomicAmount(value);
  } catch {
    throw new DomainError(
      "INVALID_CHECKOUT",
      `${field} must be a non-negative atomic integer string.`,
      422
    );
  }
}

function validateQuote(
  quote: MerchantQuote,
  expectedMerchantId: string,
  expectedUnits: number,
  now: Date
): MerchantQuote {
  if (!quote.merchant.verified || quote.merchant.id !== expectedMerchantId) {
    throw new DomainError(
      "MERCHANT_NOT_VERIFIED",
      "The merchant is not verified.",
      422
    );
  }

  const checkoutId = requireText(quote.checkoutId, "checkoutId", 160);
  const assetId = requireText(quote.assetId, "assetId", 64);
  const quoteReference = requireText(
    quote.quoteReference,
    "quoteReference",
    256
  );
  const merchant = {
    id: requireText(quote.merchant.id, "merchantId", 64),
    displayName: requireText(
      quote.merchant.displayName,
      "merchantDisplayName",
      120
    ),
    payeeId: requireText(quote.merchant.payeeId, "payeeId", 128),
    verified: true as const
  };
  if (!Array.isArray(quote.items) || quote.items.length === 0) {
    throw new DomainError(
      "INVALID_CHECKOUT",
      "A checkout requires at least one item.",
      422
    );
  }

  const seenSkus = new Set<string>();
  let itemUnits = 0n;
  let calculatedGoods = 0n;
  const items: CheckoutItemView[] = quote.items.map((item) => {
    const sku = requireText(item.sku, "item.sku", 120);
    if (seenSkus.has(sku)) {
      throw new DomainError(
        "INVALID_CHECKOUT",
        "Checkout item SKUs must be unique.",
        422
      );
    }
    seenSkus.add(sku);
    const name = requireText(item.name, "item.name", 160);
    const quantity = requireAtomic(item.quantity, "item.quantity");
    const unitAmount = requireAtomic(
      item.unitAmountAtomic,
      "item.unitAmountAtomic"
    );
    if (quantity <= 0n) {
      throw new DomainError(
        "INVALID_CHECKOUT",
        "Checkout item quantities must be positive.",
        422
      );
    }
    itemUnits += quantity;
    calculatedGoods += quantity * unitAmount;
    return {
      sku,
      name,
      quantity: quantity.toString(),
      unitAmountAtomic: unitAmount.toString()
    };
  });
  if (itemUnits !== BigInt(expectedUnits)) {
    throw new DomainError(
      "INVALID_CHECKOUT",
      "Checkout item quantities do not match the locked order units.",
      422
    );
  }

  const goods = requireAtomic(quote.goodsAmountAtomic, "goodsAmountAtomic");
  const shipping = requireAtomic(
    quote.shippingAmountAtomic,
    "shippingAmountAtomic"
  );
  const discount = requireAtomic(
    quote.discountAmountAtomic,
    "discountAmountAtomic"
  );
  const fee = requireAtomic(quote.feeAmountAtomic, "feeAmountAtomic");
  const total = requireAtomic(quote.totalAmountAtomic, "totalAmountAtomic");
  if (
    goods !== calculatedGoods ||
    total <= 0n ||
    goods + shipping + fee - discount !== total
  ) {
    throw new DomainError(
      "INVALID_CHECKOUT",
      "Checkout atomic amounts do not balance.",
      422
    );
  }

  const expiresAtMs = new Date(quote.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    throw new DomainError(
      "CHECKOUT_EXPIRED",
      "The merchant quote is already expired.",
      422
    );
  }

  return {
    checkoutId,
    merchant,
    items,
    assetId,
    goodsAmountAtomic: goods.toString(),
    shippingAmountAtomic: shipping.toString(),
    discountAmountAtomic: discount.toString(),
    feeAmountAtomic: fee.toString(),
    totalAmountAtomic: total.toString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    quoteReference
  };
}

function publicGroup(row: {
  id: string;
  title: string;
  createdAt: string;
}): GroupView {
  return { id: row.id, title: row.title, createdAt: row.createdAt };
}

function publicParticipant(row: ParticipantRow): ParticipantView {
  return {
    id: row.id,
    displayName: row.displayName,
    units: row.units,
    joinedAt: row.joinedAt
  };
}

function publicPaymentRequest(row: PaymentRequestRow): PoolMatePaymentRequest {
  return {
    id: row.id,
    orderId: row.orderId,
    checkoutId: row.checkoutId,
    checkoutVersion: row.checkoutVersion,
    checkoutHash: row.checkoutHash,
    confirmationSetId: row.confirmationSetId,
    idempotencyKey: row.idempotencyKey,
    payerRef: row.payerRef,
    payeeId: row.payeeId,
    money: { assetId: row.assetId, amountAtomic: row.amountAtomic },
    expiresAt: row.expiresAt,
    status: row.status,
    createdAt: row.createdAt
  };
}

function publicPaymentProjection(
  row: PaymentProjectionRow
): PaymentProjectionView {
  const hasReceipt =
    row.receiptId && row.transactionHash && row.explorerUrl && row.confirmedAt;
  return {
    paymentRequestId: row.paymentRequestId,
    operationId: row.operationId,
    status: row.status,
    settlementMode: row.settlementMode,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    ...(hasReceipt
      ? {
          receipt: {
            receiptId: row.receiptId!,
            transactionHash: row.transactionHash!,
            explorerUrl: row.explorerUrl!,
            confirmedAt: row.confirmedAt!
          }
        }
      : {}),
    attempts: row.attempts,
    updatedAt: row.updatedAt
  };
}

function publicPaymentOutbox(row: PaymentOutboxRow): PaymentOutboxView {
  return {
    id: row.id,
    paymentRequestId: row.paymentRequestId,
    operationId: row.operationId,
    status: row.status,
    attempts: row.attempts,
    ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
    availableAt: row.availableAt,
    updatedAt: row.updatedAt
  };
}

export class OrderService {
  private readonly repository: OrderRepository;
  private readonly merchantQuoteProvider: MerchantQuoteProvider;
  private readonly publicBaseUrl: string;
  private readonly payerRef: string;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly createToken: () => string;

  constructor(options: OrderServiceOptions) {
    this.repository = options.repository;
    this.merchantQuoteProvider = options.merchantQuoteProvider;
    this.publicBaseUrl = options.publicBaseUrl;
    this.payerRef = requireText(options.payerRef, "payerRef", 128);
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.createToken =
      options.createToken ?? (() => randomBytes(32).toString("base64url"));
  }

  createGroup(request: CreateGroupRequest): GroupView {
    const telegramChatId = requireText(
      request.telegramChatId,
      "telegramChatId",
      64
    );
    const title = requireText(request.title, "title");
    const now = this.now().toISOString();
    return this.repository.immediate((transaction) =>
      publicGroup(
        transaction.upsertGroup({
          id: this.createId(),
          telegramChatId,
          title,
          now
        })
      )
    );
  }

  createOrder(request: CreateOrderRequest): OrderDetailView {
    requirePositiveInteger(request.targetUnits, "targetUnits");
    const groupId = requireText(request.groupId, "groupId", 64);
    const ownerUserId = requireText(request.ownerUserId, "ownerUserId", 64);
    const title = requireText(request.title, "title");
    const sourceIdempotencyKey = request.sourceIdempotencyKey
      ? requireText(request.sourceIdempotencyKey, "sourceIdempotencyKey", 160)
      : null;
    const requestHash = stableDigest(
      JSON.stringify({
        operation: "create-order-v1",
        groupId,
        ownerUserId,
        title,
        targetUnits: request.targetUnits
      })
    );
    const now = this.now().toISOString();
    return this.repository.immediate((transaction) => {
      if (!transaction.getGroup(groupId)) {
        throw new DomainError("GROUP_NOT_FOUND", "Group not found.", 404);
      }
      const order = transaction.insertOrder({
        id: this.createId(),
        groupId,
        ownerUserId,
        title,
        state: "DRAFT",
        fundingMode: "sponsored_demo",
        targetUnits: request.targetUnits,
        sourceIdempotencyKey,
        requestHash,
        createdAt: now,
        updatedAt: now
      });
      const persistedRequestHash =
        order.requestHash ??
        stableDigest(
          JSON.stringify({
            operation: "create-order-v1",
            groupId: order.groupId,
            ownerUserId: order.ownerUserId,
            title: order.title,
            targetUnits: order.targetUnits
          })
        );
      if (persistedRequestHash !== requestHash) {
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used for a different create-order request."
        );
      }
      if (order.requestHash === null) {
        transaction.claimOrderRequestHash(order.id, requestHash);
      }
      return this.detail(transaction, order);
    });
  }

  publishOrder(orderId: string): OrderDetailView {
    const now = this.now().toISOString();
    return this.repository.immediate((transaction) => {
      const order = this.requireOrder(transaction, orderId);
      if (order.state === "DRAFT") {
        transaction.updateOrderState(order.id, "COLLECTING", now);
      } else if (!this.claimableState(order.state)) {
        throw new DomainError(
          "INVALID_ORDER_STATE",
          "Only draft or collecting orders can be published."
        );
      }
      return this.detail(transaction, this.requireOrder(transaction, order.id));
    });
  }

  claimOrder(orderId: string, request: ClaimOrderRequest): OrderDetailView {
    requirePositiveInteger(request.units, "units");
    const userId = requireText(request.userId, "userId", 64);
    const displayName = requireText(request.displayName, "displayName", 80);
    const sourceIdempotencyKey = request.sourceIdempotencyKey
      ? requireText(request.sourceIdempotencyKey, "sourceIdempotencyKey", 160)
      : null;
    const requestHash = stableDigest(
      JSON.stringify({
        operation: "claim",
        orderId,
        userId,
        displayName,
        units: request.units
      })
    );
    const now = this.now().toISOString();
    return this.repository.immediate((transaction) => {
      const replay = this.operationReplay(
        transaction,
        sourceIdempotencyKey,
        "claim",
        orderId,
        userId,
        requestHash
      );
      if (replay) return replay;
      const order = this.requireOrder(transaction, orderId);
      if (!this.claimableState(order.state)) {
        throw new DomainError(
          "INVALID_ORDER_STATE",
          "Claims are locked after checkout confirmation begins."
        );
      }
      const existing = transaction.getParticipantByUser(order.id, userId);
      const participants = transaction.participants(order.id);
      const currentWithoutUser = participants
        .filter((participant) => participant.userId !== userId)
        .reduce((sum, participant) => sum + participant.units, 0);
      const projected = currentWithoutUser + request.units;
      if (projected > order.targetUnits) {
        throw new DomainError(
          "CAPACITY_EXCEEDED",
          "The claim exceeds the remaining order capacity."
        );
      }
      transaction.upsertParticipant({
        id: existing?.id ?? this.createId(),
        orderId: order.id,
        userId,
        displayName,
        units: request.units,
        joinedAt: existing?.joinedAt ?? now,
        updatedAt: now
      });
      transaction.updateOrderState(
        order.id,
        projected === order.targetUnits ? "QUOTE_PENDING" : "COLLECTING",
        now
      );
      const result = this.detail(
        transaction,
        this.requireOrder(transaction, order.id)
      );
      this.recordOperation(
        transaction,
        sourceIdempotencyKey,
        "claim",
        orderId,
        userId,
        requestHash,
        result,
        now
      );
      return result;
    });
  }

  updateClaim(
    orderId: string,
    userId: string,
    request: UpdateClaimRequest
  ): OrderDetailView {
    const participant = this.repository.read((transaction) =>
      transaction.getParticipantByUser(orderId, userId)
    );
    if (!participant) {
      throw new DomainError(
        "PARTICIPANT_NOT_FOUND",
        "Participant not found.",
        404
      );
    }
    return this.claimOrder(orderId, {
      userId,
      displayName: participant.displayName,
      units: request.units,
      sourceIdempotencyKey: request.sourceIdempotencyKey
    });
  }

  leaveOrder(
    orderId: string,
    userId: string,
    sourceIdempotencyKey?: string
  ): OrderDetailView {
    const normalizedUserId = requireText(userId, "userId", 64);
    const normalizedSourceKey = sourceIdempotencyKey
      ? requireText(sourceIdempotencyKey, "sourceIdempotencyKey", 160)
      : null;
    const requestHash = stableDigest(
      JSON.stringify({ operation: "leave", orderId, userId: normalizedUserId })
    );
    const now = this.now().toISOString();
    return this.repository.immediate((transaction) => {
      const replay = this.operationReplay(
        transaction,
        normalizedSourceKey,
        "leave",
        orderId,
        normalizedUserId,
        requestHash
      );
      if (replay) return replay;
      const order = this.requireOrder(transaction, orderId);
      if (!this.claimableState(order.state)) {
        throw new DomainError(
          "INVALID_ORDER_STATE",
          "Participants cannot leave after checkout confirmation begins."
        );
      }
      transaction.deleteParticipant(order.id, normalizedUserId);
      transaction.updateOrderState(order.id, "COLLECTING", now);
      const result = this.detail(
        transaction,
        this.requireOrder(transaction, order.id)
      );
      this.recordOperation(
        transaction,
        normalizedSourceKey,
        "leave",
        orderId,
        normalizedUserId,
        requestHash,
        result,
        now
      );
      return result;
    });
  }

  async finalizeCheckout(
    orderId: string,
    request: FinalizeCheckoutRequest,
    sourceIdempotencyKey?: string
  ): Promise<FinalizeCheckoutResult> {
    const merchantId = requireText(request.merchantId, "merchantId", 64);
    const normalizedSourceKey = sourceIdempotencyKey
      ? requireText(sourceIdempotencyKey, "sourceIdempotencyKey", 160)
      : null;
    const requestHash = stableDigest(
      JSON.stringify({ operation: "finalize-checkout-v1", orderId, merchantId })
    );
    const snapshot = this.repository.immediate((transaction) => {
      const order = this.requireOrder(transaction, orderId);
      if (normalizedSourceKey) {
        const existing = transaction.checkoutBySourceKey(normalizedSourceKey);
        if (existing) {
          const persistedRequestHash =
            existing.requestHash ??
            stableDigest(
              JSON.stringify({
                operation: "finalize-checkout-v1",
                orderId: existing.orderId,
                merchantId: existing.merchantId
              })
            );
          if (persistedRequestHash !== requestHash) {
            throw new DomainError(
              "IDEMPOTENCY_CONFLICT",
              "The idempotency key was already used for a different checkout request."
            );
          }
          if (existing.requestHash === null) {
            transaction.claimCheckoutRequestHash(existing.id, requestHash);
          }
          return {
            order,
            participants: transaction.participants(order.id),
            duplicate: true
          };
        }
      }
      this.requireCheckoutState(order.state);
      return {
        order,
        participants: transaction.participants(order.id),
        duplicate: false
      };
    });
    if (snapshot.duplicate) {
      return { order: this.getOrder(orderId), confirmationLinks: [] };
    }
    const claimedUnits = snapshot.participants.reduce(
      (sum, participant) => sum + participant.units,
      0
    );
    if (claimedUnits !== snapshot.order.targetUnits) {
      throw new DomainError(
        "INVALID_ORDER_STATE",
        "Checkout requires the exact target units to be claimed."
      );
    }
    let receivedQuote: MerchantQuote;
    try {
      receivedQuote = await this.merchantQuoteProvider.getQuote({
        orderId: snapshot.order.id,
        merchantId,
        totalUnits: claimedUnits
      });
    } catch {
      throw new DomainError(
        "MERCHANT_NOT_VERIFIED",
        "The merchant quote could not be verified.",
        422
      );
    }
    const quote = validateQuote(
      receivedQuote,
      merchantId,
      claimedUnits,
      this.now()
    );

    const tokenByParticipant = new Map(
      snapshot.participants.map((participant) => [
        participant.id,
        this.createToken()
      ])
    );
    return this.repository.immediate((transaction) => {
      const order = this.requireOrder(transaction, orderId);
      if (normalizedSourceKey) {
        const existing = transaction.checkoutBySourceKey(normalizedSourceKey);
        if (existing) {
          const persistedRequestHash =
            existing.requestHash ??
            stableDigest(
              JSON.stringify({
                operation: "finalize-checkout-v1",
                orderId: existing.orderId,
                merchantId: existing.merchantId
              })
            );
          if (persistedRequestHash !== requestHash) {
            throw new DomainError(
              "IDEMPOTENCY_CONFLICT",
              "The idempotency key was already used for a different checkout request."
            );
          }
          if (existing.requestHash === null) {
            transaction.claimCheckoutRequestHash(existing.id, requestHash);
          }
          return {
            order: this.detail(transaction, order),
            confirmationLinks: []
          };
        }
      }
      this.requireCheckoutState(order.state);
      const participants = transaction.participants(order.id);
      const units = participants.reduce(
        (sum, participant) => sum + participant.units,
        0
      );
      if (units !== order.targetUnits) {
        throw new DomainError(
          "INVALID_ORDER_STATE",
          "Participant claims changed before checkout was saved."
        );
      }
      const allocations = allocateExactly(
        { assetId: quote.assetId, amountAtomic: quote.totalAmountAtomic },
        participants.map((participant) => ({
          id: participant.id,
          units: participant.units
        }))
      );
      const latest = transaction.latestCheckout(order.id);
      const version = (latest?.version ?? 0) + 1;
      const hash = hashCheckout({
        checkoutId: quote.checkoutId,
        orderId: order.id,
        version,
        merchant: quote.merchant,
        items: quote.items,
        assetId: quote.assetId,
        goodsAmountAtomic: quote.goodsAmountAtomic,
        shippingAmountAtomic: quote.shippingAmountAtomic,
        discountAmountAtomic: quote.discountAmountAtomic,
        feeAmountAtomic: quote.feeAmountAtomic,
        totalAmountAtomic: quote.totalAmountAtomic,
        expiresAt: quote.expiresAt,
        allocations
      });
      const now = this.now().toISOString();
      const checkoutId = quote.checkoutId;
      transaction.supersedeConfirmations(order.id, now);
      transaction.insertCheckout({
        id: checkoutId,
        orderId: order.id,
        version,
        hash: hash.value,
        merchantId: quote.merchant.id,
        merchantDisplayName: quote.merchant.displayName,
        payeeId: quote.merchant.payeeId,
        hashAlgorithm: hash.algorithm,
        canonicalizationVersion: hash.canonicalizationVersion,
        isCanonical: true,
        items: quote.items,
        assetId: quote.assetId,
        goodsAmountAtomic: quote.goodsAmountAtomic,
        shippingAmountAtomic: quote.shippingAmountAtomic,
        discountAmountAtomic: quote.discountAmountAtomic,
        feeAmountAtomic: quote.feeAmountAtomic,
        totalAmountAtomic: quote.totalAmountAtomic,
        expiresAt: quote.expiresAt,
        quoteReference: quote.quoteReference,
        sourceIdempotencyKey: normalizedSourceKey,
        requestHash,
        createdAt: now,
        allocations: allocations.map((allocation) => {
          const token = tokenByParticipant.get(allocation.participantId);
          if (!token) {
            throw new DomainError(
              "INVALID_ORDER_STATE",
              "Participant claims changed before checkout was saved."
            );
          }
          return {
            id: this.createId(),
            participantId: allocation.participantId,
            assetId: allocation.money.assetId,
            amountAtomic: allocation.money.amountAtomic,
            confirmationId: this.createId(),
            tokenHash: tokenHash(token)
          };
        })
      });
      transaction.updateOrderState(order.id, "CONFIRMATION_PENDING", now);
      const current = this.detail(
        transaction,
        this.requireOrder(transaction, order.id)
      );
      return {
        order: current,
        confirmationLinks: participants.map((participant) => ({
          participantId: participant.id,
          displayName: participant.displayName,
          url: confirmationUrl(
            this.publicBaseUrl,
            tokenByParticipant.get(participant.id)!
          )
        }))
      };
    });
  }

  listOrders(): OrderSummaryView[] {
    return this.repository.read((transaction) =>
      transaction.listOrders().map((order) => this.summary(transaction, order))
    );
  }

  getOrder(orderId: string): OrderDetailView {
    return this.repository.read((transaction) =>
      this.detail(transaction, this.requireOrder(transaction, orderId))
    );
  }

  getPrivateParticipants(orderId: string): ParticipantRow[] {
    return this.repository.read((transaction) => {
      this.requireOrder(transaction, orderId);
      return transaction.participants(orderId);
    });
  }

  isOrderOwner(orderId: string, userId: string): boolean {
    return this.repository.read((transaction) => {
      const order = this.requireOrder(transaction, orderId);
      return order.ownerUserId === userId;
    });
  }

  isOrderInTelegramChat(orderId: string, telegramChatId: string): boolean {
    const normalizedChatId = requireText(telegramChatId, "telegramChatId", 64);
    return this.repository.read((transaction) => {
      const order = this.requireOrder(transaction, orderId);
      const group = transaction.getGroup(order.groupId);
      return group?.telegramChatId === normalizedChatId;
    });
  }

  getGroupByChatId(telegramChatId: string): GroupView | undefined {
    return this.repository.read((transaction) => {
      const group = transaction.getGroupByChatId(telegramChatId);
      return group ? publicGroup(group) : undefined;
    });
  }

  getConfirmation(token: string): ConfirmationView {
    const normalizedToken = requireText(token, "confirmationToken", 256);
    return this.repository.read((transaction) => {
      const row = transaction.confirmationByTokenHash(
        tokenHash(normalizedToken)
      );
      if (!row) {
        throw new DomainError(
          "CONFIRMATION_NOT_FOUND",
          "Confirmation not found.",
          404
        );
      }
      return this.confirmationView(row);
    });
  }

  confirm(token: string, actorUserId: string): ConfirmationResult {
    return this.actOnConfirmation(token, actorUserId, "confirm");
  }

  decline(token: string, actorUserId: string): ConfirmationResult {
    return this.actOnConfirmation(token, actorUserId, "decline");
  }

  reissuePendingConfirmations(
    orderId: string,
    requestedByUserId: string,
    sourceIdempotencyKey?: string
  ): {
    order: OrderDetailView;
    confirmationDeliveries: PrivateConfirmationDelivery[];
  } {
    const ownerUserId = requireText(requestedByUserId, "requestedByUserId", 64);
    const normalizedSourceKey = sourceIdempotencyKey
      ? requireText(sourceIdempotencyKey, "sourceIdempotencyKey", 160)
      : null;
    const requestHash = stableDigest(
      JSON.stringify({ operation: "remind", orderId, ownerUserId })
    );
    const nowDate = this.now();
    const now = nowDate.toISOString();
    return this.repository.immediate((transaction) => {
      const replay = this.operationReplay(
        transaction,
        normalizedSourceKey,
        "remind",
        orderId,
        ownerUserId,
        requestHash
      );
      if (replay) {
        return { order: replay, confirmationDeliveries: [] };
      }

      const order = this.requireOrder(transaction, orderId);
      if (order.ownerUserId !== ownerUserId) {
        throw new DomainError(
          "FORBIDDEN",
          "Only the order owner can reissue confirmation links.",
          403
        );
      }
      if (order.state !== "CONFIRMATION_PENDING") {
        throw new DomainError(
          "INVALID_ORDER_STATE",
          "Confirmation links can only be reissued while confirmation is pending."
        );
      }
      const checkout = transaction.latestCheckout(order.id);
      if (!checkout) {
        throw new DomainError(
          "INVALID_ORDER_STATE",
          "The order does not have a current checkout."
        );
      }
      if (new Date(checkout.expiresAt).getTime() <= nowDate.getTime()) {
        throw new DomainError("CHECKOUT_EXPIRED", "This checkout has expired.");
      }

      const pending = transaction.pendingConfirmations(checkout.id);
      const confirmationDeliveries = pending.map((confirmation) => {
        const token = this.createToken();
        if (
          !transaction.rotateConfirmationToken(
            confirmation.confirmationId,
            tokenHash(token),
            now
          )
        ) {
          throw new DomainError(
            "INVALID_CONFIRMATION_STATE",
            "A pending confirmation changed while links were being reissued."
          );
        }
        return {
          participantId: confirmation.participantId,
          displayName: confirmation.displayName,
          telegramUserId: confirmation.userId,
          url: confirmationUrl(this.publicBaseUrl, token)
        };
      });
      const resultOrder = this.detail(
        transaction,
        this.requireOrder(transaction, order.id)
      );
      this.recordOperation(
        transaction,
        normalizedSourceKey,
        "remind",
        order.id,
        ownerUserId,
        requestHash,
        resultOrder,
        now
      );
      return { order: resultOrder, confirmationDeliveries };
    });
  }

  private actOnConfirmation(
    token: string,
    actorUserId: string,
    action: "confirm" | "decline"
  ): ConfirmationResult {
    const normalizedToken = requireText(token, "confirmationToken", 256);
    const normalizedActorUserId = requireText(actorUserId, "actorUserId", 64);
    const nowDate = this.now();
    const now = nowDate.toISOString();
    const result = this.repository.immediate<ConfirmationResult | DomainError>(
      (transaction) => {
        let row = transaction.confirmationByTokenHash(
          tokenHash(normalizedToken)
        );
        if (!row) {
          throw new DomainError(
            "CONFIRMATION_NOT_FOUND",
            "Confirmation not found.",
            404
          );
        }
        if (row.participantUserId !== normalizedActorUserId) {
          throw new DomainError(
            "CONFIRMATION_ACTOR_MISMATCH",
            "The verified Telegram user does not own this confirmation.",
            403
          );
        }
        if (row.confirmationStatus === "superseded") {
          throw new DomainError(
            "CONFIRMATION_SUPERSEDED",
            "A newer checkout version replaced this confirmation."
          );
        }
        if (
          row.confirmationStatus === "expired" ||
          new Date(row.expiresAt).getTime() <= nowDate.getTime()
        ) {
          transaction.expireConfirmation(row.confirmationId, now);
          return new DomainError(
            "CHECKOUT_EXPIRED",
            "This checkout has expired."
          );
        }
        if (
          row.confirmationStatus === "confirmed" ||
          row.confirmationStatus === "declined"
        ) {
          if (
            (action === "confirm" && row.confirmationStatus !== "confirmed") ||
            (action === "decline" && row.confirmationStatus !== "declined")
          ) {
            throw new DomainError(
              "INVALID_CONFIRMATION_STATE",
              `This confirmation was already ${row.confirmationStatus}.`
            );
          }
          return {
            confirmation: this.confirmationView(row),
            orderState: row.orderState,
            paymentRequestCreated: false
          };
        }

        if (row.orderState !== "CONFIRMATION_PENDING") {
          throw new DomainError(
            "INVALID_ORDER_STATE",
            "The order is not accepting confirmations."
          );
        }
        const latest = transaction.latestCheckout(row.orderId);
        if (!latest || latest.id !== row.id || latest.hash !== row.hash) {
          transaction.supersedeConfirmations(row.orderId, now);
          return new DomainError(
            "CONFIRMATION_SUPERSEDED",
            "A newer checkout version replaced this confirmation."
          );
        }

        if (action === "decline") {
          if (
            !transaction.decline(row.confirmationId, normalizedActorUserId, now)
          ) {
            throw new DomainError(
              "INVALID_CONFIRMATION_STATE",
              "The confirmation changed before the decline was recorded."
            );
          }
          row = transaction.confirmationByTokenHash(
            tokenHash(normalizedToken)
          )!;
          return {
            confirmation: this.confirmationView(row),
            orderState: this.requireOrder(transaction, row.orderId).state,
            paymentRequestCreated: false
          };
        }

        if (
          !transaction.confirm(row.confirmationId, normalizedActorUserId, now)
        ) {
          throw new DomainError(
            "INVALID_CONFIRMATION_STATE",
            "The confirmation changed before it was recorded."
          );
        }
        let paymentRequestCreated = false;
        if (transaction.allConfirmationsConfirmed(row.id)) {
          const confirmationSetId = transaction.ensureConfirmationSet({
            id: stableId("pmcs", `${row.orderId}:${row.id}:${row.hash}`),
            orderId: row.orderId,
            checkoutId: row.id,
            now
          });
          const idempotencyKey = stableDigest(
            `poolmate-payment:${row.orderId}:${row.version}:${row.hash}`
          );
          const paymentRequestId = stableId("pmpr", idempotencyKey);
          paymentRequestCreated = transaction.ensurePaymentWorkflow({
            paymentRequest: {
              id: paymentRequestId,
              orderId: row.orderId,
              checkoutId: row.id,
              checkoutVersion: row.version,
              checkoutHash: row.hash,
              confirmationSetId,
              idempotencyKey,
              payerRef: this.payerRef,
              payeeId: row.payeeId,
              assetId: row.assetId,
              amountAtomic: row.totalAmountAtomic,
              expiresAt: row.expiresAt,
              status: "ready",
              createdAt: now,
              updatedAt: now
            },
            // The operation identity is derived only from the immutable payment key.
            operationId: `pmop_${idempotencyKey}`,
            outboxId: `pmob_${paymentRequestId}`,
            now
          });
          transaction.updateOrderState(row.orderId, "READY_FOR_PAYMENT", now);
        }
        row = transaction.confirmationByTokenHash(tokenHash(normalizedToken))!;
        return {
          confirmation: this.confirmationView(row),
          orderState: this.requireOrder(transaction, row.orderId).state,
          paymentRequestCreated
        };
      }
    );
    if (result instanceof DomainError) throw result;
    return result;
  }

  private operationReplay(
    transaction: OrderTransaction,
    key: string | null,
    operation: "claim" | "leave" | "remind",
    orderId: string,
    actorUserId: string,
    requestHash: string
  ): OrderDetailView | undefined {
    if (!key) return undefined;
    const existing = transaction.operationIdempotency(key);
    if (!existing) return undefined;
    if (
      existing.operation !== operation ||
      existing.orderId !== orderId ||
      existing.actorUserId !== actorUserId ||
      existing.requestHash !== requestHash
    ) {
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different operation."
      );
    }
    return existing.result;
  }

  private recordOperation(
    transaction: OrderTransaction,
    key: string | null,
    operation: "claim" | "leave" | "remind",
    orderId: string,
    actorUserId: string,
    requestHash: string,
    result: OrderDetailView,
    now: string
  ): void {
    if (!key) return;
    transaction.insertOperationIdempotency({
      idempotencyKey: key,
      operation,
      orderId,
      actorUserId,
      requestHash,
      result,
      createdAt: now
    });
  }

  private claimableState(state: OrderState): boolean {
    return state === "COLLECTING";
  }

  private requireCheckoutState(state: OrderState): void {
    if (state !== "QUOTE_PENDING" && state !== "CONFIRMATION_PENDING") {
      throw new DomainError(
        "INVALID_ORDER_STATE",
        "Checkout requires a fully claimed order."
      );
    }
  }

  private requireOrder(
    transaction: OrderTransaction,
    orderId: string
  ): OrderRow {
    const order = transaction.getOrder(orderId);
    if (!order) {
      throw new DomainError("ORDER_NOT_FOUND", "Order not found.", 404);
    }
    return order;
  }

  private summary(
    transaction: OrderTransaction,
    order: OrderRow
  ): OrderSummaryView {
    const group = transaction.getGroup(order.groupId);
    if (!group) {
      throw new DomainError("GROUP_NOT_FOUND", "Group not found.", 404);
    }
    const participants = transaction.participants(order.id);
    const checkout = transaction.latestCanonicalCheckout(order.id);
    return {
      id: order.id,
      title: order.title,
      group: publicGroup(group),
      state: order.state,
      fundingMode: order.fundingMode,
      targetUnits: order.targetUnits,
      claimedUnits: participants.reduce(
        (sum, participant) => sum + participant.units,
        0
      ),
      participantCount: participants.length,
      ...(checkout
        ? { checkoutVersion: checkout.version, expiresAt: checkout.expiresAt }
        : {}),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    };
  }

  private detail(
    transaction: OrderTransaction,
    order: OrderRow
  ): OrderDetailView {
    const summary = this.summary(transaction, order);
    const participants = transaction.participants(order.id);
    const checkout = transaction.latestCanonicalCheckout(order.id);
    const paymentRequest = transaction.paymentRequest(order.id);
    const paymentProjection = paymentRequest
      ? transaction.paymentProjection(paymentRequest.id)
      : undefined;
    const paymentOutbox = paymentRequest
      ? transaction.paymentOutbox(paymentRequest.id)
      : undefined;
    return {
      ...summary,
      participants: participants.map(publicParticipant),
      ...(checkout
        ? { checkout: this.checkoutView(transaction, checkout) }
        : {}),
      ...(paymentRequest
        ? { paymentRequest: publicPaymentRequest(paymentRequest) }
        : {}),
      ...(paymentProjection
        ? { paymentProjection: publicPaymentProjection(paymentProjection) }
        : {}),
      ...(paymentOutbox
        ? { paymentOutbox: publicPaymentOutbox(paymentOutbox) }
        : {})
    };
  }

  private checkoutView(
    transaction: OrderTransaction,
    checkout: CheckoutRow
  ): CheckoutView {
    return {
      id: checkout.id,
      version: checkout.version,
      hash: {
        algorithm: checkout.hashAlgorithm,
        canonicalizationVersion: checkout.canonicalizationVersion,
        value: checkout.hash
      },
      merchant: {
        id: checkout.merchantId,
        displayName: checkout.merchantDisplayName,
        payeeId: checkout.payeeId,
        verified: true
      },
      items: checkout.items,
      goods: {
        assetId: checkout.assetId,
        amountAtomic: checkout.goodsAmountAtomic
      },
      shipping: {
        assetId: checkout.assetId,
        amountAtomic: checkout.shippingAmountAtomic
      },
      discount: {
        assetId: checkout.assetId,
        amountAtomic: checkout.discountAmountAtomic
      },
      fee: {
        assetId: checkout.assetId,
        amountAtomic: checkout.feeAmountAtomic
      },
      total: {
        assetId: checkout.assetId,
        amountAtomic: checkout.totalAmountAtomic
      },
      expiresAt: checkout.expiresAt,
      createdAt: checkout.createdAt,
      allocations: transaction.allocations(checkout.id).map((allocation) => ({
        participantId: allocation.participantId,
        displayName: allocation.displayName,
        units: allocation.units,
        money: {
          assetId: allocation.assetId,
          amountAtomic: allocation.amountAtomic
        },
        confirmationStatus: allocation.confirmationStatus,
        ...(allocation.confirmedAt
          ? { confirmedAt: allocation.confirmedAt }
          : {})
      }))
    };
  }

  private confirmationView(row: ConfirmationLookupRow): ConfirmationView {
    const expired =
      row.confirmationStatus === "pending" &&
      new Date(row.expiresAt).getTime() <= this.now().getTime();
    return {
      orderId: row.orderId,
      orderTitle: row.orderTitle,
      participantDisplayName: row.participantDisplayName,
      participantUnits: row.participantUnits,
      checkoutVersion: row.version,
      checkoutHash: {
        algorithm: row.hashAlgorithm,
        canonicalizationVersion: row.canonicalizationVersion,
        value: row.hash
      },
      merchant: {
        id: row.merchantId,
        displayName: row.merchantDisplayName,
        payeeId: row.payeeId,
        verified: true
      },
      items: row.items,
      goods: {
        assetId: row.assetId,
        amountAtomic: row.goodsAmountAtomic
      },
      shipping: {
        assetId: row.assetId,
        amountAtomic: row.shippingAmountAtomic
      },
      discount: {
        assetId: row.assetId,
        amountAtomic: row.discountAmountAtomic
      },
      fee: {
        assetId: row.assetId,
        amountAtomic: row.feeAmountAtomic
      },
      orderTotal: {
        assetId: row.assetId,
        amountAtomic: row.totalAmountAtomic
      },
      money: {
        assetId: row.assetId,
        amountAtomic: row.allocationAmountAtomic
      },
      expiresAt: row.expiresAt,
      status: expired ? "expired" : row.confirmationStatus,
      ...(row.confirmedAt ? { confirmedAt: row.confirmedAt } : {})
    };
  }
}

export type { PrivateConfirmationDelivery };
