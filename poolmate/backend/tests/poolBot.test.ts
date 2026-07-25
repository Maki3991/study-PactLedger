import assert from "node:assert/strict";
import test from "node:test";
import type { OrderDetailView } from "@poolmate/shared";
import {
  claimCallbackData,
  closeCallbackData,
  discardDraftCallbackData,
  leaveCallbackData,
  parsePoolMateCallbackData,
  publishDraftCallbackData,
  quoteCallbackData
} from "../src/bot/callbackData.js";
import type { OrderDraftExtractor } from "../src/application/ports/orderDraftExtractor.js";
import { createPoolMateBot } from "../src/bot/grammy/createBot.js";
import type { CommandSkillInvoker } from "../src/bot/help/commandSkillInvoker.js";
import type {
  ClaimPoolFromBotInput,
  ClosePoolFromBotInput,
  CreatePoolFromBotInput,
  DraftActionFromBotInput,
  LeavePoolFromBotInput,
  PoolMateBotUseCases,
  QuotePoolFromBotInput,
  QuotePoolFromBotResult,
  RemindPoolFromBotInput
} from "../src/bot/poolMateBotUseCases.js";

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

interface UseCaseCalls {
  draft: CreatePoolFromBotInput[];
  publish: DraftActionFromBotInput[];
  discard: DraftActionFromBotInput[];
  create: CreatePoolFromBotInput[];
  claim: ClaimPoolFromBotInput[];
  leave: LeavePoolFromBotInput[];
  close: ClosePoolFromBotInput[];
  quote: QuotePoolFromBotInput[];
  remind: RemindPoolFromBotInput[];
  get: Array<{ telegramChatId: string; orderId: string }>;
}

const baseOrder: OrderDetailView = {
  id: "order-1",
  title: "Fresh fruit",
  group: {
    id: "group-1",
    title: "Friday Pool",
    createdAt: "2026-07-25T10:00:00.000Z"
  },
  state: "COLLECTING",
  fundingMode: "sponsored_demo",
  targetUnits: 3,
  claimedUnits: 1,
  participantCount: 1,
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:01:00.000Z",
  participants: [
    {
      id: "participant-1",
      displayName: "Alice",
      units: 1,
      joinedAt: "2026-07-25T10:01:00.000Z"
    }
  ]
};

const draftOrder: OrderDetailView = {
  ...baseOrder,
  state: "DRAFT",
  claimedUnits: 0,
  participantCount: 0,
  participants: []
};

const quotedOrder: OrderDetailView = {
  ...baseOrder,
  state: "CONFIRMATION_PENDING",
  claimedUnits: 3,
  participantCount: 2,
  checkoutVersion: 1,
  expiresAt: "2026-07-25T10:20:00.000Z",
  checkout: {
    id: "checkout-1",
    version: 1,
    hash: {
      algorithm: "SHA-256",
      canonicalizationVersion: "poolmate-checkout-json-v1",
      value: "checkout-hash"
    },
    merchant: {
      id: "merchant-demo",
      displayName: "Demo Merchant #001",
      payeeId: "payee-demo",
      verified: true
    },
    items: [
      {
        sku: "fruit-box",
        name: "Fresh fruit",
        quantity: "3",
        unitAmountAtomic: "89000000"
      }
    ],
    goods: { assetId: "USDC", amountAtomic: "267000000" },
    shipping: { assetId: "USDC", amountAtomic: "18000000" },
    discount: { assetId: "USDC", amountAtomic: "0" },
    fee: { assetId: "USDC", amountAtomic: "0" },
    total: {
      assetId: "USDC",
      amountAtomic: "285000000"
    },
    expiresAt: "2026-07-25T10:20:00.000Z",
    sourceProtocol: "MOCK",
    createdAt: "2026-07-25T10:10:00.000Z",
    allocations: [
      {
        id: "allocation-1",
        participantId: "participant-1",
        displayName: "Alice",
        units: 1,
        strategy: "BY_QUANTITY",
        status: "CONFIRMATION_PENDING",
        goods: { assetId: "USDC", amountAtomic: "89000000" },
        shipping: { assetId: "USDC", amountAtomic: "6000000" },
        discount: { assetId: "USDC", amountAtomic: "0" },
        fee: { assetId: "USDC", amountAtomic: "0" },
        total: { assetId: "USDC", amountAtomic: "95000000" },
        money: { assetId: "USDC", amountAtomic: "95000000" },
        confirmationStatus: "pending"
      },
      {
        id: "allocation-2",
        participantId: "participant-2",
        displayName: "Bob",
        units: 2,
        strategy: "BY_QUANTITY",
        status: "CONFIRMATION_PENDING",
        goods: { assetId: "USDC", amountAtomic: "178000000" },
        shipping: { assetId: "USDC", amountAtomic: "12000000" },
        discount: { assetId: "USDC", amountAtomic: "0" },
        fee: { assetId: "USDC", amountAtomic: "0" },
        total: { assetId: "USDC", amountAtomic: "190000000" },
        money: { assetId: "USDC", amountAtomic: "190000000" },
        confirmationStatus: "pending"
      }
    ]
  }
};

