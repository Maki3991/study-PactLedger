import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loadConfig uses safe independent defaults", () => {
  const config = loadConfig({}, "/tmp/poolmate-config-test");

  assert.equal(config.app.port, 8788);
  assert.equal(config.telegram.token, undefined);
  assert.equal(config.telegram.userAllowlistEnabled, false);
  assert.deepEqual(config.telegram.allowedUserIds, []);
  assert.equal(config.telegram.standaloneBotEnabled, false);
  assert.equal(config.paymentBase.apiKey, undefined);
  assert.equal(config.paymentBase.settlementMode, "disabled");
  assert.equal(config.paymentBase.submitPath, undefined);
  assert.equal(config.paymentBase.timeoutMs, 10_000);
  assert.match(config.database.path, /poolmate\.sqlite$/);
});

test("loadConfig keeps the standalone bot opt-in even with a token present", () => {
  const withToken = loadConfig(
    {
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      POOLMATE_PUBLIC_BASE_URL: "https://poolmate.example"
    },
    "/tmp/poolmate-config-test"
  );
  assert.equal(withToken.telegram.standaloneBotEnabled, false);

  const optedIn = loadConfig(
    {
      TELEGRAM_BOT_TOKEN: "telegram-secret",
      POOLMATE_PUBLIC_BASE_URL: "https://poolmate.example",
      POOLMATE_STANDALONE_BOT: "true"
    },
    "/tmp/poolmate-config-test"
  );
  assert.equal(optedIn.telegram.standaloneBotEnabled, true);
});

test("loadConfig rejects credentials in the public URL", () => {
  assert.throws(
    () =>
      loadConfig(
        { POOLMATE_PUBLIC_BASE_URL: "https://user:secret@example.test" },
        "/tmp/poolmate-config-test"
      ),
    /cannot contain credentials/
  );
});

test("Telegram requires an external HTTPS frontend origin", () => {
  assert.throws(
    () =>
      loadConfig(
        {
          TELEGRAM_BOT_TOKEN: "telegram-secret",
          POOLMATE_PUBLIC_BASE_URL: "http://localhost:8788"
        },
        "/tmp/poolmate-config-test"
      ),
    /external HTTPS frontend origin/
  );
  assert.throws(
    () =>
      loadConfig(
        {
          TELEGRAM_BOT_TOKEN: "telegram-secret",
          POOLMATE_PUBLIC_BASE_URL: "https://poolmate.example.invalid"
        },
        "/tmp/poolmate-config-test"
      ),
    /external HTTPS frontend origin/
  );
  assert.equal(
    loadConfig(
      {
        TELEGRAM_BOT_TOKEN: "telegram-secret",
        POOLMATE_PUBLIC_BASE_URL: "https://poolmate.example.com"
      },
      "/tmp/poolmate-config-test"
    ).app.publicBaseUrl,
    "https://poolmate.example.com"
  );
});

test("loadConfig normalizes non-secret runtime settings", () => {
  const config = loadConfig(
    {
      POOLMATE_HOST: "0.0.0.0",
      POOLMATE_PORT: "9000",
      TELEGRAM_USER_ALLOWLIST_ENABLED: "true",
      TELEGRAM_ALLOWED_USER_IDS: "42, 42, 84",
      PAYMENT_BASE_URL: "https://payments.example.test",
      PAYMENT_BASE_API_KEY: "secret",
      PAYMENT_BASE_SUBMIT_PATH: "/v1/payment-operations",
      PAYMENT_BASE_RECOVER_PATH: "/v1/payment-operations/{operationId}",
      PAYMENT_BASE_TIMEOUT_MS: "5000"
    },
    "/tmp/poolmate-config-test"
  );

  assert.equal(config.app.port, 9000);
  assert.equal(config.telegram.userAllowlistEnabled, true);
  assert.deepEqual(config.telegram.allowedUserIds, ["42", "84"]);
  assert.equal(config.paymentBase.url, "https://payments.example.test");
  assert.equal(config.paymentBase.submitPath, "/v1/payment-operations");
  assert.equal(config.paymentBase.timeoutMs, 5_000);
});

test("loadConfig rejects an ambiguous Telegram allowlist switch", () => {
  assert.throws(
    () =>
      loadConfig(
        { TELEGRAM_USER_ALLOWLIST_ENABLED: "yes" },
        "/tmp/poolmate-config-test"
      ),
    /must be true or false/
  );
});
