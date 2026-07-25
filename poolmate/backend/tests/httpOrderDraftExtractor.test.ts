import assert from "node:assert/strict";
import test from "node:test";
import {
  createOrderDraftExtractor,
  type OrderDraftHttpTransportRequest
} from "../src/infrastructure/llm/httpOrderDraftExtractor.js";
import { OrderDraftExtractorError } from "../src/application/ports/orderDraftExtractor.js";

function responseWithDraft(draft: unknown): string {
  return JSON.stringify({
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(draft)
          }
        ]
      }
    ]
  });
}

function chatCompletionWithDraft(draft: unknown): string {
  return JSON.stringify({
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify(draft)
        }
      }
    ]
  });
}

test("HTTP extractor sends strict Structured Output and returns a draft patch", async () => {
  let captured: OrderDraftHttpTransportRequest | undefined;
  const extractor = createOrderDraftExtractor({
    enabled: true,
    baseUrl: "https://llm.example.test",
    apiKey: "llm-secret",
    model: "draft-model",
    transport: {
      async send(request) {
        captured = request;
        return {
          status: 200,
          body: responseWithDraft({
            title: "Three fruit boxes",
            itemName: "杨梅",
            targetUnits: 3,
            unit: "箱",
            purchaseChannelHint: null,
            storeNameHint: null,
            merchantLinkHint: null,
            userPriceHint: null,
            missingFields: [],
            ambiguousFields: []
          })
        };
      }
    }
  });

  const result = await extractor.extract({
    text: "拼三箱杨梅",
    locale: "zh"
  });
  assert.deepEqual(result, {
    title: "Three fruit boxes",
    itemName: "杨梅",
    targetUnits: 3,
    unit: "箱",
    purchaseChannelHint: null,
    storeNameHint: null,
    merchantLinkHint: null,
    userPriceHint: null,
    missingFields: [],
    ambiguousFields: []
  });
  assert.equal(extractor.getStatus(), "configured");
  assert.equal(
    captured?.url.toString(),
    "https://llm.example.test/v1/responses"
  );
  assert.equal(captured?.headers.authorization, "Bearer llm-secret");
  const requestBody = JSON.parse(captured!.body);
  assert.equal(requestBody.model, "draft-model");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.text.format.schema.additionalProperties, false);
  assert.deepEqual(requestBody.text.format.schema.required, [
    "title",
    "itemName",
    "targetUnits",
    "unit",
    "purchaseChannelHint",
    "storeNameHint",
    "merchantLinkHint",
    "userPriceHint",
    "missingFields",
    "ambiguousFields"
  ]);
  assert.equal("payeeId" in requestBody.text.format.schema.properties, false);
  assert.equal(JSON.stringify(requestBody).includes("llm-secret"), false);
});

test("extractor accepts explicit missing fields without inventing an order", async () => {
  const extractor = createOrderDraftExtractor({
    enabled: true,
    baseUrl: "https://llm.example.test",
    apiKey: "secret",
    model: "draft-model",
    transport: {
      async send() {
        return {
          status: 200,
          body: responseWithDraft({
            title: "Fruit boxes",
            itemName: "Fruit",
            targetUnits: null,
            unit: null,
            purchaseChannelHint: null,
            storeNameHint: null,
            merchantLinkHint: null,
            userPriceHint: null,
            missingFields: ["targetUnits"],
            ambiguousFields: []
          })
        };
      }
    }
  });

  assert.deepEqual(await extractor.extract({ text: "pool fruit boxes" }), {
    title: "Fruit boxes",
    itemName: "Fruit",
    targetUnits: null,
    unit: null,
    purchaseChannelHint: null,
    storeNameHint: null,
    merchantLinkHint: null,
    userPriceHint: null,
    missingFields: ["targetUnits"],
    ambiguousFields: []
  });
});

test("extractor derives a display title instead of requiring it from the user", async () => {
  const extractor = createOrderDraftExtractor({
    enabled: true,
    provider: "deepseek",
    baseUrl: "https://aiping.cn/api/v1",
    apiKey: "provider-secret",
    model: "DeepSeek-V3.2",
    transport: {
      async send() {
        return {
          status: 200,
          body: chatCompletionWithDraft({
            title: null,
            itemName: "可乐",
            targetUnits: 2,
            unit: "瓶",
            purchaseChannelHint: "淘宝外卖",
            storeNameHint: null,
            merchantLinkHint: null,
            userPriceHint: null,
            missingFields: ["title"],
            ambiguousFields: []
          })
        };
      }
    }
  });

  assert.deepEqual(
    await extractor.extract({
      text: "我们要2瓶可乐，淘宝外卖",
      locale: "zh"
    }),
    {
      title: "可乐拼单",
      itemName: "可乐",
      targetUnits: 2,
      unit: "瓶",
      purchaseChannelHint: "淘宝外卖",
      storeNameHint: null,
      merchantLinkHint: null,
      userPriceHint: null,
      missingFields: [],
      ambiguousFields: []
    }
  );
});