function createUseCases(
  quoteResult: QuotePoolFromBotResult = {
    order: quotedOrder,
    confirmationDeliveries: []
  }
): { useCases: PoolMateBotUseCases; calls: UseCaseCalls } {
  const calls: UseCaseCalls = {
    draft: [],
    publish: [],
    discard: [],
    create: [],
    claim: [],
    leave: [],
    close: [],
    quote: [],
    remind: [],
    get: []
  };
  return {
    calls,
    useCases: {
      createDraft: async (input) => {
        calls.draft.push(input);
        return {
          ...draftOrder,
          title: input.title,
          targetUnits: input.targetUnits,
          intent: input.intent
        };
      },
      publishDraft: async (input) => {
        calls.publish.push(input);
        return baseOrder;
      },
      discardDraft: async (input) => {
        calls.discard.push(input);
        return { ...draftOrder, state: "CANCELED" };
      },
      createPool: async (input) => {
        calls.create.push(input);
        return {
          ...baseOrder,
          title: input.title,
          targetUnits: input.targetUnits,
          claimedUnits: 0,
          participantCount: 0,
          participants: [],
          intent: input.intent
        };
      },
      claimPool: async (input) => {
        calls.claim.push(input);
        return baseOrder;
      },
      leavePool: async (input) => {
        calls.leave.push(input);
        return { ...baseOrder, claimedUnits: 0, participantCount: 0 };
      },
      closePool: async (input) => {
        calls.close.push(input);
        return { ...baseOrder, state: "CANCELED" };
      },
      quotePool: async (input) => {
        calls.quote.push(input);
        return quoteResult;
      },
      remindPool: async (input) => {
        calls.remind.push(input);
        return quoteResult;
      },
      getPool: async (input) => {
        calls.get.push(input);
        return baseOrder;
      }
    }
  };
}

function createHarness(
  useCases: PoolMateBotUseCases,
  failedPrivateChatId?: string,
  privateFailureLimit = Number.POSITIVE_INFINITY,
  draftExtractor?: OrderDraftExtractor,
  commandSkillInvoker?: CommandSkillInvoker
) {
  const apiCalls: ApiCall[] = [];
  let privateFailures = 0;
  const bot = createPoolMateBot({
    token: "123456:test-token",
    userAllowlistEnabled: true,
    allowedUserIds: ["101"],
    getBotStatus: () => "running",
    draftExtractor,
    commandSkillInvoker,
    useCases
  });
  bot.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: "PoolMate",
    username: "poolmate_test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false
  };
  bot.api.config.use(async (_previous, method, payload) => {
    const record = {
      method,
      payload: payload as Record<string, unknown>
    };
    apiCalls.push(record);
    const chatId = String((payload as { chat_id?: string | number }).chat_id);
    if (
      method === "sendMessage" &&
      chatId === failedPrivateChatId &&
      privateFailures < privateFailureLimit
    ) {
      privateFailures += 1;
      throw new Error("Telegram delivery failed");
    }
    if (method === "sendMessage") {
      return {
        ok: true,
        result: {
          message_id: apiCalls.length,
          date: 1_753_405_200,
          chat: {
            id: Number(chatId),
            type: Number(chatId) < 0 ? "group" : "private",
            title: "Friday Pool"
          },
          text: String((payload as { text: string }).text)
        }
      } as never;
    }
    if (method === "editMessageText") {
      return {
        ok: true,
        result: {
          message_id: (payload as { message_id: number }).message_id,
          date: 1_753_405_200,
          chat: {
            id: Number(chatId),
            type: Number(chatId) < 0 ? "group" : "private",
            title: "Friday Pool"
          },
          text: String((payload as { text: string }).text)
        }
      } as never;
    }
    if (method === "answerCallbackQuery") {
      return { ok: true, result: true } as never;
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  });
  return { bot, apiCalls };
}

function commandUpdate(updateId: number, text: string) {
  const command = text.split(/\s/, 1)[0];
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_753_405_200,
      from: {
        id: 101,
        is_bot: false,
        first_name: "Alice",
        last_name: "Chen",
        username: "alice",
        language_code: "en"
      },
      chat: {
        id: -500,
        type: "group" as const,
        title: "Friday Pool",
        all_members_are_administrators: false
      },
      text,
      entities: [
        {
          offset: 0,
          length: command.length,
          type: "bot_command" as const
        }
      ]
    }
  };
}

function textUpdate(
  updateId: number,
  text: string,
  mention: boolean | "text_mention" = false
) {
  const mentionText =
    mention === "text_mention" ? "PoolMate" : "@poolmate_test_bot";
  const mentionOffset = text.indexOf(mentionText);
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_753_405_200,
      from: {
        id: 101,
        is_bot: false,
        first_name: "Alice",
        last_name: "Chen",
        username: "alice",
        language_code: "zh"
      },
      chat: {
        id: -500,
        type: "group" as const,
        title: "Friday Pool",
        all_members_are_administrators: false
      },
      text,
      ...(mention && mentionOffset >= 0
        ? {
            entities: [
              mention === "text_mention"
                ? {
                    offset: mentionOffset,
                    length: mentionText.length,
                    type: "text_mention" as const,
                    user: {
                      id: 123456,
                      is_bot: true,
                      first_name: "PoolMate",
                      username: "poolmate_test_bot"
                    }
                  }
                : {
                    offset: mentionOffset,
                    length: mentionText.length,
                    type: "mention" as const
                  }
            ]
          }
        : {})
    }
  };
}

