import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "../domain/domainError.js";

export interface ConfirmationIdentity {
  telegramUserId: string;
  username?: string;
}

export interface ConfirmationIdentityVerifier {
  verify(initData: string): Promise<ConfirmationIdentity>;
}

export interface TelegramWebAppIdentityVerifierOptions {
  botToken?: string;
  now?: () => Date;
  maxAgeSeconds?: number;
}

const MAX_INIT_DATA_LENGTH = 16 * 1024;
const FUTURE_CLOCK_TOLERANCE_SECONDS = 30;

function invalidIdentity(message: string): DomainError {
  return new DomainError("CONFIRMATION_IDENTITY_INVALID", message, 401);
}

export class TelegramWebAppIdentityVerifier implements ConfirmationIdentityVerifier {
  private readonly botToken: string;
  private readonly now: () => Date;
  private readonly maxAgeSeconds: number;

  constructor(options: TelegramWebAppIdentityVerifierOptions) {
    this.botToken = options.botToken?.trim() ?? "";
    this.now = options.now ?? (() => new Date());
    this.maxAgeSeconds = options.maxAgeSeconds ?? 300;
  }

  async verify(initData: string): Promise<ConfirmationIdentity> {
    if (!this.botToken) {
      throw new DomainError(
        "CONFIRMATION_IDENTITY_REQUIRED",
        "Telegram confirmation identity is not configured.",
        503
      );
    }
    if (!initData || initData.length > MAX_INIT_DATA_LENGTH) {
      throw invalidIdentity("Telegram WebApp identity data is invalid.");
    }

    const parameters = new URLSearchParams(initData);
    const uniqueKeys = new Set<string>();
    for (const key of parameters.keys()) {
      if (uniqueKeys.has(key)) {
        throw invalidIdentity("Telegram WebApp identity data is ambiguous.");
      }
      uniqueKeys.add(key);
    }
    const providedHash = parameters.get("hash") ?? "";
    if (!/^[a-f0-9]{64}$/i.test(providedHash)) {
      throw invalidIdentity("Telegram WebApp identity signature is missing.");
    }

    const dataCheckString = [...parameters.entries()]
      .filter(([key]) => key !== "hash")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secretKey = createHmac("sha256", "WebAppData")
      .update(this.botToken, "utf8")
      .digest();
    const expectedHash = createHmac("sha256", secretKey)
      .update(dataCheckString, "utf8")
      .digest();
    const providedHashBuffer = Buffer.from(providedHash, "hex");
    if (
      providedHashBuffer.length !== expectedHash.length ||
      !timingSafeEqual(providedHashBuffer, expectedHash)
    ) {
      throw invalidIdentity("Telegram WebApp identity signature is invalid.");
    }

    const authDate = Number(parameters.get("auth_date"));
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (
      !Number.isSafeInteger(authDate) ||
      authDate <= 0 ||
      authDate > nowSeconds + FUTURE_CLOCK_TOLERANCE_SECONDS ||
      nowSeconds - authDate > this.maxAgeSeconds
    ) {
      throw invalidIdentity("Telegram WebApp identity has expired.");
    }

    let user: unknown;
    try {
      user = JSON.parse(parameters.get("user") ?? "");
    } catch {
      throw invalidIdentity("Telegram WebApp user identity is invalid.");
    }
    if (
      typeof user !== "object" ||
      user === null ||
      !("id" in user) ||
      !Number.isSafeInteger((user as { id: unknown }).id) ||
      Number((user as { id: number }).id) <= 0
    ) {
      throw invalidIdentity("Telegram WebApp user identity is invalid.");
    }

    const username =
      "username" in user &&
      typeof (user as { username?: unknown }).username === "string" &&
      /^[A-Za-z0-9_]{1,32}$/.test((user as { username: string }).username)
        ? (user as { username: string }).username
        : undefined;
    return {
      telegramUserId: String((user as { id: number }).id),
      ...(username ? { username } : {})
    };
  }
}
