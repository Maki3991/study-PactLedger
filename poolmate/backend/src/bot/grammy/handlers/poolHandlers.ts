import { InlineKeyboard, type Bot } from "grammy";
import type { OrderDetailView } from "@poolmate/shared";
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
  parseOrderUnitsCommand
} from "../../poolCommands.js";
import type {
  PoolMateBotActor,
  PoolMateBotUseCases,
  QuotePoolFromBotResult,
  RemindPoolFromBotResult
} from "../../poolMateBotUseCases.js";
import { collectingOrderKeyboard } from "../keyboards.js";
import type { PoolMateContext } from "../context.js";

export interface PoolHandlerDependencies {
  useCases: PoolMateBotUseCases;
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

function safeDisplayName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80) || "participant";
}

function groupChatId(context: PoolMateContext): string | null {
  const chat = context.chat;
  return chat?.type === "group" || chat?.type === "supergroup"
    ? String(chat.id)
    : null;
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
    await context.reply(orderMessage("Claim updated.", order), {
      reply_markup: collectingOrderKeyboard(order.id)
    });
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
    await context.reply(orderMessage("You left the pool.", order), {
      reply_markup: collectingOrderKeyboard(order.id)
    });
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
  { useCases }: PoolHandlerDependencies
): void {
  bot.command("pool_new", async (context) => {
    if (context.chat.type !== "group" && context.chat.type !== "supergroup") {
      await context.reply("Use /pool_new in a Telegram group.");
      return;
    }

    const command = parseNewPoolCommand(context.message?.text ?? "");
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
      targetUnits: command.targetUnits
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

    const order = await useCases.claimPool({
      sourceIdempotencyKey: telegramUpdateIdempotencyKey(
        context.update.update_id
      ),
      telegramChatId,
      orderId: command.orderId,
      actor: actor(context),
      units: command.units
    });
    await context.reply(orderMessage("Claim updated.", order), {
      reply_markup: collectingOrderKeyboard(order.id)
    });
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

    const order = await useCases.leavePool({
      sourceIdempotencyKey: telegramUpdateIdempotencyKey(
        context.update.update_id
      ),
      telegramChatId,
      orderId,
      actor: actor(context)
    });
    await context.reply(orderMessage("You left the pool.", order), {
      reply_markup: collectingOrderKeyboard(order.id)
    });
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