function callbackUpdate(updateId: number, callbackId: string, data: string) {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackId,
      from: {
        id: 101,
        is_bot: false,
        first_name: "Alice",
        last_name: "Chen",
        username: "alice"
      },
      chat_instance: "group-chat-instance",
      data,
      message: {
        message_id: 99,
        date: 1_753_405_200,
        chat: {
          id: -500,
          type: "group" as const,
          title: "Friday Pool",
          all_members_are_administrators: false
        },
        text: "Pool order"
      }
    }
  };
}

function privateCommandUpdate(updateId: number, text: string) {
  const update = commandUpdate(updateId, text);
  return {
    ...update,
    message: {
      ...update.message,
      chat: {
        id: 101,
        type: "private" as const,
        first_name: "Alice"
      }
    }
  };
}

function privateCallbackUpdate(
  updateId: number,
  callbackId: string,
  data: string
) {
  const update = callbackUpdate(updateId, callbackId, data);
  return {
    ...update,
    callback_query: {
      ...update.callback_query,
      message: {
        ...update.callback_query.message,
        chat: {
          id: 101,
          type: "private" as const,
          first_name: "Alice"
        }
      }
    }
  };
}

test("grammY maps PoolMate commands to framework-neutral use case DTOs", async () => {
  const { useCases, calls } = createUseCases();
  const { bot } = createHarness(useCases);

  await bot.handleUpdate(commandUpdate(100, "/pool_new 3 Fresh fruit"));
  await bot.handleUpdate(commandUpdate(101, "/pool_claim order-1 2"));
  await bot.handleUpdate(commandUpdate(102, "/pool_leave order-1"));
  await bot.handleUpdate(commandUpdate(103, "/pool_close order-1"));
  await bot.handleUpdate(commandUpdate(104, "/pool_quote order-1"));
  await bot.handleUpdate(commandUpdate(105, "/pool_remind order-1"));
  await bot.handleUpdate(commandUpdate(106, "/pool_status order-1"));

  assert.deepEqual(calls.create, [
    {
      sourceIdempotencyKey: "telegram:update:v1:100",
      telegramChatId: "-500",
      telegramChatTitle: "Friday Pool",
      actor: { userId: "101", displayName: "Alice Chen" },
      title: "Fresh fruit",
      targetUnits: 3,
      intent: {
        schemaVersion: "poolmate-order-intent-v1",
        originalText: "/pool_new 3 Fresh fruit",
        source: "telegram_command",
        items: [{ name: "Fresh fruit", quantity: 3 }]
      }
    }
  ]);
  assert.deepEqual(calls.claim[0], {
    sourceIdempotencyKey: "telegram:update:v1:101",
    telegramChatId: "-500",
    orderId: "order-1",
    actor: { userId: "101", displayName: "Alice Chen" },
    units: 2
  });
  assert.deepEqual(calls.leave[0], {
    sourceIdempotencyKey: "telegram:update:v1:102",
    telegramChatId: "-500",
    orderId: "order-1",
    actor: { userId: "101", displayName: "Alice Chen" }
  });
  assert.deepEqual(calls.close[0], {
    sourceIdempotencyKey: "telegram:update:v1:103",
    telegramChatId: "-500",
    orderId: "order-1",
    actor: { userId: "101", displayName: "Alice Chen" }
  });
  assert.deepEqual(calls.quote[0], {
    sourceIdempotencyKey: "telegram:update:v1:104",
    telegramChatId: "-500",
    orderId: "order-1",
    requestedByUserId: "101"
  });
  assert.deepEqual(calls.remind[0], {
    sourceIdempotencyKey: "telegram:update:v1:105",
    telegramChatId: "-500",
    orderId: "order-1",
    requestedByUserId: "101"
  });
  assert.deepEqual(calls.get, [{ telegramChatId: "-500", orderId: "order-1" }]);
});

test("claim and leave replies identify the Telegram actor by @username", async () => {
  const { useCases } = createUseCases();
  const { bot, apiCalls } = createHarness(useCases);

  await bot.handleUpdate(commandUpdate(107, "/pool_claim order-1 1"));
  await bot.handleUpdate(commandUpdate(108, "/pool_leave order-1"));
  await bot.handleUpdate(
    callbackUpdate(109, "callback-claim-actor", claimCallbackData("order-1", 1))
  );
  await bot.handleUpdate(
    callbackUpdate(110, "callback-leave-actor", leaveCallbackData("order-1"))
  );

  const replies = apiCalls
    .filter((call) => call.method === "sendMessage")
    .map((call) => String(call.payload.text).split("\n", 1)[0]);
  assert.deepEqual(replies, [
    "@alice updated their claim.",
    "@alice left the pool.",
    "@alice updated their claim.",
    "@alice left the pool."
  ]);
});

