import type { BotStatus, OrderDetailView } from "@poolmate/shared";
import type { AgentRuntimeStatus } from "../agent/agentRuntime.js";

export interface PoolMateStatusView {
  bot: BotStatus;
  agent?: AgentRuntimeStatus;
}

function hasVerifiableReceipt(
  projection: NonNullable<OrderDetailView["paymentProjection"]>
): projection is NonNullable<OrderDetailView["paymentProjection"]> & {
  receipt: Extract<
    NonNullable<OrderDetailView["paymentProjection"]>["receipt"],
    { kind: "chain" }
  >;
} {
  const receipt = projection.receipt;
  if (
    (projection.settlementMode !== "testnet" &&
      projection.settlementMode !== "live") ||
    receipt?.kind !== "chain" ||
    !receipt.receiptId.trim() ||
    !receipt.transactionHash.trim() ||
    !Number.isFinite(new Date(receipt.confirmedAt).getTime())
  ) {
    return false;
  }
  try {
    const explorer = new URL(receipt.explorerUrl);
    return explorer.protocol === "https:" && Boolean(explorer.hostname);
  } catch {
    return false;
  }
}

export function formatPoolMateStatus(view: PoolMateStatusView): string {
  const lines = ["PoolMate status", `Bot: ${view.bot}`];

  if (view.agent) {
    lines.push(
      `Agent: ${view.agent.state}`,
      `Agent mode: ${view.agent.activeMode ?? view.agent.lastMode ?? "none"}`
    );
  }

  return lines.join("\n");
}

export function formatPaymentStatus(order: OrderDetailView): string {
  const projection = order.paymentProjection;
  const money = order.paymentRequest?.money;
  const amount = money
    ? `${money.amountAtomic} atomic units of ${money.assetId}`
    : "the checkout total";
  const heading = `Payment status for order ${order.id}`;

  if (order.state === "CANCELED") {
    return [
      heading,
      "Pool closed before payment submission.",
      "No settlement receipt was created and this is not a refund."
    ].join("\n");
  }

  if (!projection) {
    return [
      heading,
      "Payment not ready.",
      "The canonical payment request has not been created.",
      "No payment has been submitted."
    ].join("\n");
  }
  if (projection.status === "READY") {
    return [
      heading,
      "Ready: all confirmations are complete.",
      `Amount: ${amount}.`,
      "No payment has been submitted."
    ].join("\n");
  }
  if (projection.status === "UNAVAILABLE") {
    if (projection.errorCode === "PAYMENT_APPROVAL_REQUIRED") {
      return [
        heading,
        "Payment requires approval, but no remote approval flow is available.",
        "No payment was confirmed."
      ].join("\n");
    }
    return [
      heading,
      "Payment base unavailable.",
      `Reason: ${projection.errorCode ?? "PAYMENT_BASE_UNAVAILABLE"}.`,
      "No payment was confirmed."
    ].join("\n");
  }
  if (projection.status === "SUBMITTING") {
    return [
      heading,
      "Submission is in progress.",
      `Operation: ${projection.operationId}.`,
      "Do not submit another payment."
    ].join("\n");
  }
  if (projection.status === "SUBMITTED") {
    return [
      heading,
      "Payment submitted; confirmation is pending.",
      `Operation: ${projection.operationId}.`,
      "This is not a confirmed payment."
    ].join("\n");
  }
  if (projection.status === "UNKNOWN") {
    return [
      heading,
      "Payment result unknown.",
      `Operation: ${projection.operationId}.`,
      "PoolMate will only query this operation and will not submit another payment."
    ].join("\n");
  }
  if (projection.status === "FAILED") {
    return [
      heading,
      "Payment failed.",
      `Reason: ${projection.errorCode ?? "PAYMENT_FAILED"}.`,
      "No successful payment receipt was recorded."
    ].join("\n");
  }
  if (projection.status === "DEMO_CONFIRMED") {
    return [
      heading,
      "Mock demo completed.",
      "No real funds moved and this is not a chain payment."
    ].join("\n");
  }
  if (!hasVerifiableReceipt(projection)) {
    return [
      heading,
      "Payment evidence is incomplete.",
      "PoolMate cannot show the merchant as paid without a verifiable settlement receipt."
    ].join("\n");
  }
  const receipt = projection.receipt;
  return [
    heading,
    "Merchant paid with a verified settlement receipt.",
    `Amount: ${amount}.`,
    `Transaction: ${receipt.transactionHash}.`,
    `Explorer: ${receipt.explorerUrl}.`
  ].join("\n");
}
