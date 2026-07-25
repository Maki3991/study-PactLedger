import type { ApiErrorCode } from "@poolmate/shared";

export class DomainError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly statusCode: number = 409
  ) {
    super(message);
    this.name = "DomainError";
  }
}