test("pool_test command adds and removes deterministic virtual participants", async () => {
  const addHarness = createUseCases();
  const addBot = createHarness(addHarness.useCases).bot;
  await addBot.handleUpdate(commandUpdate(113, "/pool_test order-1 +2"));
  assert.deepEqual(
    addHarness.calls.claim.map((call) => ({
      sourceIdempotencyKey: call.sourceIdempotencyKey,
      orderId: call.orderId,
      actor: call.actor,
      units: call.units
    })),
    [
      {
        sourceIdempotencyKey: "telegram:update:v1:113:virtual:add:001",
        orderId: "order-1",
        actor: { userId: "poolmate-virtual-001", displayName: "Virtual #001" },
        units: 1
      },
      {
        sourceIdempotencyKey: "telegram:update:v1:113:virtual:add:002",
        orderId: "order-1",
        actor: { userId: "poolmate-virtual-002", displayName: "Virtual #002" },
        units: 1
      }
    ]
  );

  const removeHarness = createUseCases();
  removeHarness.useCases.getPool = async (input) => {
    removeHarness.calls.get.push(input);
    return {
      ...baseOrder,
      claimedUnits: 3,
      participantCount: 3,
      participants: [
        ...baseOrder.participants,
        {
          id: "participant-virtual-1",
          displayName: "Virtual #001",
          units: 1,
          joinedAt: "2026-07-25T10:02:00.000Z"
        },
        {
          id: "participant-virtual-2",
          displayName: "Virtual #002",
          units: 1,
          joinedAt: "2026-07-25T10:03:00.000Z"
        }
      ]
    };
  };
  const remove = createHarness(removeHarness.useCases);
  await remove.bot.handleUpdate(commandUpdate(114, "/pool_test order-1 -2"));
  assert.deepEqual(
    removeHarness.calls.leave.map((call) => ({
      sourceIdempotencyKey: call.sourceIdempotencyKey,
      orderId: call.orderId,
      actor: call.actor
    })),
    [
      {
        sourceIdempotencyKey: "telegram:update:v1:114:virtual:remove:002",
        orderId: "order-1",
        actor: { userId: "poolmate-virtual-002", displayName: "Virtual #002" }
      },
      {
        sourceIdempotencyKey: "telegram:update:v1:114:virtual:remove:001",
        orderId: "order-1",
        actor: { userId: "poolmate-virtual-001", displayName: "Virtual #001" }
      }
    ]
  );
  const reply = remove.apiCalls.find((call) => call.method === "sendMessage");
  assert.match(String(reply?.payload.text), /Virtual participants removed: 2/);
});

