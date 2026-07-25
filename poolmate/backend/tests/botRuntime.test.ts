import assert from "node:assert/strict";
import test from "node:test";
import { createBotRuntime } from "../src/bot/grammy/createBot.js";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("bot runtime is disabled without a Telegram token", async () => {
  let created = false;
  const runtime = createBotRuntime(
    { userAllowlistEnabled: false, allowedUserIds: ["101"] },
    {
      createBot: () => {
        created = true;
        throw new Error("must not create a bot");
      }
    }
  );

  assert.equal(runtime.getStatus(), "disabled");
  await runtime.start();
  await runtime.stop();
  assert.equal(runtime.getStatus(), "disabled");
  assert.equal(created, false);
});

test("bot runtime starts without users when the allowlist is disabled", async () => {
  const polling = deferred();
  let created = false;
  const runtime = createBotRuntime(
    {
      token: "test-token",
      userAllowlistEnabled: false,
      allowedUserIds: []
    },
    {
      createBot: () => {
        created = true;
        return {
          init: async () => undefined,
          start: () => polling.promise,
          stop: async () => polling.resolve()
        };
      }
    }
  );

  assert.equal(runtime.getStatus(), "configured");
  await runtime.start();
  assert.equal(runtime.getStatus(), "running");
  assert.equal(created, true);
  await runtime.stop();
});

test("bot runtime fails closed when the enabled allowlist is empty", async () => {
  let created = false;
  const runtime = createBotRuntime(
    {
      token: "test-token",
      userAllowlistEnabled: true,
      allowedUserIds: []
    },
    {
      createBot: () => {
        created = true;
        throw new Error("must not create a bot");
      }
    }
  );

  assert.equal(runtime.getStatus(), "error");
  await runtime.start();
  assert.equal(runtime.getStatus(), "error");
  assert.equal(created, false);
});

test("bot runtime reports configured, running, and configured lifecycle", async () => {
  const polling = deferred();
  let initialized = false;
  let stopped = false;
  const runtime = createBotRuntime(
    {
      token: "test-token",
      userAllowlistEnabled: true,
      allowedUserIds: ["101"]
    },
    {
      createBot: () => ({
        init: async () => {
          initialized = true;
        },
        start: () => polling.promise,
        stop: async () => {
          stopped = true;
          polling.resolve();
        }
      })
    }
  );

  assert.equal(runtime.getStatus(), "configured");
  await runtime.start();
  assert.equal(initialized, true);
  assert.equal(runtime.getStatus(), "running");

  await runtime.stop();
  assert.equal(stopped, true);
  assert.equal(runtime.getStatus(), "configured");
});

test("bot runtime exposes Telegram initialization failures", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const runtime = createBotRuntime(
      {
        token: "test-token",
        userAllowlistEnabled: true,
        allowedUserIds: ["101"]
      },
      {
        createBot: () => ({
          init: async () => {
            throw new Error("Telegram unavailable");
          },
          start: async () => undefined,
          stop: async () => undefined
        })
      }
    );

    await runtime.start();
    assert.equal(runtime.getStatus(), "error");
  } finally {
    console.error = originalError;
  }
});
