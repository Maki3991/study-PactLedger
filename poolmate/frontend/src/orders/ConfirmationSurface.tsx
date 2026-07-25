import {
  AlertTriangle,
  Check,
  CheckCircle2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Store,
  WalletCards,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConfirmationResult } from "@poolmate/shared";
import { ApiRequestError } from "../api/apiClient";
import { createOrdersApi, type OrdersApi } from "../api/ordersApi";
import { useApiResource } from "../hooks/useApiResource";
import {
  confirmationStateMeta,
  formatAtomicMoney,
  formatDateTime,
  orderStateMeta
} from "./orderDisplay";
import { StateBadge } from "./StateBadge";

interface ConfirmationSurfaceProps {
  token?: string;
  api?: OrdersApi;
}

type SubmissionState =
  | { state: "idle" }
  | { state: "submitting" }
  | {
      state: "success";
      action: "confirm" | "decline";
      result: ConfirmationResult;
    }
  | { state: "error"; error: ApiRequestError };

function normalizeError(error: unknown): ApiRequestError {
  return error instanceof ApiRequestError
    ? error
    : new ApiRequestError("Confirmation could not be recorded.", "UNKNOWN_ERROR");
}

export function ConfirmationSurface({
  token,
  api
}: ConfirmationSurfaceProps) {
  const ordersApi = useMemo(() => api ?? createOrdersApi(), [api]);
  const [telegramInitData] = useState(
    () => window.Telegram?.WebApp?.initData?.trim() ?? ""
  );
  const loadConfirmation = useCallback(
    (signal: AbortSignal) => ordersApi.getConfirmation(token ?? "", signal),
    [ordersApi, token]
  );
  const { resource, reload } = useApiResource(
    loadConfirmation,
    `confirmation:${token ?? "missing"}`,
    Boolean(token)
  );
  const [submission, setSubmission] = useState<SubmissionState>({
    state: "idle"
  });
  const [clock, setClock] = useState(() => Date.now());
  const confirmation =
    submission.state === "success"
      ? submission.result.confirmation
      : resource.state !== "idle"
        ? resource.data
        : undefined;
  const expiresAt = confirmation
    ? new Date(confirmation.expiresAt).getTime()
    : undefined;

  useEffect(() => {
    if (expiresAt === undefined || expiresAt <= Date.now()) return;
    const delay = Math.min(expiresAt - Date.now() + 50, 2_147_000_000);
    const timeout = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timeout);
  }, [expiresAt]);

  const hasExpired = expiresAt !== undefined && expiresAt <= clock;
  const effectiveStatus =
    confirmation?.status === "pending" && hasExpired
      ? "expired"
      : confirmation?.status;
  const stateMeta = effectiveStatus
    ? confirmationStateMeta[effectiveStatus]
    : undefined;
  const canConfirm =
    resource.state === "ready" &&
    effectiveStatus === "pending" &&
    Boolean(telegramInitData) &&
    submission.state !== "submitting";

  const submit = async (action: "confirm" | "decline") => {
    if (!canConfirm) return;
    setSubmission({ state: "submitting" });
    try {
      const result = await (action === "confirm"
        ? ordersApi.confirm(token!, telegramInitData)
        : ordersApi.decline(token!, telegramInitData));
      setSubmission({ state: "success", action, result });
    } catch (error) {
      setSubmission({ state: "error", error: normalizeError(error) });
    }
  };

  return (
    <main className="confirmation-shell">
      <header className="confirmation-topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <ShieldCheck size={21} strokeWidth={1.8} />
          </span>
          <div>
            <h1>PoolMate</h1>
            <p>Trusted confirmation</p>
          </div>
        </div>
        <span className="trusted-label">
          <LockKeyhole size={14} aria-hidden="true" /> Server-locked details
        </span>
      </header>

      <div className="confirmation-content">
        {resource.state === "error" ? (
          <section className="error-banner" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <strong>Confirmation link could not be refreshed</strong>
              <p>{resource.error.message}</p>
            </div>
            <button type="button" onClick={reload}>
              Retry
            </button>
          </section>
        ) : null}

        {!token ? (
          <section className="confirmation-missing" role="alert">
            <AlertTriangle size={20} aria-hidden="true" />
            <h2>Confirmation secret is missing</h2>
            <p>Open the current confirmation link from PoolMate.</p>
          </section>
        ) : resource.state === "loading" && !resource.data ? (
          <div className="confirmation-loading" role="status">
            <RefreshCw className="spin" size={20} aria-hidden="true" />
            Loading locked checkout details
          </div>
        ) : confirmation ? (
          <article className="confirmation-panel">
            {resource.state === "loading" ? (
              <div className="stale-indicator" role="status">
                Refreshing locked details
              </div>
            ) : null}
            <header className="confirmation-heading">
              <div>
                <p className="section-kicker">Allocation confirmation</p>
                <h2>{confirmation.orderTitle}</h2>
                <p>{confirmation.participantDisplayName}</p>
              </div>
              {stateMeta ? (
                <StateBadge
                  label={stateMeta.label}
                  severity={stateMeta.severity}
                />
              ) : null}
            </header>

            <section className="sponsor-notice" aria-label="Funding mode">
              <WalletCards size={18} aria-hidden="true" />
              <div>
                <strong>Sponsored demo</strong>
                <p>
                  You are confirming allocation details. You have not funded
                  this order.
                </p>
              </div>
            </section>

            <section className="locked-allocation" aria-labelledby="amount-heading">
              <p className="section-kicker">Your locked allocation</p>
              <h3 id="amount-heading">
                {formatAtomicMoney(confirmation.money)}
              </h3>
              <span>Exact atomic amount from Checkout v{confirmation.checkoutVersion}</span>
            </section>

            <section className="confirmation-items" aria-labelledby="items-heading">
              <div className="detail-section__heading">
                <div>
                  <p className="section-kicker">Canonical checkout</p>
                  <h3 id="items-heading">Items</h3>
                </div>
                <span className="section-count">
                  {confirmation.participantUnits} participant units
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <caption>Confirmation checkout items</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">SKU</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Unit price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmation.items.map((item) => (
                      <tr key={item.sku}>
                        <td>{item.name}</td>
                        <td className="mono-value">{item.sku}</td>
                        <td>{item.quantity}</td>
                        <td className="mono-value">
                          {item.unitAmountAtomic} {confirmation.money.assetId} atomic
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl
                className="amount-breakdown"
                aria-label="Checkout amount breakdown"
              >
                <div>
                  <dt>Goods</dt>
                  <dd>{formatAtomicMoney(confirmation.goods)}</dd>
                </div>
                <div>
                  <dt>Shipping</dt>
                  <dd>{formatAtomicMoney(confirmation.shipping)}</dd>
                </div>
                <div>
                  <dt>Discount</dt>
                  <dd>-{formatAtomicMoney(confirmation.discount)}</dd>
                </div>
                <div>
                  <dt>Fee</dt>
                  <dd>{formatAtomicMoney(confirmation.fee)}</dd>
                </div>
                <div className="amount-breakdown__total">
                  <dt>Order total</dt>
                  <dd>{formatAtomicMoney(confirmation.orderTotal)}</dd>
                </div>
              </dl>
            </section>

            <dl className="confirmation-facts">
              <div>
                <dt>
                  <Store size={14} aria-hidden="true" /> Merchant
                </dt>
                <dd>
                  {confirmation.merchant.displayName}
                  <span className="verified-inline">
                    <CheckCircle2 size={12} aria-hidden="true" /> Verified
                  </span>
                </dd>
              </div>
              <div>
                <dt>Payee ID</dt>
                <dd className="mono-value">{confirmation.merchant.payeeId}</dd>
              </div>
              <div>
                <dt>Checkout version</dt>
                <dd>{confirmation.checkoutVersion}</dd>
              </div>
              <div>
                <dt>Checkout hash</dt>
                <dd className="mono-value">{confirmation.checkoutHash.value}</dd>
              </div>
              <div>
                <dt>Hash algorithm</dt>
                <dd className="mono-value">
                  {confirmation.checkoutHash.algorithm}
                </dd>
              </div>
              <div>
                <dt>Canonicalization</dt>
                <dd className="mono-value">
                  {confirmation.checkoutHash.canonicalizationVersion}
                </dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{formatDateTime(confirmation.expiresAt)}</dd>
              </div>
              {confirmation.confirmedAt ? (
                <div>
                  <dt>Confirmed</dt>
                  <dd>{formatDateTime(confirmation.confirmedAt)}</dd>
                </div>
              ) : null}
            </dl>

            {submission.state === "error" ? (
              <div className="inline-warning inline-warning--error" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{submission.error.message}</span>
              </div>
            ) : null}

            {submission.state === "success" ? (
              <section className="confirmation-result" role="status">
                <Check size={18} aria-hidden="true" />
                <div>
                  <strong>
                    {submission.action === "decline"
                      ? "Rejection recorded"
                      : "Confirmation recorded"}
                  </strong>
                  <p>
                    {submission.action === "decline"
                      ? "The allocation was declined. No payment request was created from this action."
                      : submission.result.paymentRequestCreated
                      ? "All confirmations are complete and one local payment request was created. No settlement Receipt is present."
                      : "The allocation is confirmed. The order is still waiting for other required confirmations."}
                  </p>
                  <StateBadge
                    label={orderStateMeta[submission.result.orderState].label}
                    severity={
                      orderStateMeta[submission.result.orderState].severity
                    }
                  />
                </div>
              </section>
            ) : null}

            {effectiveStatus === "superseded" ? (
              <div className="inline-warning inline-warning--error">
                This confirmation belongs to an invalidated Checkout version.
              </div>
            ) : effectiveStatus === "expired" ? (
              <div className="inline-warning inline-warning--error">
                This confirmation link has expired. No confirmation was sent.
              </div>
            ) : effectiveStatus === "confirmed" &&
              submission.state !== "success" ? (
              <div className="inline-warning">
                This allocation was already confirmed. No repeat action is
                available.
              </div>
            ) : effectiveStatus === "declined" &&
              submission.state !== "success" ? (
              <div className="inline-warning inline-warning--error">
                This allocation was declined. No repeat action is available.
              </div>
            ) : null}

            {submission.state !== "success" ? (
              <div className="confirmation-actions">
                {!telegramInitData ? (
                  <div className="telegram-required" role="status">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>
                      Open this confirmation from Telegram to confirm or reject.
                      Canonical details remain available in read-only mode.
                    </span>
                  </div>
                ) : null}
                <div className="confirmation-action-buttons">
                  <button
                    type="button"
                    className="reject-button"
                    disabled={!canConfirm}
                    onClick={() => void submit("decline")}
                  >
                    <X size={17} aria-hidden="true" />
                    Reject
                  </button>
                  <button
                    type="button"
                    className="confirm-button"
                    disabled={!canConfirm}
                    onClick={() => void submit("confirm")}
                  >
                    {submission.state === "submitting" ? (
                      <RefreshCw className="spin" size={17} aria-hidden="true" />
                    ) : (
                      <Check size={17} aria-hidden="true" />
                    )}
                    {submission.state === "submitting"
                      ? "Recording action"
                      : "Confirm allocation"}
                  </button>
                </div>
                <p>
                  Canonical allocation and merchant values are bound to the
                  displayed Checkout hash.
                </p>
              </div>
            ) : null}
          </article>
        ) : null}
      </div>
    </main>
  );
}