test("natural language accepts exact username text and Telegram bot mention entities", async () => {
  let extracted = 0;
  let invoked = 0;
  const naturalRequest =
    "拼单 3瓶可乐，美团外卖 xx店铺名 https://example.test/item";
  const commandSkillInvoker: CommandSkillInvoker = {
    getStatus: () => "configured",
    async invoke(request) {
      invoked += 1;
      assert.equal(request.text, naturalRequest);
      assert.equal(request.locale, "zh");
      assert.equal(request.surface, "telegram_mention");
      return {
        skillId: "create_pool",
        confidence: 0.94,
        reason: "The user is starting a group purchase."
      };
    }
  };
  const extractor: OrderDraftExtractor = {
    getStatus: () => "configured",
    async extract(request) {
      extracted += 1;
      assert.equal(request.text, naturalRequest);
      assert.equal(request.locale, "zh");
      return {
        title: "可乐拼单",
        itemName: "可乐",
        targetUnits: 3,
        unit: "瓶",
        purchaseChannelHint: "美团外卖",
        storeNameHint: "xx店铺名",
        merchantLinkHint: "https://example.test/item",
        userPriceHint: null,
        missingFields: [],
        ambiguousFields: []
      };
    }
  };
  const { useCases, calls } = createUseCases();
  const { bot, apiCalls } = createHarness(
    useCases,
    undefined,
    Number.POSITIVE_INFINITY,
    extractor,
    commandSkillInvoker
  );

  await bot.handleUpdate(textUpdate(110, "今晚吃什么"));
  await bot.handleUpdate(
    textUpdate(108, `@poolmate_test_bot_extra ${naturalRequest}`)
  );
  await bot.handleUpdate(
    textUpdate(109, `@poolmate_test_bot ${naturalRequest}`)
  );
  await bot.handleUpdate(
    textUpdate(111, `@poolmate_test_bot ${naturalRequest}`, true)
  );
  await bot.handleUpdate(
    textUpdate(112, `PoolMate ${naturalRequest}`, "text_mention")
  );

  assert.equal(invoked, 3);
  assert.equal(extracted, 3);
  assert.deepEqual(calls.create, [
    {
      sourceIdempotencyKey: "telegram:update:v1:109",
      telegramChatId: "-500",
      telegramChatTitle: "Friday Pool",
      actor: { userId: "101", displayName: "Alice Chen" },
      title: "可乐拼单",
      targetUnits: 3,
      intent: {
        schemaVersion: "poolmate-order-intent-v1",
        originalText: naturalRequest,
        source: "telegram_natural_language",
        items: [{ name: "可乐", quantity: 3, unit: "瓶" }],
        purchaseChannelHint: "美团外卖",
        storeNameHint: "xx店铺名",
        merchantLinkHint: "https://example.test/item"
      }
    },
    {
      sourceIdempotencyKey: "telegram:update:v1:111",
      telegramChatId: "-500",
      telegramChatTitle: "Friday Pool",
      actor: { userId: "101", displayName: "Alice Chen" },
      title: "可乐拼单",
      targetUnits: 3,
      intent: {
        schemaVersion: "poolmate-order-intent-v1",
        originalText: naturalRequest,
        source: "telegram_natural_language",
        items: [{ name: "可乐", quantity: 3, unit: "瓶" }],
        purchaseChannelHint: "美团外卖",
        storeNameHint: "xx店铺名",
        merchantLinkHint: "https://example.test/item"
      }
    },
    {
      sourceIdempotencyKey: "telegram:update:v1:112",
      telegramChatId: "-500",
      telegramChatTitle: "Friday Pool",
      actor: { userId: "101", displayName: "Alice Chen" },
      title: "可乐拼单",
      targetUnits: 3,
      intent: {
        schemaVersion: "poolmate-order-intent-v1",
        originalText: naturalRequest,
        source: "telegram_natural_language",
        items: [{ name: "可乐", quantity: 3, unit: "瓶" }],
        purchaseChannelHint: "美团外卖",
        storeNameHint: "xx店铺名",
        merchantLinkHint: "https://example.test/item"
      }
    }
  ]);
  assert.equal(calls.draft.length, 0);
  assert.equal(calls.publish.length, 0);
  const processingReplies = apiCalls.filter(
    (call) =>
      call.method === "sendMessage" &&
      /拼单请求处理中/.test(String(call.payload.text))
  );
  assert.equal(processingReplies.length, 3);
  assert.match(
    String(processingReplies[0]?.payload.text),
    /Started by: @alice/
  );
  assert.match(String(processingReplies[0]?.payload.text), /Started at:/);
  const reply = apiCalls.find(
    (call) =>
      call.method === "editMessageText" &&
      /Pool is open for claims/.test(String(call.payload.text))
  );
  assert.match(String(reply?.payload.text), /State: COLLECTING/);
  assert.match(String(reply?.payload.text), /Requested item: 可乐/);
  assert.match(String(reply?.payload.text), /Requested quantity: 3 瓶/);
  assert.match(
    String(reply?.payload.text),
    /Purchase channel preference: 美团外卖/
  );
  assert.match(String(reply?.payload.text), /Store hint: xx店铺名/);
  assert.match(
    String(reply?.payload.text),
    /Merchant link hint: https:\/\/example\.test\/item/
  );
  assert.match(String(reply?.payload.text), /Demo Merchant \(Mock\)/);
  assert.match(String(reply?.payload.text), /no live channel integration/);
  assert.match(String(reply?.payload.text), /verified Checkout/);
  assert.match(
    String(reply?.payload.text),
    /fewer, exact, or more claimed units/
  );
  const keyboard = reply?.payload.reply_markup as {
    inline_keyboard: Array<Array<{ callback_data: string }>>;
  };
  assert.equal(
    keyboard.inline_keyboard[0][0]?.callback_data,
    claimCallbackData("order-1", 1)
  );
  assert.equal(
    keyboard.inline_keyboard[1][0]?.callback_data,
    quoteCallbackData("order-1")
  );
});

test("natural-language mention calls general_help instead of order draft extraction", async () => {
  const commandSkillInvoker: CommandSkillInvoker = {
    getStatus: () => "configured",
    async invoke(request) {
      assert.equal(request.text, "怎么用");
      assert.equal(request.locale, "zh");
      assert.equal(request.surface, "telegram_mention");
      return {
        skillId: "general_help",
        confidence: 0.97,
        reason: "The user asks how to use PoolMate."
      };
    }
  };
  const extractor: OrderDraftExtractor = {
    getStatus: () => "configured",
    async extract() {
      throw new Error("draft extraction should not run for general_help");
    }
  };
  const { useCases, calls } = createUseCases();
  const { bot, apiCalls } = createHarness(
    useCases,
    undefined,
    Number.POSITIVE_INFINITY,
    extractor,
    commandSkillInvoker
  );

  await bot.handleUpdate(textUpdate(115, "@poolmate_test_bot 怎么用"));

  assert.equal(calls.create.length, 0);
  const reply = apiCalls.find((call) => call.method === "sendMessage");
  assert.match(String(reply?.payload.text), /PoolMate help/);
  assert.match(String(reply?.payload.text), /\/pool_new/);
  assert.match(String(reply?.payload.text), /\/pool_test <orderId> \+N/);
  assert.doesNotMatch(String(reply?.payload.text), /unambiguous title/);
});

