import type { PoolMatePaymentRequest, SettlementMode } from "@poolmate/shared";

export type PaymentBaseOutcome =
  | {
      status: "confirmed";
      operationId: string;
      settlementMode: Exclude<SettlementMode, "disabled">;
      receiptId: string;
      transactionHash: string;
      explorerUrl: string;
      confirmedAt: string;
    }
  | {
      status: "submitted" | "unknown" | "failed" | "approval_required";
      operationId: string;
      settlementMode: SettlementMode;
      errorCode?: string;
      errorMessage?: string;
    };

export interface PaymentBaseClient {
  readonly settlementMode: SettlementMode;
  submit(request: PoolMatePaymentRequest): Promise<PaymentBaseOutcome>;
  recover(operationId: string): Promise<PaymentBaseOutcome>;
}
