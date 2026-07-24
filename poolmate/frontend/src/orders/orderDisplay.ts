import type {
  AllocationConfirmationStatus,
  AtomicMoney,
  OrderState
} from "@poolmate/shared";
import type { Severity } from "../components/StatusCard";

interface StateMeta {
  label: string;
  severity: Severity;
}

export const orderStateMeta: Record<OrderState, StateMeta> = {
  DRAFT: { label: "Draft", severity: "neutral" },
  COLLECTING: { label: "Collecting", severity: "neutral" },
  QUOTE_PENDING: { label: "Quote pending", severity: "warning" },
  CONFIRMATION_PENDING: {
    label: "Confirmation pending",
    severity: "warning"
  },
  READY_FOR_PAYMENT: {
    label: "Ready for payment",
    severity: "warning"
  },
  PAYMENT_SUBMITTED: {
    label: "Submitted, unverified",
    severity: "warning"
  },
  PAID: { label: "Receipt required", severity: "error" },
  DEMO_CONFIRMED: { label: "Demo confirmed", severity: "warning" },
  PAYMENT_FAILED: { label: "Payment failed", severity: "error" },
  PAYMENT_UNKNOWN: { label: "Payment unknown", severity: "error" }
};

export const confirmationStateMeta: Record<
  AllocationConfirmationStatus,
  StateMeta
> = {
  pending: { label: "Pending", severity: "warning" },
  confirmed: { label: "Confirmed", severity: "healthy" },
  declined: { label: "Declined", severity: "error" },
  superseded: { label: "Superseded", severity: "error" },
  expired: { label: "Expired", severity: "error" }
};

export function formatAtomicMoney(money: AtomicMoney): string {
  return `${money.amountAtomic} ${money.assetId} atomic`;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
