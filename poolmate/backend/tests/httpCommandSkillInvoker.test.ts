import assert from "node:assert/strict";
import test from "node:test";
import {
  createCommandSkillInvoker,
  type CreateCommandSkillInvokerOptions
} from "../src/infrastructure/llm/httpCommandSkillInvoker.js";
import { CommandSkillInvokerError } from "../src/bot/help/commandSkillInvoker.js";

function chatCompletionWithSkillCall(call: unknown): string {
  return JSON.stringify({
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify(call)
        }
      }
    ]
  });
}

test("HTTP command skill invoker calls explicit Markdown command skills", async () => {
  let captured: Parameters<
    NonNullable<CreateCommandSkillInvokerOptions["transport"]>["send"]
  >[0];
  const invoker = createCommandSkillInvoker({
    enabled: true,
    provider: "deepseek",
    baseUrl: "https://aiping.cn/api/v1",
    apiKey: "provider-secret",
    model: "DeepSeek-V3.2",
    transport: {
      async send(request) {
        captured = request;
        return {
          status: 200,
          body: chatCompletionWithSkillCall({
            skillId: "debug_virtual_participants",
            confidence: 0.92,
            reason: "virtual test participants"
          })
        };
      }
    }
  });

  assert.deepEqual(
    await invoker.invoke({
      text: "帮我加两个虚拟人测试",
      locale: "zh",
      surface: "telegram_command"
    }),
    {
      skillId: "debug_virtual_participants",
      confidence: 0.92,
      reason: "virtual test participants"
    }
  );
  assert.equal(
    captured!.url.toString(),
    "https://aiping.cn/api/v1/chat/completions"
  );
  const body = JSON.parse(captured!.body);
  assert.match(body.messages[0].content, /^Use the following Markdown skill/);
  assert.match(
    body.messages[0].content,
    /Choose exactly one Command Skill to call/
  );
  assert.match(body.messages[0].content, /debug_virtual_participants/);
  assert.match(body.messages[0].content, /\/pool_test <orderId> \+N/);
  assert.match(body.messages[0].content, /Do not execute commands/);
  assert.match(body.messages[1].content, /Surface: telegram_command/);
  assert.match(body.messages[1].content, /帮我加两个虚拟人测试/);
  assert.equal(JSON.stringify(body).includes("provider-secret"), false);
});

test("disabled command skill invoker fails closed", async () => {
  const invoker = createCommandSkillInvoker({ enabled: false });
  assert.equal(invoker.getStatus(), "disabled");
  await assert.rejects(
    invoker.invoke({ text: "show help" }),
    (error) =>
      error instanceof CommandSkillInvokerError && error.code === "LLM_DISABLED"
  );
});
