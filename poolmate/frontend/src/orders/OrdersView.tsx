import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  LogOut,
  RefreshCw,
  Users
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CheckoutView,
  OrderDetailView,
  OrderSummaryView
} from "@poolmate/shared";
import { createOrdersApi, type OrdersApi } from "../api/ordersApi";
import { ApiRequestError } from "../api/apiClient";
import {
  ConsoleHeader,
  type ConsoleView
} from "../components/ConsoleHeader";
import { useApiResource } from "../hooks/useApiResource";
import {
  confirmationStateMeta,
  formatAtomicMoney,
  formatDateTime,
  orderStateMeta
} from "./orderDisplay";
import { StateBadge } from "./StateBadge";
import { AdminAccessGate } from "./AdminAccessGate";
import {
  clearAdminSessionKey,
  readAdminSessionKey,
  writeAdminSessionKey
} from "./adminSession";

interface OrdersViewProps {
  api?: OrdersApi;
  onNavigate(view: ConsoleView): void;
}

interface AuthenticatedOrdersViewProps extends OrdersViewProps {
  adminApiKey: string;
  onExit(notice?: { code: string; message: string }): void;
}

function OrderListRow({
  order,
  selected,
  onSelect
}: {
  order: OrderSummaryView;
  selected: boolean;
  onSelect(): void;
}) {
  const meta = orderStateMeta[order.state];
  const ratio = Math.min(100, (order.claimedUnits / order.targetUnits) * 100);
  return (
    <button
      type="button"
      className={`order-row${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="order-row__topline">
        <strong>{order.title}</strong>
        <StateBadge label={meta.label} severity={meta.severity} />
      </span>
      <span className="order-row__group">{order.group.title}</span>
      <span className="order-row__progress" aria-hidden="true">
        <span style={{ width: `${ratio}%` }} />
      </span>
      <span className="order-row__counts">
        {order.claimedUnits}/{order.targetUnits} units
        <span>{order.participantCount} participants</span>
      </span>
    </button>
  );
}

function CheckoutSection({ checkout }: { checkout: CheckoutView }) {
  const isExpired = new Date(checkout.expiresAt).getTime() <= Date.now();
  return (
    <section className="detail-section" aria-labelledby="checkout-heading">
      <div className="detail-section__heading">
        <div>
          <p className="section-kicker">Immutable snapshot</p>
          <h3 id="checkout-heading">Checkout v{checkout.version}</h3>
        </div>
        <StateBadge
          label={isExpired ? "Expired" : "Current"}
          severity={isExpired ? "error" : "healthy"}
        />
      </div>
      <dl className="detail-facts detail-facts--checkout">
        <div>
          <dt>Checkout hash</dt>
          <dd className="mono-value">{checkout.hash.value}</dd>
        </div>
        <div>
          <dt>Hash algorithm</dt>
          <dd className="mono-value">{checkout.hash.algorithm}</dd>
        </div>
        <div>
          <dt>Canonicalization</dt>
          <dd className="mono-value">
            {checkout.hash.canonicalizationVersion}
          </dd>
        </div>
        <div>
          <dt>Merchant</dt>
          <dd>
            {checkout.merchant.displayName}
            <span className="verified-inline">
              <CheckCircle2 size={12} aria-hidden="true" /> Verified
            </span>
          </dd>
        </div>
        <div>
          <dt>Payee ID</dt>
          <dd className="mono-value">{checkout.merchant.payeeId}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{formatDateTime(checkout.expiresAt)}</dd>
        </div>
      </dl>
      <div className="table-wrap checkout-items">
        <table>
          <caption>Checkout items</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">SKU</th>
              <th scope="col">Quantity</th>
              <th scope="col">Unit price</th>
            </tr>
          </thead>
          <tbody>
            {checkout.items.map((item) => (
              <tr key={item.sku}>
                <td>{item.name}</td>
                <td className="mono-value">{item.sku}</td>
                <td>{item.quantity}</td>
                <td className="mono-value">
                  {item.unitAmountAtomic} {checkout.total.assetId} atomic
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="amount-breakdown" aria-label="Checkout amount breakdown">
        <div>
          <dt>Goods</dt>
          <dd>{formatAtomicMoney(checkout.goods)}</dd>
        </div>
        <div>
          <dt>Shipping</dt>
          <dd>{formatAtomicMoney(checkout.shipping)}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>-{formatAtomicMoney(checkout.discount)}</dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{formatAtomicMoney(checkout.fee)}</dd>
        </div>
        <div className="amount-breakdown__total">
          <dt>Total</dt>
          <dd>{formatAtomicMoney(checkout.total)}</dd>
        </div>
      </dl>
      <div className="table-wrap">
        <table>
          <caption>Atomic allocations and confirmations</caption>
          <thead>
            <tr>
              <th scope="col">Participant</th>
              <th scope="col">Units</th>
              <th scope="col">Allocation</th>
              <th scope="col">Confirmation</th>
            </tr>
          </thead>
          <tbody>
            {checkout.allocations.map((allocation) => {
              const confirmation =
                confirmationStateMeta[allocation.confirmationStatus];
              return (
                <tr key={allocation.participantId}>
                  <td>{allocation.displayName}</td>
                  <td>{allocation.units}</td>
                  <td className="mono-value">
                    {formatAtomicMoney(allocation.money)}
                  </td>
                  <td>
                    <StateBadge
                      label={confirmation.label}
                      severity={confirmation.severity}
                    />
                    {allocation.confirmedAt ? (
                      <span className="cell-note">
                        {formatDateTime(allocation.confirmedAt)}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrderDetail({ order }: { order: OrderDetailView }) {
  const state = orderStateMeta[order.state];
  const fundingLabel =
    order.fundingMode === "sponsored_demo"
      ? "Sponsored demo / participants not funded"
      : "Participant-prefunded";
  return (
    <article className="order-detail">
      <header className="order-detail__header">
        <div>
          <p className="section-kicker">{order.group.title}</p>
          <h2>{order.title}</h2>
        </div>
        <div className="order-detail__state">
          <StateBadge label={state.label} severity={state.severity} />
          {order.state !== "PAID" ? <code>{order.state}</code> : null}
        </div>
      </header>

      {order.state === "PAID" ? (
        <div className="inline-warning inline-warning--error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Settlement evidence is unavailable in this response. A Receipt is
            required before this console can show a successful settlement.
          </span>
        </div>
      ) : null}

      <dl className="detail-facts">
        <div>
          <dt>Group</dt>
          <dd>{order.group.title}</dd>
        </div>
        <div>
          <dt>Claimed</dt>
          <dd>
            {order.claimedUnits} / {order.targetUnits} units
          </dd>
        </div>
        <div>
          <dt>Participants</dt>
          <dd>{order.participantCount}</dd>
        </div>
        <div>
          <dt>Funding mode</dt>
          <dd>{fundingLabel}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDateTime(order.updatedAt)}</dd>
        </div>
      </dl>

      <section className="detail-section" aria-labelledby="participants-heading">
        <div className="detail-section__heading">
          <div>
            <p className="section-kicker">Claimed units</p>
            <h3 id="participants-heading">Participants</h3>
          </div>
          <span className="section-count">
            <Users size={14} aria-hidden="true" /> {order.participants.length}
          </span>
        </div>
        {order.participants.length === 0 ? (
          <p className="section-empty">No participants have claimed units.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>Order participants</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Units</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {order.participants.map((participant) => (
                  <tr key={participant.id}>
                    <td>{participant.displayName}</td>
                    <td>{participant.units}</td>
                    <td>{formatDateTime(participant.joinedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {order.checkout ? (
        <CheckoutSection checkout={order.checkout} />
      ) : (
        <section className="detail-section">
          <p className="section-kicker">Checkout</p>
          <p className="section-empty">
            No immutable checkout has been finalized for this order.
          </p>
        </section>
      )}

      {order.paymentRequest ? (
        <section className="detail-section payment-request">
          <div className="detail-section__heading">
            <div>
              <p className="section-kicker">Local orchestration only</p>
              <h3>Payment request ready</h3>
            </div>
            <StateBadge label="Ready" severity="warning" />
          </div>
          <p className="truth-note">
            This request is ready for the external payment base. It is not a
            settlement Receipt.
          </p>
          <dl className="detail-facts detail-facts--payment">
            <div>
              <dt>Request ID</dt>
              <dd className="mono-value">{order.paymentRequest.id}</dd>
            </div>
            <div>
              <dt>Idempotency key</dt>
              <dd className="mono-value">
                {order.paymentRequest.idempotencyKey}
              </dd>
            </div>
            <div>
              <dt>Payee ID</dt>
              <dd className="mono-value">{order.paymentRequest.payeeId}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd className="mono-value">
                {formatAtomicMoney(order.paymentRequest.money)}
              </dd>
            </div>
          </dl>
        </section>
      ) : order.state === "READY_FOR_PAYMENT" ? (
        <div className="inline-warning inline-warning--error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Order state is ready for payment, but no local payment request was
            returned.
          </span>
        </div>
      ) : null}
    </article>
  );
}

function errorHeading(error: ApiRequestError, scope: "list" | "detail"): string {
  if (error.code === "NOT_READY" || error.code === "HTTP_503") {
    return "Orders API is not ready";
  }
  return scope === "list"
    ? "Order list could not be refreshed"
    : "Order detail could not be refreshed";
}

function AuthenticatedOrdersView({
  api,
  onNavigate,
  adminApiKey,
  onExit
}: AuthenticatedOrdersViewProps) {
  const ordersApi = useMemo(() => api ?? createOrdersApi(), [api]);
  const loadOrders = useCallback(
    (signal: AbortSignal) => ordersApi.listOrders(adminApiKey, signal),
    [adminApiKey, ordersApi]
  );
  const { resource: list, reload: reloadList } = useApiResource(
    loadOrders,
    "orders"
  );
  const orders = useMemo(
    () => (list.state !== "idle" ? (list.data ?? []) : []),
    [list]
  );
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    if (orders.length === 0) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !orders.some((order) => order.id === selectedId)) {
      setSelectedId(orders[0].id);
    }
  }, [orders, selectedId]);

  const loadDetail = useCallback(
    (signal: AbortSignal) =>
      ordersApi.getOrder(selectedId ?? "", adminApiKey, signal),
    [adminApiKey, ordersApi, selectedId]
  );
  const { resource: detail, reload: reloadDetail } = useApiResource(
    loadDetail,
    selectedId ?? "none",
    Boolean(selectedId)
  );
  const isRefreshing = list.state === "loading" || detail.state === "loading";
  const refresh = () => {
    reloadList();
    if (selectedId) reloadDetail();
  };

  useEffect(() => {
    const error =
      list.state === "error"
        ? list.error
        : detail.state === "error"
          ? detail.error
          : undefined;
    if (error?.code === "UNAUTHORIZED" || error?.code === "HTTP_401") {
      onExit({ code: error.code, message: "Administrator key is required." });
    } else if (error?.code === "FORBIDDEN" || error?.code === "HTTP_403") {
      onExit({ code: error.code, message: "Administrator key was rejected." });
    }
  }, [detail, list, onExit]);

  return (
    <main className="app-shell">
      <ConsoleHeader
        activeView="orders"
        onNavigate={onNavigate}
        actions={
          <>
            <button type="button" onClick={refresh} disabled={isRefreshing}>
              <RefreshCw
                className={isRefreshing ? "spin" : undefined}
                size={16}
                aria-hidden="true"
              />
              Refresh orders
            </button>
            <button type="button" onClick={() => onExit()}>
              <LogOut size={16} aria-hidden="true" />
              Exit
            </button>
          </>
        }
      />
      <div className="content content--orders">
        <div className="section-heading orders-heading">
          <div>
            <p className="section-kicker">Canonical backend state</p>
            <h2>Orders</h2>
          </div>
          <span className="record-count">
            <ClipboardList size={14} aria-hidden="true" /> {orders.length} records
          </span>
        </div>

        {list.state === "error" ? (
          <section className="error-banner" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <strong>{errorHeading(list.error, "list")}</strong>
              <p>
                {list.error.message} <code>{list.error.code}</code>
              </p>
            </div>
            <button type="button" onClick={reloadList}>
              Retry
            </button>
          </section>
        ) : null}

        {list.state === "loading" && !list.data ? (
          <div className="orders-loading" role="status">
            <RefreshCw className="spin" size={18} aria-hidden="true" />
            Loading orders
          </div>
        ) : orders.length === 0 ? (
          <section className="orders-empty">
            <ClipboardList size={22} aria-hidden="true" />
            <h3>No orders</h3>
            <p>The PoolMate backend returned an empty order list.</p>
          </section>
        ) : (
          <div className="orders-layout">
            <aside className="order-list" aria-label="Orders">
              {list.state === "loading" ? (
                <div className="stale-indicator" role="status">
                  Refreshing list
                </div>
              ) : null}
              {orders.map((order) => (
                <OrderListRow
                  key={order.id}
                  order={order}
                  selected={order.id === selectedId}
                  onSelect={() => setSelectedId(order.id)}
                />
              ))}
            </aside>
            <div className="order-detail-wrap">
              {detail.state === "error" ? (
                <section className="error-banner" role="alert">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <div>
                    <strong>{errorHeading(detail.error, "detail")}</strong>
                    <p>
                      {detail.error.message} <code>{detail.error.code}</code>
                    </p>
                  </div>
                  <button type="button" onClick={reloadDetail}>
                    Retry
                  </button>
                </section>
              ) : null}
              {detail.state === "loading" && !detail.data ? (
                <div className="orders-loading" role="status">
                  <RefreshCw className="spin" size={18} aria-hidden="true" />
                  Loading order detail
                </div>
              ) : detail.state !== "idle" && detail.data ? (
                <>
                  {detail.state === "loading" ? (
                    <div className="stale-indicator" role="status">
                      Refreshing detail
                    </div>
                  ) : null}
                  <OrderDetail order={detail.data} />
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export function OrdersView({ api, onNavigate }: OrdersViewProps) {
  const [adminApiKey, setAdminApiKey] = useState(readAdminSessionKey);
  const [notice, setNotice] = useState<{
    code: string;
    message: string;
  }>();

  const unlock = (value: string) => {
    writeAdminSessionKey(value);
    setNotice(undefined);
    setAdminApiKey(value);
  };
  const exit = useCallback(
    (nextNotice?: { code: string; message: string }) => {
      clearAdminSessionKey();
      setAdminApiKey("");
      setNotice(nextNotice);
    },
    []
  );

  if (!adminApiKey) {
    return (
      <AdminAccessGate
        notice={notice}
        onNavigate={onNavigate}
        onUnlock={unlock}
      />
    );
  }
  return (
    <AuthenticatedOrdersView
      api={api}
      adminApiKey={adminApiKey}
      onNavigate={onNavigate}
      onExit={exit}
    />
  );
}
