import { InlineKeyboard, type Bot } from "grammy";
import type { OrderDetailView, OrderIntentView } from "@poolmate/shared";
import {
  type OrderDraftExtractor,
  OrderDraftExtractorError
} from "../../../application/ports/orderDraftExtractor.js";
import {
  formatGeneralHelp,
  formatSkillHelp,
  invokeCommandSkill
} from "../../help/commandSkillHelp.js";
import {
  CommandSkillInvokerError,
  type CommandSkillInvoker
} from "../../help/commandSkillInvoker.js";
import {
  parsePoolMateCallbackData,
  type PoolMateCallbackData
} from "../../callbackData.js";
import {
  telegramCallbackIdempotencyKey,
  telegramUpdateIdempotencyKey
} from "../../idempotency.js";
import {
  parseNewPoolCommand,
  parseOrderCommand,
  parsePoolTestCommand,
  parseOrderUnitsCommand
} from "../../poolCommands.js";
import type {
  PoolMateBotActor,
  PoolMateBotUseCases,
  QuotePoolFromBotResult,
  RemindPoolFromBotResult
} from "../../poolMateBotUseCases.js";
import { formatPaymentStatus } from "../../formatter.js";
import { collectingOrderKeyboard } from "../keyboards.js";
import type { PoolMateContext } from "../context.js";
import { ORDER_INTENT_SCHEMA_VERSION } from "../../../domain/orderIntent.js";

export interface PoolHandlerDependencies {
  useCases: PoolMateBotUseCases;
  draftExtractor?: OrderDraftExtractor;
  commandSkillInvoker?: CommandSkillInvoker;
}

function actor(context: PoolMateContext): PoolMateBotActor {
  const from = context.from;
  if (!from) throw new Error("Telegram user identity is required.");
  const displayName = [from.first_name, from.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    userId: String(from.id),
    displayName: displayName || from.username || `user-${from.id}`
  };
}

function orderMessage(prefix: string, order: OrderDetailView): string {
  return [
    prefix,
    `Order: ${order.id}`,
    `Title: ${order.title}`,
    `State: ${order.state}`,
    `Claims: ${order.claimedUnits}/${order.targetUnits}`
  ].join("\n");
}

const VIRTUAL_DISPLAY_PATTERN = /^Virtual #(\d{3})$/;

function virtualSlotLabel(slot: number): string {
  return String(slot).padStart(3, "0");
}

function virtualActor(slot: number): PoolMateBotActor {
  const label = virtualSlotLabel(slot);
  return {
    userId: `poolmate-virtual-${label}`,
    displayName: `Virtual #${label}`
  };
}

function virtualSlots(order: OrderDetailView): number[] {
  return order.participants
    .map((participant) => {
      const match = VIRTUAL_DISPLAY_PATTERN.exec(participant.displayName);
      return match ? Number(match[1]) : undefined;
    })
    .filter((slot): slot is number => Number.isSafeInteger(slot))
    .sort((left, right) => left - right);
}

function nextVirtualSlots(order: OrderDetailView, count: number): number[] {
  const used = new Set(virtualSlots(order));
  const slots: number[] = [];
  for (let slot = 1; slots.length < count; slot += 1) {
    if (!used.has(slot)) slots.push(slot);
  }
  return slots;
}

function removableVirtualSlots(
  order: OrderDetailView,
  count: number
): number[] {
  return virtualSlots(order).slice(-count).reverse();
}

function collectingKeyboardOptions(order: OrderDetailView) {
  return order.state === "COLLECTING"
    ? { reply_markup: collectingOrderKeyboard(order.id) }
    : {};
}

