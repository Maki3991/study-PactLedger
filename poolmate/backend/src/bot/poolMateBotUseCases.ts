import type { OrderDetailView } from "@poolmate/shared";

export interface PoolMateBotActor {
  userId: string;
  displayName: string;
}

export interface CreatePoolFromBotInput {
  sourceIdempotencyKey: string;
  telegramChatId: string;
  telegramChatTitle: string;
  actor: PoolMateBotActor;
  title: string;
  targetUnits: number;
}

export type CreateDraftFromBotInput = CreatePoolFromBotInput;

export interface DraftActionFromBotInput {
  sourceIdempotencyKey: string;
  telegramChatId: string;
  orderId: string;
  actor: PoolMateBotActor;
}

export interface ClaimPoolFromBotInput {
  sourceIdempotencyKey: string;
  telegramChatId: string;
  orderId: string;
  actor: PoolMateBotActor;
  units: number;
}

export interface LeavePoolFromBotInput {
  sourceIdempotencyKey: string;
  telegramChatId: string;
  orderId: string;
  actor: PoolMateBotActor;
}

export interface ClosePoolFromBotInput {
  sourceIdempotencyKey: string;
  telegramChatId: string;
  orderId: string;
  actor: PoolMateBotActor;
}

export interface QuotePoolFromBotInput {
  sourceIdempotencyKey: string;
  telegramChatId: string;
  orderId: string;
  requestedByUserId: string;
}

export interface ConfirmationDelivery {
  participantId: string;
  displayName: string;
  telegramUserId: string;
  url: string;
}

export interface QuotePoolFromBotResult {
  order: OrderDetailView;
  confirmationDeliveries: ConfirmationDelivery[];
}

export interface RemindPoolFromBotInput {
  sourceIdempotencyKey: string;
  telegramChatId: string;
  orderId: string;
  requestedByUserId: string;
}

export interface RemindPoolFromBotResult {
  order: OrderDetailView;
  confirmationDeliveries: ConfirmationDelivery[];
}

export interface GetPoolFromBotInput {
  telegramChatId: string;
  orderId: string;
}

export interface PoolMateBotUseCases {
  createDraft(input: CreateDraftFromBotInput): Promise<OrderDetailView>;
  publishDraft(input: DraftActionFromBotInput): Promise<OrderDetailView>;
  discardDraft(input: DraftActionFromBotInput): Promise<OrderDetailView>;
  createPool(input: CreatePoolFromBotInput): Promise<OrderDetailView>;
  claimPool(input: ClaimPoolFromBotInput): Promise<OrderDetailView>;
  leavePool(input: LeavePoolFromBotInput): Promise<OrderDetailView>;
  closePool(input: ClosePoolFromBotInput): Promise<OrderDetailView>;
  quotePool(input: QuotePoolFromBotInput): Promise<QuotePoolFromBotResult>;
  remindPool(input: RemindPoolFromBotInput): Promise<RemindPoolFromBotResult>;
  getPool(input: GetPoolFromBotInput): Promise<OrderDetailView>;
}
