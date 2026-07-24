import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "../src/agent/agentRuntime.js";
import { buildAgentProcessEnv } from "../src/runtime/processEnv.js";

test("AgentRuntime exposes execution modes and observable state changes", async () => {
  const timestamps = [
    new Date("2026-07-25T01:00:00.000Z"),
    new Date("2026-07-25T01:00:02.000Z")
  ];
  const runtime = new AgentRuntime({
    executors: {
      sdk: async ({ prompt }) => ({
        output: `result:${prompt}`,
        sessionId: "session-1"
      })
    },
    now: () => timestamps.shift() ?? new Date("2026-07-25T01:00:02.000Z")
  });
  const observed: string[] = [];
  const unsubscribe = runtime.subscribe((status) => {
    observed.push(`${status.state}:${status.activeMode ?? "none"}`);
  });

  assert.deepEqual(runtime.getStatus().supportedModes, ["sdk"]);
  const result = await runtime.run({ mode: "sdk", prompt: "  quote order  " });
  unsubscribe();

  assert.deepEqual(result, {
    output: "result:quote order",
    sessionId: "session-1"
  });
  assert.deepEqual(observed, ["idle:none", "running:sdk", "idle:none"]);
  assert.deepEqual(runtime.getStatus(), {
    state: "idle",
    activeMode: null,
    lastMode: "sdk",
    supportedModes: ["sdk"],
    startedAt: "2026-07-25T01:00:00.000Z",
    completedAt: "2026-07-25T01:00:02.000Z",
    error: null
  });
});

test("AgentRuntime records executor failures without losing the last mode", async () => {
  const runtime = new AgentRuntime({
    executors: {
      exec: async () => {
        throw new Error("executor unavailable");
      }
    }
  });

  await assert.rejects(
    runtime.run({ mode: "exec", prompt: "inspect order" }),
    /executor unavailable/
  );
  assert.equal(runtime.getStatus().state, "error");
  assert.equal(runtime.getStatus().lastMode, "exec");
  assert.equal(runtime.getStatus().error, "executor unavailable");

  runtime.resetError();
  assert.equal(runtime.getStatus().state, "idle");
  assert.equal(runtime.getStatus().error, null);
});

test("agent subprocess environment excludes application secrets", () => {
  const environment = buildAgentProcessEnv({
    PATH: "/usr/bin",
    HOME: "/tmp/agent-home",
    TERM: "xterm-256color",
    CODEX_HOME: "/tmp/codex",
    OPENAI_API_KEY: "openai-key",
    TELEGRAM_BOT_TOKEN: "telegram-secret",
    POOLMATE_DATABASE_PATH: "/data/poolmate.db",
    POOLMATE_ADMIN_API_KEY: "admin-secret",
    PAYMENT_BASE_URL: "https://payments.example.test",
    PAYMENT_BASE_API_KEY: "payment-secret"
  });

  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    HOME: "/tmp/agent-home",
    TERM: "xterm-256color",
    CODEX_HOME: "/tmp/codex",
    OPENAI_API_KEY: "openai-key"
  });
});