function orderIntent(
  originalText: string,
  source: OrderIntentView["source"],
  input: {
    itemName: string;
    targetUnits: number;
    unit?: string | null;
    purchaseChannelHint?: string | null;
    storeNameHint?: string | null;
    merchantLinkHint?: string | null;
    userPriceHint?: string | null;
  }
): OrderIntentView {
  return {
    schemaVersion: ORDER_INTENT_SCHEMA_VERSION,
    originalText,
    source,
    items: [
      {
        name: input.itemName,
        quantity: input.targetUnits,
        ...(input.unit ? { unit: input.unit } : {})
      }
    ],
    ...(input.purchaseChannelHint
      ? { purchaseChannelHint: input.purchaseChannelHint }
      : {}),
    ...(input.storeNameHint ? { storeNameHint: input.storeNameHint } : {}),
    ...(input.merchantLinkHint
      ? { merchantLinkHint: input.merchantLinkHint }
      : {}),
    ...(input.userPriceHint ? { userPriceHint: input.userPriceHint } : {})
  };
}

function intentQuantity(order: OrderDetailView): string {
  const intent = order.intent;
  const item = intent?.items[0];
  return item
    ? `${item.quantity}${item.unit ? ` ${item.unit}` : " units"}`
    : `${order.targetUnits} units`;
}

function purchaseIntentLines(order: OrderDetailView): string[] {
  const intent = order.intent;
  const item = intent?.items[0];
  return [
    `Requested item: ${item?.name ?? order.title}`,
    `Requested quantity: ${intentQuantity(order)}`,
    `Purchase channel preference: ${intent?.purchaseChannelHint ?? "Not specified"}`,
    `Store hint: ${intent?.storeNameHint ?? "Not specified"}`,
    `Merchant link hint: ${intent?.merchantLinkHint ?? "Not specified"}`,
    `User price reference: ${intent?.userPriceHint ?? "Not specified"}`
  ];
}

function processingCardMessage(input: {
  actorRef: string;
  startedAt: string;
  requestText: string;
}): string {
  return [
    "拼单请求处理中 / PoolMate request processing.",
    `Started by: ${input.actorRef}`,
    `Started at: ${input.startedAt}`,
    `Request: ${input.requestText}`,
    "LLM is extracting item, expected quantity, channel, store, and link.",
    "No checkout, confirmation, or payment exists yet."
  ].join("\n");
}

function collectingCardMessage(input: {
  order: OrderDetailView;
  actorRef: string;
  startedAt: string;
}): string {
  const { order } = input;
  const delta = order.claimedUnits - order.targetUnits;
  const quantityStatus =
    delta === 0
      ? "at expected quantity"
      : delta < 0
        ? `${Math.abs(delta)} under expected`
        : `${delta} over expected`;
  return [
    orderMessage("Pool is open for claims.", order),
    `Started by: ${input.actorRef}`,
    `Started at: ${input.startedAt}`,
    ...purchaseIntentLines(order),
    `Claimed now: ${order.claimedUnits}/${order.targetUnits} units (${quantityStatus}).`,
    "Current execution mode: Demo Merchant (Mock).",
    "The requested channel is preserved as user intent, but no live channel integration is implied.",
    "Other group members can claim now. The owner can request the final quote with fewer, exact, or more claimed units.",
    "Final merchant, payee, and amount will come only from a verified Checkout."
  ].join("\n");
}

function safeDisplayName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80) || "participant";
}

function actorReference(
  context: PoolMateContext,
  currentActor: PoolMateBotActor
): string {
  const username = context.from?.username;
  return username && /^[A-Za-z0-9_]{1,32}$/.test(username)
    ? `@${username}`
    : safeDisplayName(currentActor.displayName);
}

