import { DomainError } from "../domain/domainError.js";
import { MOCK_MERCHANT_ID } from "../infrastructure/merchant/index.js";
import type { OrderService } from "../application/orderService.js";
import type {
  PoolMateBotUseCases,
  QuotePoolFromBotResult,
  RemindPoolFromBotResult
} from "./poolMateBotUseCases.js";

export class OrderServiceBotUseCases implements PoolMateBotUseCases {
  constructor(private readonly orders: OrderService) {}

  async createPool(input: Parameters<PoolMateBotUseCases["createPool"]>[0]) {
    const group = this.orders.createGroup({
      telegramChatId: input.telegramChatId,
      title: input.telegramChatTitle
    });
    const order = this.orders.createOrder({
      groupId: group.id,
      ownerUserId: input.actor.userId,
      title: input.title,
      targetUnits: input.targetUnits,
      sourceIdempotencyKey: input.sourceIdempotencyKey
    });
    return this.orders.publishOrder(order.id);
  }

  async claimPool(input: Parameters<PoolMateBotUseCases["claimPool"]>[0]) {
    this.requireOrderChat(input.orderId, input.telegramChatId);
    return this.orders.claimOrder(input.orderId, {
      userId: input.actor.userId,
      displayName: input.actor.displayName,
      units: input.units,
      sourceIdempotencyKey: input.sourceIdempotencyKey
    });
  }

  async leavePool(input: Parameters<PoolMateBotUseCases["leavePool"]>[0]) {
    this.requireOrderChat(input.orderId, input.telegramChatId);
    return this.orders.leaveOrder(
      input.orderId,
      input.actor.userId,
      input.sourceIdempotencyKey
    );
  }

  async quotePool(
    input: Parameters<PoolMateBotUseCases["quotePool"]>[0]
  ): Promise<QuotePoolFromBotResult> {
    this.requireOrderChat(input.orderId, input.telegramChatId);
    if (!this.orders.isOrderOwner(input.orderId, input.requestedByUserId)) {
      throw new DomainError(
        "FORBIDDEN",
        "Only the order owner can request the final quote.",
        403
      );
    }
    const result = await this.orders.finalizeCheckout(
      input.orderId,
      { merchantId: MOCK_MERCHANT_ID },
      input.sourceIdempotencyKey
    );
    const privateParticipants = new Map(
      this.orders
        .getPrivateParticipants(input.orderId)
        .map((participant) => [participant.id, participant])
    );
    return {
      order: result.order,
      confirmationDeliveries: result.confirmationLinks.map((link) => {
        const participant = privateParticipants.get(link.participantId);
        if (!participant) {
          throw new DomainError(
            "PARTICIPANT_NOT_FOUND",
            "Confirmation participant not found.",
            409
          );
        }
        return {
          participantId: link.participantId,
          displayName: link.displayName,
          telegramUserId: participant.userId,
          url: link.url
        };
      })
    };
  }

  async remindPool(
    input: Parameters<PoolMateBotUseCases["remindPool"]>[0]
  ): Promise<RemindPoolFromBotResult> {
    this.requireOrderChat(input.orderId, input.telegramChatId);
    return this.orders.reissuePendingConfirmations(
      input.orderId,
      input.requestedByUserId,
      input.sourceIdempotencyKey
    );
  }

  private requireOrderChat(orderId: string, telegramChatId: string): void {
    if (!this.orders.isOrderInTelegramChat(orderId, telegramChatId)) {
      throw new DomainError(
        "FORBIDDEN",
        "This order belongs to another Telegram group.",
        403
      );
    }
  }
}