test("natural-language mention calls general_help even when draft extraction is disabled", async () => {
  const commandSkillInvoker: CommandSkillInvoker = {
    getStatus: () => "configured",
    async invoke(request) {
      assert.equal(request.text, "怎么用");
      assert.equal(request.surface, "telegram_mention");
      return {
        skillId: "general_help",
        confidence: 0.97,
        reason: "The user asks how to use PoolMate."
      };
    }
  };
  const disabled: OrderDraftExtractor = {
    getStatus: () => "disabled",
    async extract() {
      throw new Error("draft extraction should not run for general_help");
    }
  };
  const { useCases, calls } = createUseCases();
  const { bot, apiCalls } = createHarness(
    useCases,
    undefined,
    Number.POSITIVE_INFINITY,
    disabled,
    commandSkillInvoker
  );

  await bot.handleUpdate(textUpdate(116, "@poolmate_test_bot 怎么用"));

  assert.equal(calls.create.length, 0);
  const reply = apiCalls.find((call) => call.method === "sendMessage");
  assert.match(String(reply?.payload.text), /PoolMate help/);
  assert.doesNotMatch(
    String(reply?.payload.text),
    /Natural-language drafts are disabled/
  );
});

test("natural-language mention reports command skill calling as not configured", async () => {
  const extractor: OrderDraftExtractor = {
    getStatus: () => "configured",
    async extract() {
      throw new Error("draft extraction should not run without skill calling");
    }
  };
  const { useCases, calls } = createUseCases();
  const { bot, apiCalls } = createHarness(
    useCases,
    undefined,
    Number.POSITIVE_INFINITY,
    extractor
  );

  await bot.handleUpdate(textUpdate(117, "@poolmate_test_bot 怎么用"));

  assert.equal(calls.create.length, 0);
  const reply = apiCalls.find((call) => call.method === "sendMessage");
  assert.match(
    String(reply?.payload.text),
    /command skill calling is not configured/
  );
  assert.doesNotMatch(String(reply?.payload.text), /could not decide/);
});

test("missing natural-language fields and disabled LLM never create drafts", async () => {
  const createPoolSkillInvoker: CommandSkillInvoker = {
    getStatus: () => "configured",
    async invoke() {
      return {
        skillId: "create_pool",
        confidence: 0.93,
        reason: "The user is starting a group purchase."
      };
    }
  };
  const missing: OrderDraftExtractor = {
    getStatus: () => "configured",
    async extract() {
      return {
        title: "Fruit",
        itemName: "Fruit",
        targetUnits: null,
        unit: null,
        purchaseChannelHint: null,
        storeNameHint: null,
        merchantLinkHint: null,
        userPriceHint: null,
        missingFields: ["targetUnits"],
        ambiguousFields: []
      };
    }
  };
  const disabled: OrderDraftExtractor = {
    getStatus: () => "disabled",
    async extract() {
      throw new Error("must not call disabled extractor");
    }
  };
  const first = createUseCases();
  const firstHarness = createHarness(
    first.useCases,
    undefined,
    Number.POSITIVE_INFINITY,
    missing,
    createPoolSkillInvoker
  );
  await firstHarness.bot.handleUpdate(
    textUpdate(120, "@poolmate_test_bot 拼水果", true)
  );
  assert.equal(first.calls.draft.length, 0);
  assert.equal(first.calls.create.length, 0);
  assert.match(
    String(firstHarness.apiCalls[0]?.payload.text),
    /拼单请求处理中/
  );
  const missingReply = firstHarness.apiCalls.find((call) =>
    /target quantity/.test(String(call.payload.text))
  );
  assert.equal(missingReply?.method, "editMessageText");
  assert.match(String(missingReply?.payload.text), /target quantity/);

  const second = createUseCases();
  const secondHarness = createHarness(
    second.useCases,
    undefined,
    Number.POSITIVE_INFINITY,
    disabled
  );
  await secondHarness.bot.handleUpdate(
    textUpdate(121, "@poolmate_test_bot 拼三箱水果", true)
  );
  assert.equal(second.calls.draft.length, 0);
  assert.equal(second.calls.create.length, 0);
  assert.match(
    String(secondHarness.apiCalls[0]?.payload.text),
    /command skill calling is not configured/
  );
});

test("callback data is stable and repeated callbacks reuse one idempotency key", async () => {
  assert.deepEqual(parsePoolMateCallbackData(claimCallbackData("order-1", 2)), {
    action: "claim",
    orderId: "order-1",
    units: 2
  });
  assert.deepEqual(parsePoolMateCallbackData(leaveCallbackData("order-1")), {
    action: "leave",
    orderId: "order-1"
  });
  assert.deepEqual(parsePoolMateCallbackData(quoteCallbackData("order-1")), {
    action: "quote",
    orderId: "order-1"
  });
  assert.deepEqual(parsePoolMateCallbackData(closeCallbackData("order-1")), {
    action: "close",
    orderId: "order-1"
  });
  assert.deepEqual(
    parsePoolMateCallbackData(publishDraftCallbackData("order-1")),
    { action: "publish", orderId: "order-1" }
  );
  assert.deepEqual(
    parsePoolMateCallbackData(discardDraftCallbackData("order-1")),
    { action: "discard", orderId: "order-1" }
  );

  const { useCases, calls } = createUseCases();
  const { bot } = createHarness(useCases);
  const data = claimCallbackData("order-1", 1);
  await bot.handleUpdate(callbackUpdate(200, "callback-stable", data));
  await bot.handleUpdate(callbackUpdate(201, "callback-stable", data));

  assert.equal(calls.claim.length, 2);
  assert.equal(
    calls.claim[0].sourceIdempotencyKey,
    "telegram:callback:v1:callback-stable"
  );
  assert.equal(
    calls.claim[1].sourceIdempotencyKey,
    calls.claim[0].sourceIdempotencyKey
  );
});