function groupChatId(context: PoolMateContext): string | null {
  const chat = context.chat;
  return chat?.type === "group" || chat?.type === "supergroup"
    ? String(chat.id)
    : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usernameMentionPattern(username: string): RegExp {
  return new RegExp(
    `(^|[^A-Za-z0-9_])@${escapeRegExp(username)}(?=$|[^A-Za-z0-9_])`,
    "gi"
  );
}

function mentionedOrderRequest(context: PoolMateContext): string | null {
  const message = context.message;
  const username = context.me.username;
  if (!message?.text || !username) return null;
  const text = message.text;
  const textMentionPattern = usernameMentionPattern(username);
  const textMentioned = textMentionPattern.test(text);
  const richMentionRanges = (message.entities ?? [])
    .filter(
      (entity) =>
        entity.type === "text_mention" && entity.user.id === context.me.id
    )
    .map((entity) => ({ offset: entity.offset, length: entity.length }))
    .sort((left, right) => right.offset - left.offset);

  if (!textMentioned && richMentionRanges.length === 0) return null;

  let requestText = text;
  for (const range of richMentionRanges) {
    requestText = `${requestText.slice(0, range.offset)} ${requestText.slice(
      range.offset + range.length
    )}`;
  }

  return requestText
    .replace(usernameMentionPattern(username), "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldNames(fields: string[]): string {
  return fields
    .map((field) => {
      if (field === "targetUnits") return "target quantity";
      if (field === "itemName") return "product";
      if (field === "purchaseChannelHint") return "purchase channel";
      if (field === "storeNameHint") return "store name";
      if (field === "merchantLinkHint") return "merchant link";
      if (field === "userPriceHint") return "reference price";
      return field;
    })
    .join(", ");
}

function messageStartedAt(context: PoolMateContext): string {
  const seconds = context.message?.date;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return new Date(seconds * 1_000).toISOString();
  }
  return new Date().toISOString();
}

async function editStatusCard(
  context: PoolMateContext,
  message: { chat: { id: number | string }; message_id: number },
  text: string,
  replyMarkup?: InlineKeyboard
): Promise<void> {
  const options = {
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    link_preview_options: { is_disabled: true }
  };
  try {
    await context.api.editMessageText(
      message.chat.id,
      message.message_id,
      text,
      options
    );
  } catch {
    await context.reply(text, options);
  }
}

function trustedConfirmationUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      !url.pathname.endsWith("/confirm")
    ) {
      return null;
    }
    const fragment = new URLSearchParams(url.hash.slice(1));
    const fragmentEntries = [...fragment.entries()];
    const token = fragment.get("token") ?? "";
    if (
      fragmentEntries.length !== 1 ||
      fragmentEntries[0]?.[0] !== "token" ||
      !token ||
      token.length > 256
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function deliverConfirmationLinks(
  context: PoolMateContext,
  result: QuotePoolFromBotResult | RemindPoolFromBotResult,
  deliveryKind: "quote" | "reminder"
): Promise<void> {
  const failures: string[] = [];
  const skipped: string[] = [];
  let delivered = 0;
  const pendingParticipantIds = new Set(
    (result.order.checkout?.allocations ?? [])
      .filter(
        (allocation) => String(allocation.confirmationStatus) === "pending"
      )
      .map((allocation) => allocation.participantId)
  );

  for (const delivery of result.confirmationDeliveries) {
    if (!pendingParticipantIds.has(delivery.participantId)) {
      skipped.push(safeDisplayName(delivery.displayName));
      continue;
    }
    const url = trustedConfirmationUrl(delivery.url);
    if (!url || !/^[1-9]\d*$/.test(delivery.telegramUserId)) {
      failures.push(safeDisplayName(delivery.displayName));
      continue;
    }

    try {
      await context.api.sendMessage(
        delivery.telegramUserId,
        `PoolMate checkout is ready for ${result.order.title}.`,
        {
          reply_markup: new InlineKeyboard().webApp(
            "Review and confirm",
            url.toString()
          ),
          link_preview_options: { is_disabled: true }
        }
      );
      delivered += 1;
    } catch {
      failures.push(safeDisplayName(delivery.displayName));
    }
  }

  const confirmationCounts = (result.order.checkout?.allocations ?? []).reduce(
    (counts, allocation) => {
      const status = String(allocation.confirmationStatus);
      if (status === "confirmed") counts.confirmed += 1;
      else if (status === "declined") counts.declined += 1;
      else if (status === "pending") counts.pending += 1;
      return counts;
    },
    { confirmed: 0, pending: 0, declined: 0 }
  );

  const summary = [
    deliveryKind === "quote"
      ? `Final quote v${result.order.checkout?.version ?? "unknown"} is ready.`
      : `Confirmation reminder v${result.order.checkout?.version ?? "unknown"} processed.`,
    `Confirmation links delivered: ${delivered}/${result.confirmationDeliveries.length}.`,
    `Confirmations: ${confirmationCounts.confirmed} confirmed, ${confirmationCounts.pending} pending, ${confirmationCounts.declined} declined.`,
    `Order state: ${result.order.state}.`
  ];
  if (failures.length) {
    summary.push(
      `Delivery failed for: ${failures.join(", ")}.`,
      "No payment status was changed by the delivery failure."
    );
  }
  if (skipped.length) {
    summary.push(`Not pending, so no link was sent to: ${skipped.join(", ")}.`);
  }
  if (confirmationCounts.declined > 0) {
    summary.push(
      "At least one participant declined. This order is not ready for payment."
    );
  }
  await context.reply(summary.join("\n"));
}

async function handleCallbackAction(
  context: PoolMateContext,
  useCases: PoolMateBotUseCases,
  data: PoolMateCallbackData
): Promise<void> {
  const callbackQueryId = context.callbackQuery?.id;
  if (!callbackQueryId) {
    throw new Error("Telegram callback query identity is required.");
  }
  const sourceIdempotencyKey = telegramCallbackIdempotencyKey(callbackQueryId);
  const currentActor = actor(context);
  const telegramChatId = groupChatId(context);
  if (!telegramChatId) {
    await context.answerCallbackQuery({
      text: "PoolMate order actions must be used in their Telegram group.",
      show_alert: true
    });
    return;
  }

  if (data.action === "claim") {
    const order = await useCases.claimPool({
      sourceIdempotencyKey,
      telegramChatId,
      orderId: data.orderId,
      actor: currentActor,
      units: data.units
    });
    await context.answerCallbackQuery({ text: "Claim recorded" });
    await context.reply(
      orderMessage(
        `${actorReference(context, currentActor)} updated their claim.`,
        order
      ),
      { reply_markup: collectingOrderKeyboard(order.id) }
    );
    return;
  }

  if (data.action === "leave") {
    const order = await useCases.leavePool({
      sourceIdempotencyKey,
      telegramChatId,
      orderId: data.orderId,
      actor: currentActor
    });
    await context.answerCallbackQuery({ text: "Claim removed" });
    await context.reply(
      orderMessage(
        `${actorReference(context, currentActor)} left the pool.`,
        order
      ),
      { reply_markup: collectingOrderKeyboard(order.id) }
    );
    return;
  }

  if (data.action === "close") {
    const order = await useCases.closePool({
      sourceIdempotencyKey,
      telegramChatId,
      orderId: data.orderId,
      actor: currentActor
    });
    await context.answerCallbackQuery({ text: "Pool closed" });
    await context.reply(
      orderMessage(
        "Pool closed before payment submission. No settlement receipt was created.",
        order
      )
    );
    return;
  }

  if (data.action === "publish") {
    const order = await useCases.publishDraft({
      sourceIdempotencyKey,
      telegramChatId,
      orderId: data.orderId,
      actor: currentActor
    });
    await context.answerCallbackQuery({ text: "Draft published" });
    await context.reply(orderMessage("Pool published.", order), {
      reply_markup: collectingOrderKeyboard(order.id)
    });
    return;
  }

  if (data.action === "discard") {
    const order = await useCases.discardDraft({
      sourceIdempotencyKey,
      telegramChatId,
      orderId: data.orderId,
      actor: currentActor
    });
    await context.answerCallbackQuery({ text: "Draft discarded" });
    await context.reply(
      orderMessage(
        "Draft discarded. No checkout, confirmation, or payment was created.",
        order
      )
    );
    return;
  }

  await context.answerCallbackQuery({ text: "Preparing final quote" });
  const result = await useCases.quotePool({
    sourceIdempotencyKey,
    telegramChatId,
    orderId: data.orderId,
    requestedByUserId: currentActor.userId
  });
  await deliverConfirmationLinks(context, result, "quote");
}

export function registerPoolHandlers(
  bot: Bot<PoolMateContext>,
  { useCases, draftExtractor, commandSkillInvoker }: PoolHandlerDependencies
): void {
  bot.command("pool_new", async (context) => {
    if (context.chat.type !== "group" && context.chat.type !== "supergroup") {
      await context.reply("Use /pool_new in a Telegram group.");
      return;
    }

    const originalText = context.message?.text ?? "";
    const command = parseNewPoolCommand(originalText);
    if (!command) {
      await context.reply("Usage: /pool_new <targetUnits> <title>");
      return;
    }

    const order = await useCases.createPool({
      sourceIdempotencyKey: telegramUpdateIdempotencyKey(
        context.update.update_id
      ),
      telegramChatId: String(context.chat.id),
      telegramChatTitle: context.chat.title,
      actor: actor(context),
      title: command.title,
      targetUnits: command.targetUnits,
      intent: orderIntent(originalText, "telegram_command", {
        itemName: command.title,
        targetUnits: command.targetUnits
      })
    });
    await context.reply(orderMessage("Pool created.", order), {
      reply_markup: collectingOrderKeyboard(order.id)
    });
  });

  bot.command("pool_claim", async (context) => {
    const telegramChatId = groupChatId(context);
    if (!telegramChatId) {
      await context.reply("Use /pool_claim in the order's Telegram group.");
      return;
    }
    const command = parseOrderUnitsCommand(context.message?.text ?? "");
    if (!command) {
      await context.reply("Usage: /pool_claim <orderId> [units]");
      return;
    }

    const currentActor = actor(context);
    const order = await useCases.claimPool({
      sourceIdempotencyKey: telegramUpdateIdempotencyKey(
        context.update.update_id
      ),
      telegramChatId,
      orderId: command.orderId,
      actor: currentActor,
      units: command.units
    });
    await context.reply(
      orderMessage(
        `${actorReference(context, currentActor)} updated their claim.`,
        order
      ),
      { reply_markup: collectingOrderKeyboard(order.id) }
    );
  });

  bot.command("pool_test", async (context) => {
    const telegramChatId = groupChatId(context);
    if (!telegramChatId) {
      await context.reply("Use /pool_test in the order's Telegram group.");
      return;
    }
    const command = parsePoolTestCommand(context.message?.text ?? "");
    if (!command) {
      await context.reply(
        "Usage: /pool_test <orderId> +N or /pool_test <orderId> -N"
      );
      return;
    }

    let order = await useCases.getPool({
      telegramChatId,
      orderId: command.orderId
    });
    const baseKey = telegramUpdateIdempotencyKey(context.update.update_id);
    let changed = 0;
    if (command.delta > 0) {
      for (const slot of nextVirtualSlots(order, command.delta)) {
        order = await useCases.claimPool({
          sourceIdempotencyKey: `${baseKey}:virtual:add:${virtualSlotLabel(slot)}`,
          telegramChatId,
          orderId: command.orderId,
          actor: virtualActor(slot),
          units: 1
        });
        changed += 1;
      }
      await context.reply(
        orderMessage(`Virtual participants added: ${changed}.`, order),
        collectingKeyboardOptions(order)
      );
      return;
    }

    const slots = removableVirtualSlots(order, Math.abs(command.delta));
    for (const slot of slots) {
      order = await useCases.leavePool({
        sourceIdempotencyKey: `${baseKey}:virtual:remove:${virtualSlotLabel(slot)}`,
        telegramChatId,
        orderId: command.orderId,
        actor: virtualActor(slot)
      });
      changed += 1;
    }
    await context.reply(
      orderMessage(
        changed > 0
          ? `Virtual participants removed: ${changed}.`
          : "No virtual participants were available to remove.",
        order
      ),
      collectingKeyboardOptions(order)
    );
  });

  bot.command("pool_leave", async (context) => {
    const telegramChatId = groupChatId(context);
    if (!telegramChatId) {
      await context.reply("Use /pool_leave in the order's Telegram group.");
      return;
    }
    const orderId = parseOrderCommand(
      context.message?.text ?? "",
      "pool_leave"
    );
    if (!orderId) {
      await context.reply("Usage: /pool_leave <orderId>");
      return;
    }

    const currentActor = actor(context);
    const order = await useCases.leavePool({
      sourceIdempotencyKey: telegramUpdateIdempotencyKey(
        context.update.update_id
      ),
      telegramChatId,
      orderId,
      actor: currentActor
    });
    await context.reply(
      orderMessage(
        `${actorReference(context, currentActor)} left the pool.`,
        order
      ),
      { reply_markup: collectingOrderKeyboard(order.id) }
    );
  });

  bot.command("pool_close", async (context) => {
    const telegramChatId = groupChatId(context);
    if (!telegramChatId) {
      await context.reply("Use /pool_close in the order's Telegram group.");
      return;
    }
    const orderId = parseOrderCommand(
      context.message?.text ?? "",
      "pool_close"
    );
    if (!orderId) {
      await context.reply("Usage: /pool_close <orderId>");
      return;
    }

    const order = await useCases.closePool({
      sourceIdempotencyKey: telegramUpdateIdempotencyKey(
        context.update.update_id
      ),
      telegramChatId,
      orderId,
      actor: actor(context)
    });
    await context.reply(
      orderMessage(
        "Pool closed before payment submission. No settlement receipt was created.",
        order
      )
    );
  });

  bot.command("pool_quote", async (context) => {
    const telegramChatId = groupChatId(context);
    if (!telegramChatId) {
      await context.reply("Use /pool_quote in the order's Telegram group.");
      return;
    }
    const orderId = parseOrderCommand(
      context.message?.text ?? "",
      "pool_quote"
    );
    if (!orderId) {
      await context.reply("Usage: /pool_quote <orderId>");
      return;
    }

    const result = await useCases.quotePool({
      sourceIdempotencyKey: telegramUpdateIdempotencyKey(
        context.update.update_id
      ),
      telegramChatId,
      orderId,
      requestedByUserId: actor(context).userId
    });
    await deliverConfirmationLinks(context, result, "quote");
  });

  bot.command("pool_remind", async (context) => {
    const telegramChatId = groupChatId(context);
    if (!telegramChatId) {
      await context.reply("Use /pool_remind in the order's Telegram group.");
      return;
    }
    const orderId = parseOrderCommand(
      context.message?.text ?? "",
      "pool_remind"
    );
    if (!orderId) {
      await context.reply("Usage: /pool_remind <orderId>");
      return;
    }

    const result = await useCases.remindPool({
      sourceIdempotencyKey: telegramUpdateIdempotencyKey(
        context.update.update_id
      ),
      telegramChatId,
      orderId,
      requestedByUserId: actor(context).userId
    });
    await deliverConfirmationLinks(context, result, "reminder");
  });

  bot.command("pool_status", async (context) => {
    const telegramChatId = groupChatId(context);
    if (!telegramChatId) {
      await context.reply("Use /pool_status in the order's Telegram group.");
      return;
    }
    const orderId = parseOrderCommand(
      context.message?.text ?? "",
      "pool_status"
    );
    if (!orderId) {
      await context.reply("Usage: /pool_status <orderId>");
      return;
    }
    const order = await useCases.getPool({
      telegramChatId,
      orderId
    });
    await context.reply(formatPaymentStatus(order), {
      link_preview_options: { is_disabled: true }
    });
  });

  if (draftExtractor) {
    bot.on("message:text", async (context) => {
      const telegramChatId = groupChatId(context);
      if (!telegramChatId) return;
      const requestText = mentionedOrderRequest(context);
      if (requestText === null) return;
      if (!requestText) {
        await context.reply(
          "Please include a product title and target quantity after mentioning PoolMate."
        );
        return;
      }

      let skill;
      try {
        skill = await invokeCommandSkill(commandSkillInvoker, {
          text: requestText,
          locale: context.from?.language_code,
          surface: "telegram_mention"
        });
      } catch (error) {
        if (
          error instanceof CommandSkillInvokerError &&
          error.code === "LLM_DISABLED"
        ) {
          await context.reply(
            "Natural-language command skill calling is not configured. Set AIPING_API_KEY, DEEPSEEK_API_KEY, or POOLMATE_LLM_API_KEY, then run poolmate/scripts/poolmate.sh update."
          );
          return;
        }
        await context.reply(
          "Natural-language command skill calling is unavailable. Use /help or /pool_new <targetUnits> <title>."
        );
        return;
      }
      if (!skill) {
        await context.reply(
          "PoolMate could not decide which command skill to call. Use /help or /pool_new <targetUnits> <title>."
        );
        return;
      }
      if (skill.id === "general_help") {
        await context.reply(formatGeneralHelp());
        return;
      }
      if (skill.id !== "create_pool") {
        await context.reply(formatSkillHelp(skill, "natural_language"));
        return;
      }
      if (draftExtractor.getStatus() === "disabled") {
        await context.reply(
          "Natural-language drafts are disabled. Use /pool_new <targetUnits> <title>."
        );
        return;
      }

      const currentActor = actor(context);
      const actorRef = actorReference(context, currentActor);
      const startedAt = messageStartedAt(context);
      const processingCard = await context.reply(
        processingCardMessage({ actorRef, startedAt, requestText }),
        { link_preview_options: { is_disabled: true } }
      );

      try {
        const extraction = await draftExtractor.extract({
          text: requestText,
          locale: context.from?.language_code
        });
        const unresolved = [
          ...extraction.missingFields,
          ...extraction.ambiguousFields
        ];
        if (
          unresolved.length > 0 ||
          extraction.title === null ||
          extraction.itemName === null ||
          extraction.targetUnits === null
        ) {
          await editStatusCard(
            context,
            processingCard,
            [
              "PoolMate needs more information before opening this pool.",
              `Started by: ${actorRef}`,
              `Started at: ${startedAt}`,
              `Missing or ambiguous: ${fieldNames(unresolved)}.`,
              "No order, checkout, confirmation, or payment was created."
            ].join("\n")
          );
          return;
        }
        const order = await useCases.createPool({
          sourceIdempotencyKey: telegramUpdateIdempotencyKey(
            context.update.update_id
          ),
          telegramChatId,
          telegramChatTitle: context.chat.title ?? "Telegram group",
          actor: currentActor,
          title: extraction.title,
          targetUnits: extraction.targetUnits,
          intent: orderIntent(requestText, "telegram_natural_language", {
            itemName: extraction.itemName,
            targetUnits: extraction.targetUnits,
            unit: extraction.unit,
            purchaseChannelHint: extraction.purchaseChannelHint,
            storeNameHint: extraction.storeNameHint,
            merchantLinkHint: extraction.merchantLinkHint,
            userPriceHint: extraction.userPriceHint
          })
        });
        await editStatusCard(
          context,
          processingCard,
          collectingCardMessage({ order, actorRef, startedAt }),
          collectingOrderKeyboard(order.id)
        );
      } catch (error) {
        if (error instanceof OrderDraftExtractorError) {
          console.error(`[telegram] draft parsing failed code=${error.code}`);
          const message =
            error.code === "LLM_INVALID_INPUT"
              ? error.message
              : error.code === "LLM_REFUSED"
                ? "The request could not be parsed into an order draft. No order was created."
                : error.code === "LLM_INVALID_RESPONSE"
                  ? "The model returned an invalid order draft. Please retry the same request. No order was created."
                  : "Natural-language draft parsing is unavailable. Use /pool_new <targetUnits> <title>.";
          await editStatusCard(
            context,
            processingCard,
            [
              "PoolMate could not open this pool.",
              `Started by: ${actorRef}`,
              `Started at: ${startedAt}`,
              message,
              "No order, checkout, confirmation, or payment was created."
            ].join("\n")
          );
          return;
        }
        throw error;
      }
    });
  }

  bot.callbackQuery(/^pm:v1:/, async (context) => {
    const data = parsePoolMateCallbackData(context.callbackQuery.data);
    if (!data) {
      await context.answerCallbackQuery({
        text: "This PoolMate action is invalid or expired.",
        show_alert: true
      });
      return;
    }
    await handleCallbackAction(context, useCases, data);
  });
}