test("OpenAI-compatible chat completions preserve purchase-channel intent", async () => {
  let captured: OrderDraftHttpTransportRequest | undefined;
  const extractor = createOrderDraftExtractor({
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
          body: chatCompletionWithDraft({
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
          })
        };
      }
    }
  });

  assert.deepEqual(
    await extractor.extract({
      text: "@PoolMate 拼单 3瓶可乐，美团外卖",
      locale: "zh"
    }),
    {
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
    }
  );
  assert.equal(
    captured?.url.toString(),
    "https://aiping.cn/api/v1/chat/completions"
  );
  assert.equal(captured?.headers.authorization, "Bearer provider-secret");
  const requestBody = JSON.parse(captured!.body);
  assert.equal(requestBody.response_format.type, "json_object");
  assert.equal(requestBody.temperature, 0);
  assert.equal(requestBody.max_tokens, 1_000);
  assert.match(requestBody.messages[0].content, /purchaseChannelHint/);
  assert.match(requestBody.messages[0].content, /never a verified merchant/);
  assert.equal(JSON.stringify(requestBody).includes("provider-secret"), false);
});

test("OpenAI-compatible chat completions retry one invalid structured response", async () => {
  let attempts = 0;
  const extractor = createOrderDraftExtractor({
    enabled: true,
    provider: "deepseek",
    baseUrl: "https://aiping.cn/api/v1",
    apiKey: "provider-secret",
    model: "DeepSeek-V3.2",
    transport: {
      async send() {
        attempts += 1;
        if (attempts === 1) {
          return {
            status: 200,
            body: JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    role: "assistant",
                    content: "",
                    reasoning_content: "draft reasoning without final output"
                  }
                }
              ]
            })
          };
        }
        return {
          status: 200,
          body: chatCompletionWithDraft({
            title: "可乐拼单",
            itemName: "可乐",
            targetUnits: 3,
            unit: "瓶",
            purchaseChannelHint: "美团外卖",
            storeNameHint: null,
            merchantLinkHint: null,
            userPriceHint: null,
            missingFields: [],
            ambiguousFields: []
          })
        };
      }
    }
  });

  const result = await extractor.extract({
    text: "拼单 3瓶可乐，美团外卖",
    locale: "zh"
  });

  assert.equal(attempts, 2);
  assert.equal(result.purchaseChannelHint, "美团外卖");
  assert.equal(extractor.getStatus(), "configured");
});

test("extractor rejects refusals, extra payment fields, and malformed output", async () => {
  const bodies = [
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "refusal", refusal: "No" }]
        }
      ]
    }),
    responseWithDraft({
      title: "Fruit",
      itemName: "Fruit",
      targetUnits: 3,
      unit: null,
      purchaseChannelHint: null,
      storeNameHint: null,
      merchantLinkHint: null,
      userPriceHint: null,
      missingFields: [],
      ambiguousFields: [],
      merchantId: "attacker-merchant",
      payeeId: "attacker-payee",
      finalAmount: "1"
    }),
    "not-json"
  ];

  for (const body of bodies) {
    const extractor = createOrderDraftExtractor({
      enabled: true,
      baseUrl: "https://llm.example.test",
      apiKey: "secret",
      model: "draft-model",
      transport: { send: async () => ({ status: 200, body }) }
    });
    await assert.rejects(
      extractor.extract({ text: "create three fruit boxes" }),
      (error) =>
        error instanceof OrderDraftExtractorError &&
        (error.code === "LLM_REFUSED" || error.code === "LLM_INVALID_RESPONSE")
    );
    assert.equal(extractor.getStatus(), "unavailable");
  }
});

test("HTTP failures and timeouts expose unavailable status without leaking details", async () => {
  const rejected = createOrderDraftExtractor({
    enabled: true,
    baseUrl: "https://llm.example.test",
    apiKey: "secret",
    model: "draft-model",
    transport: {
      send: async () => ({ status: 429, body: '{"error":"quota"}' })
    }
  });
  await assert.rejects(
    rejected.extract({ text: "create three fruit boxes" }),
    (error) =>
      error instanceof OrderDraftExtractorError &&
      error.code === "LLM_UNAVAILABLE" &&
      !error.message.includes("quota")
  );
  assert.equal(rejected.getStatus(), "unavailable");

  const timedOut = createOrderDraftExtractor({
    enabled: true,
    baseUrl: "https://llm.example.test",
    apiKey: "secret",
    model: "draft-model",
    timeoutMs: 5,
    transport: { send: () => new Promise(() => undefined) }
  });
  await assert.rejects(
    timedOut.extract({ text: "create three fruit boxes" }),
    (error) =>
      error instanceof OrderDraftExtractorError &&
      error.code === "LLM_UNAVAILABLE"
  );
});

test("disabled and insecure configurations fail closed", async () => {
  const disabled = createOrderDraftExtractor({ enabled: false });
  assert.equal(disabled.getStatus(), "disabled");
  await assert.rejects(
    disabled.extract({ text: "create three fruit boxes" }),
    (error) =>
      error instanceof OrderDraftExtractorError && error.code === "LLM_DISABLED"
  );
  assert.throws(
    () =>
      createOrderDraftExtractor({
        enabled: true,
        baseUrl: "http://llm.example.test",
        apiKey: "secret",
        model: "draft-model"
      }),
    (error) =>
      error instanceof OrderDraftExtractorError &&
      error.code === "LLM_UNAVAILABLE"
  );
});
