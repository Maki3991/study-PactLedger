import assert from "node:assert/strict";
import test from "node:test";
import { createPoolMateBot } from "../src/bot/grammy/createBot.js";
import { DomainError } from "../src/domain/domainError.js";

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

function createHarness(allowedUserIds = ["101"], userAllowlistEnabled = true) {
  const calls: ApiCall[] = [];
  const bot = createPoolMateBot({
    token: "123456:test-token",
    userAllowlistEnabled,
    allowedUserIds,
    getBotStatus: () => "running"
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
    calls.push({
      method,
      payload: payload as Record<string, unknown>
    });

    if (method === "sendMessage") {
      return {
        ok: true,
        result: {
          message_id: 900,
          date: 1_753_405_200,
          chat: {
            id: Number((payload as { chat_id: number }).chat_id),
            type: "private",
            first_name: "Allowed User"
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

  return { bot, calls };
}

function commandUpdate(updateId: number, userId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_753_405_200,
      from: {
        id: userId,
        is_bot: false,
        first_name: "Test User",
        language_code: "en"
      },
      chat: {
        id: userId,
        type: "private" as const,
        first_name: "Test User"
      },
      text,
      entities: [
        {
          offset: 0,
          length: text.length,
          type: "bot_command" as const
        }
      ]
    }
  };
}

function callbackUpdate(updateId: number, userId: number, data = "probe") {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: {
        id: userId,
        is_bot: false,
        first_name: "Test User"
      },
      chat_instance: "test-chat",
      data
    }
  };
}

test("grammY handles /start and /status without live Telegram calls", async () => {
  const { bot, calls } = createHarness();

  await bot.handleUpdate(commandUpdate(1, 101, "/start"));
  await bot.handleUpdate(commandUpdate(2, 101, "/status"));

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "sendMessage");
  assert.match(String(calls[0].payload.text), /PoolMate is ready/);
  assert.match(String(calls[1].payload.text), /Bot: running/);
  assert.match(
    String(calls[1].payload.text),
    /Natural-language drafts: disabled/
  );
});

test("grammY silently blocks commands from users outside the allowlist", async () => {
  const { bot, calls } = createHarness();

  await bot.handleUpdate(commandUpdate(3, 999, "/start"));
  await bot.handleUpdate(commandUpdate(4, 999, "/status"));

  assert.deepEqual(calls, []);
});

test("grammY accepts users when the allowlist is disabled", async () => {
  const { bot, calls } = createHarness([], false);

  await bot.handleUpdate(commandUpdate(30, 999, "/start"));

  assert.equal(calls.length, 1);
  assert.match(String(calls[0].payload.text), /PoolMate is ready/);
});

test("grammY access middleware checks callback query origin", async () => {
  const { bot, calls } = createHarness();
  let handled = 0;
  bot.callbackQuery("probe", async (context) => {
    handled += 1;
    await context.answerCallbackQuery();
  });

  await bot.handleUpdate(callbackUpdate(5, 999));
  await bot.handleUpdate(callbackUpdate(6, 101));

  assert.equal(handled, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "answerCallbackQuery");
});

test("grammY does not register legacy command handlers", async () => {
  const { bot, calls } = createHarness();

  await bot.handleUpdate(commandUpdate(7, 101, "/sh"));
  await bot.handleUpdate(commandUpdate(8, 101, "/mcp"));
  await bot.handleUpdate(commandUpdate(9, 101, "/repo"));

  assert.deepEqual(calls, []);
});

test("grammY reports expected domain conflicts instead of a generic failure", async () => {
  const { bot, calls } = createHarness();
  bot.callbackQuery("locked-action", async () => {
    throw new DomainError(
      "INVALID_ORDER_STATE",
      "Claims are locked after checkout confirmation begins."
    );
  });

  await bot.handleUpdate(callbackUpdate(10, 101, "locked-action"));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "answerCallbackQuery");
  assert.equal(calls[0]?.payload.show_alert, true);
  assert.equal(
    calls[0]?.payload.text,
    "Claims are locked after checkout confirmation begins."
  );
});