test("draft callbacks publish or discard through deterministic use cases", async () => {
  const { useCases, calls } = createUseCases();
  const { bot } = createHarness(useCases);

  await bot.handleUpdate(
    callbackUpdate(205, "callback-publish", publishDraftCallbackData("order-1"))
  );
  await bot.handleUpdate(
    callbackUpdate(206, "callback-discard", discardDraftCallbackData("order-1"))
  );

  assert.equal(calls.publish.length, 1);
  assert.equal(calls.publish[0]?.actor.userId, "101");
  assert.equal(calls.discard.length, 1);
  assert.equal(calls.discard[0]?.actor.userId, "101");
  assert.equal(calls.quote.length, 0);
});

test("close callback calls the owner-only use case and reports no receipt", async () => {
  const { useCases, calls } = createUseCases();
  const { bot, apiCalls } = createHarness(useCases);

  await bot.handleUpdate(
    callbackUpdate(210, "callback-close", closeCallbackData("order-1"))
  );

  assert.deepEqual(calls.close, [
    {
      sourceIdempotencyKey: "telegram:callback:v1:callback-close",
      telegramChatId: "-500",
      orderId: "order-1",
      actor: { userId: "101", displayName: "Alice Chen" }
    }
  ]);
  const reply = apiCalls.find((call) => call.method === "sendMessage");
  assert.match(
    String(reply?.payload.text),
    /No settlement receipt was created/
  );
  assert.match(String(reply?.payload.text), /State: CANCELED/);
});

test("quote reports private delivery failures without another business call", async () => {
  const quoteResult: QuotePoolFromBotResult = {
    order: quotedOrder,
    confirmationDeliveries: [
      {
        participantId: "participant-1",
        displayName: "Alice",
        telegramUserId: "101",
        url: "https://poolmate.example/confirm#token=token-a"
      },
      {
        participantId: "participant-2",
        displayName: "Bob",
        telegramUserId: "202",
        url: "https://poolmate.example/confirm#token=token-b"
      }
    ]
  };
  const { useCases, calls } = createUseCases(quoteResult);
  const { bot, apiCalls } = createHarness(useCases, "202");

  await bot.handleUpdate(commandUpdate(300, "/pool_quote order-1"));

  assert.equal(calls.quote.length, 1);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.claim.length, 0);
  assert.equal(calls.leave.length, 0);
  assert.equal(calls.remind.length, 0);
  const groupReply = apiCalls.find(
    (call) =>
      call.method === "sendMessage" &&
      String((call.payload as { chat_id: number }).chat_id) === "-500"
  );
  assert.match(String(groupReply?.payload.text), /delivered: 1\/2/);
  assert.match(String(groupReply?.payload.text), /Delivery failed for: Bob/);
  assert.match(
    String(groupReply?.payload.text),
    /No payment status was changed/
  );
  const privateReply = apiCalls.find(
    (call) =>
      call.method === "sendMessage" &&
      String((call.payload as { chat_id: number }).chat_id) === "101"
  );
  const button = (
    privateReply?.payload.reply_markup as {
      inline_keyboard: Array<
        Array<{ web_app?: { url?: string }; url?: string }>
      >;
    }
  ).inline_keyboard[0][0];
  assert.equal(
    button.web_app?.url,
    "https://poolmate.example/confirm#token=token-a"
  );
  assert.equal(button.url, undefined);
});

test("invalid callback data never reaches a business use case", async () => {
  const { useCases, calls } = createUseCases();
  const { bot, apiCalls } = createHarness(useCases);

  await bot.handleUpdate(
    callbackUpdate(400, "callback-invalid", "pm:v1:claim:../../etc:1")
  );

  assert.equal(
    calls.create.length +
      calls.claim.length +
      calls.leave.length +
      calls.close.length,
    0
  );
  assert.equal(calls.quote.length, 0);
  assert.equal(calls.remind.length, 0);
  assert.equal(apiCalls[0].method, "answerCallbackQuery");
  assert.equal(apiCalls[0].payload.show_alert, true);
});

test("quote command rejects caller-supplied merchant and amount fields", async () => {
  const { useCases, calls } = createUseCases();
  const { bot } = createHarness(useCases);

  await bot.handleUpdate(
    commandUpdate(500, "/pool_quote order-1 merchant-evil 1")
  );

  assert.deepEqual(calls.quote, []);
});

