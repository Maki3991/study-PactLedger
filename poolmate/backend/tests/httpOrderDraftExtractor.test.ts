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
            targetUnits: 3,
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
    targetUnits: 3,
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
    "targetUnits",
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
            targetUnits: null,
            missingFields: ["targetUnits"],
            ambiguousFields: []
          })
        };
      }
    }
  });

  assert.deepEqual(await extractor.extract({ text: "pool fruit boxes" }), {
    title: "Fruit boxes",
    targetUnits: null,
    missingFields: ["targetUnits"],
    ambiguousFields: []
  });
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
      targetUnits: 3,
      missingFields: [],
      ambiguousFields: [],
      payeeId: "attacker-payee"
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
