import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loadConfig uses safe independent defaults", () => {
  const config = loadConfig({}, "/tmp/poolmate-config-test");

  assert.equal(config.app.port, 8788);
  assert.equal(config.telegram.token, undefined);
  assert.deepEqual(config.telegram.allowedUserIds, []);
  assert.equal(config.paymentBase.apiKey, undefined);
  assert.equal(config.paymentBase.settlementMode, "disabled");
  assert.match(config.database.path, /poolmate\.sqlite$/);
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

test("loadConfig normalizes non-secret runtime settings", () => {
  const config = loadConfig(
    {
      POOLMATE_HOST: "0.0.0.0",
      POOLMATE_PORT: "9000",
      TELEGRAM_ALLOWED_USER_IDS: "42, 42, 84",
      PAYMENT_BASE_URL: "https://payments.example.test",
      PAYMENT_BASE_API_KEY: "secret"
    },
    "/tmp/poolmate-config-test"
  );

  assert.equal(config.app.port, 9000);
  assert.deepEqual(config.telegram.allowedUserIds, ["42", "84"]);
  assert.equal(config.paymentBase.url, "https://payments.example.test");
});