test("pool commands and callbacks fail closed outside a Telegram group", async () => {
  const { useCases, calls } = createUseCases();
  const { bot } = createHarness(useCases);

  await bot.handleUpdate(privateCommandUpdate(600, "/pool_new 3 Fruit"));
  await bot.handleUpdate(privateCommandUpdate(601, "/pool_claim order-1 1"));
  await bot.handleUpdate(privateCommandUpdate(602, "/pool_leave order-1"));
  await bot.handleUpdate(privateCommandUpdate(603, "/pool_close order-1"));
  await bot.handleUpdate(privateCommandUpdate(604, "/pool_quote order-1"));
  await bot.handleUpdate(privateCommandUpdate(605, "/pool_remind order-1"));
  await bot.handleUpdate(
    privateCallbackUpdate(
      606,
      "private-callback",
      claimCallbackData("order-1", 1)
    )
  );

  assert.equal(calls.create.length, 0);
  assert.equal(calls.claim.length, 0);
  assert.equal(calls.leave.length, 0);
  assert.equal(calls.close.length, 0);
  assert.equal(calls.quote.length, 0);
  assert.equal(calls.remind.length, 0);
});

test("remind retries request fresh pending links after a DM failure", async () => {
  const { useCases, calls } = createUseCases();
  let reminderVersion = 0;
  useCases.remindPool = async (input) => {
    calls.remind.push(input);
    reminderVersion += 1;
    return {
      order: quotedOrder,
      confirmationDeliveries: [
        {
          participantId: "participant-2",
          displayName: "Bob",
          telegramUserId: "202",
          url: `https://poolmate.example/confirm#token=rotated-${reminderVersion}`
        }
      ]
    };
  };
  const { bot, apiCalls } = createHarness(useCases, "202", 1);

  await bot.handleUpdate(commandUpdate(700, "/pool_remind order-1"));
  await bot.handleUpdate(commandUpdate(701, "/pool_remind order-1"));

  assert.deepEqual(
    calls.remind.map((call) => call.sourceIdempotencyKey),
    ["telegram:update:v1:700", "telegram:update:v1:701"]
  );
  const attempts = apiCalls.filter(
    (call) =>
      call.method === "sendMessage" &&
      String((call.payload as { chat_id: number }).chat_id) === "202"
  );
  assert.equal(attempts.length, 2);
  const urls = attempts.map(
    (call) =>
      (
        call.payload.reply_markup as {
          inline_keyboard: Array<Array<{ web_app: { url: string } }>>;
        }
      ).inline_keyboard[0][0].web_app.url
  );
  assert.deepEqual(urls, [
    "https://poolmate.example/confirm#token=rotated-1",
    "https://poolmate.example/confirm#token=rotated-2"
  ]);
});

test("quote summary reports declined confirmation without implying payment", async () => {
  const declinedOrder: OrderDetailView = {
    ...quotedOrder,
    checkout: {
      ...quotedOrder.checkout!,
      allocations: quotedOrder.checkout!.allocations.map((allocation) =>
        allocation.participantId === "participant-1"
          ? {
              ...allocation,
              status: "FAILED",
              confirmationStatus: "declined"
            }
          : allocation
      )
    }
  };
  const { useCases } = createUseCases({
    order: declinedOrder,
    confirmationDeliveries: [
      {
        participantId: "participant-1",
        displayName: "Alice",
        telegramUserId: "101",
        url: "https://poolmate.example/confirm#token=must-not-send"
      },
      {
        participantId: "participant-2",
        displayName: "Bob",
        telegramUserId: "202",
        url: "https://poolmate.example/confirm#token=pending-bob"
      }
    ]
  });
  const { bot, apiCalls } = createHarness(useCases);

  await bot.handleUpdate(commandUpdate(800, "/pool_quote order-1"));

  assert.equal(
    apiCalls.some(
      (call) =>
        call.method === "sendMessage" &&
        String((call.payload as { chat_id: number }).chat_id) === "101"
    ),
    false
  );
  const summary = apiCalls.find(
    (call) =>
      call.method === "sendMessage" &&
      String((call.payload as { chat_id: number }).chat_id) === "-500"
  );
  assert.match(String(summary?.payload.text), /1 declined/);
  assert.match(String(summary?.payload.text), /not ready for payment/);
  assert.doesNotMatch(String(summary?.payload.text), /payment confirmed/i);
});

test("confirmation delivery accepts only HTTPS WebApp fragment links", async () => {
  const { useCases } = createUseCases({
    order: quotedOrder,
    confirmationDeliveries: [
      {
        participantId: "participant-1",
        displayName: "Alice",
        telegramUserId: "101",
        url: "http://poolmate.example/confirm#token=insecure"
      },
      {
        participantId: "participant-2",
        displayName: "Bob",
        telegramUserId: "202",
        url: "https://poolmate.example/confirm/token-in-path"
      }
    ]
  });
  const { bot, apiCalls } = createHarness(useCases);

  await bot.handleUpdate(commandUpdate(900, "/pool_quote order-1"));

  assert.equal(
    apiCalls.some(
      (call) =>
        call.method === "sendMessage" &&
        Number((call.payload as { chat_id: number }).chat_id) > 0
    ),
    false
  );
  const summary = apiCalls.find(
    (call) =>
      call.method === "sendMessage" &&
      String((call.payload as { chat_id: number }).chat_id) === "-500"
  );
  assert.match(String(summary?.payload.text), /delivered: 0\/2/);
});
