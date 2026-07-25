import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { TelegramWebAppIdentityVerifier } from "../src/api/telegramWebAppIdentityVerifier.js";
import { DomainError } from "../src/domain/domainError.js";

const BOT_TOKEN = "123456:test-token";
const NOW = new Date("2026-07-25T12:00:00.000Z");

function signedInitData(
  userId: number,
  authDate: number,
  username?: string
): string {
  const parameters = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAEAAAE",
    user: JSON.stringify({
      id: userId,
      first_name: "Ada",
      ...(username ? { username } : {})
    })
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  parameters.set(
    "hash",
    createHmac("sha256", secretKey).update(dataCheckString).digest("hex")
  );
  return parameters.toString();
}

test("Telegram WebApp identity verifies signature, freshness, and user id", async () => {
  const verifier = new TelegramWebAppIdentityVerifier({
    botToken: BOT_TOKEN,
    now: () => NOW
  });
  const authDate = Math.floor(NOW.getTime() / 1000) - 30;

  assert.deepEqual(await verifier.verify(signedInitData(101, authDate)), {
    telegramUserId: "101"
  });
});

test("Telegram WebApp identity preserves a signed @username for group feedback", async () => {
  const verifier = new TelegramWebAppIdentityVerifier({
    botToken: BOT_TOKEN,
    now: () => NOW
  });
  const authDate = Math.floor(NOW.getTime() / 1000) - 30;

  assert.deepEqual(
    await verifier.verify(signedInitData(101, authDate, "ada_user")),
    { telegramUserId: "101", username: "ada_user" }
  );
});

test("Telegram WebApp identity rejects tampering and stale proofs", async () => {
  const verifier = new TelegramWebAppIdentityVerifier({
    botToken: BOT_TOKEN,
    now: () => NOW,
    maxAgeSeconds: 300
  });
  const current = Math.floor(NOW.getTime() / 1000);
  const tampered = signedInitData(101, current).replace(
    encodeURIComponent('"id":101'),
    encodeURIComponent('"id":102')
  );

  await assert.rejects(
    verifier.verify(tampered),
    (error) =>
      error instanceof DomainError &&
      error.code === "CONFIRMATION_IDENTITY_INVALID"
  );
  await assert.rejects(
    verifier.verify(signedInitData(101, current - 301)),
    (error) =>
      error instanceof DomainError &&
      error.code === "CONFIRMATION_IDENTITY_INVALID"
  );
});

test("Telegram WebApp identity fails closed without a bot token", async () => {
  const verifier = new TelegramWebAppIdentityVerifier({ now: () => NOW });
  await assert.rejects(
    verifier.verify("auth_date=1&hash=invalid"),
    (error) =>
      error instanceof DomainError &&
      error.code === "CONFIRMATION_IDENTITY_REQUIRED"
  );
});
