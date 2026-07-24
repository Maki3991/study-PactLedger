import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../App";
import { ApiRequestError } from "../api/apiClient";
import type { OrdersApi } from "../api/ordersApi";
import type { ConfirmationResult } from "@poolmate/shared";
import {
  confirmation,
  confirmationResult,
  orderDetail,
  orderSummary
} from "../test/orderFixtures";

function ordersApi(overrides: Partial<OrdersApi> = {}): OrdersApi {
  return {
    listOrders: vi.fn(async () => [orderSummary]),
    getOrder: vi.fn(async () => orderDetail),
    submitPayment: vi.fn(async () => orderDetail),
    recoverPayment: vi.fn(async () => orderDetail),
    getConfirmation: vi.fn(async () => confirmation),
    confirm: vi.fn(async () => confirmationResult),
    decline: vi.fn(
      async (): Promise<ConfirmationResult> => ({
        ...confirmationResult,
        confirmation: {
          ...confirmationResult.confirmation,
          status: "declined",
          confirmedAt: undefined
        },
        paymentRequestCreated: false
      })
    ),
    ...overrides
  };
}

function authenticateAdmin(): void {
  window.sessionStorage.setItem("poolmate.admin-api-key", "admin-secret");
}

function openConfirmation(token = "token-1", initData?: string): void {
  window.history.replaceState({}, "", `/confirm#token=${token}`);
  if (initData !== undefined) {
    window.Telegram = { WebApp: { initData } };
  }
}

describe("orders console", () => {
  it("shows a truthful empty state", async () => {
    window.history.replaceState({}, "", "/?view=orders");
    authenticateAdmin();
    let resolveOrders!: (value: []) => void;
    const pendingOrders = new Promise<[]>((resolve) => {
      resolveOrders = resolve;
    });
    const api = ordersApi({ listOrders: vi.fn(() => pendingOrders) });

    render(<App ordersApi={api} />);

    expect(screen.getByText("Loading orders")).toBeVisible();
    resolveOrders([]);
    expect(await screen.findByText("No orders")).toBeInTheDocument();
    expect(screen.getByText("0 records")).toBeInTheDocument();
    expect(api.getOrder).not.toHaveBeenCalled();
  });

  it("renders exact checkout, allocation, confirmation, and request facts", async () => {
    window.history.replaceState({}, "", "/?view=orders");
    authenticateAdmin();
    const api = ordersApi();

    render(<App ordersApi={api} />);

    expect(await screen.findByRole("heading", { name: "Team dumplings" })).toBeVisible();
    expect(screen.getByText("3 / 3 units")).toBeVisible();
    expect(screen.getByText("sha256:checkout-v1")).toBeVisible();
    expect(screen.getByText("SHA-256")).toBeVisible();
    expect(screen.getByText("poolmate-checkout-json-v1")).toBeVisible();
    expect(screen.getByText("Dumpling box")).toBeVisible();
    expect(screen.getByText("DUMPLING-BOX")).toBeVisible();
    expect(screen.getByText("1500 inj atomic", { selector: ".amount-breakdown__total dd" })).toBeVisible();
    expect(screen.getAllByText("1500 inj atomic")).toHaveLength(3);
    expect(screen.getAllByText("500 inj atomic")).toHaveLength(2);
    expect(screen.getByText("1000 inj atomic")).toBeVisible();
    expect(screen.getByText("Sponsored demo / participants not funded")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Payment operation" })).toBeVisible();
    expect(screen.getByText("pmop_poolmate-order-1-checkout-1-v1")).toBeVisible();
    expect(screen.getByText("disabled")).toBeVisible();
    expect(screen.getByRole("button", { name: "Submit payment" })).toBeVisible();
    expect(screen.getByText("READY_FOR_PAYMENT")).toBeVisible();
    expect(screen.queryByText(/^Paid$/i)).not.toBeInTheDocument();
  });

  it("submits and recovers only through administrator payment APIs", async () => {
    window.history.replaceState({}, "", "/?view=orders");
    authenticateAdmin();
    const unknownOrder: typeof orderDetail = {
      ...orderDetail,
      state: "PAYMENT_UNKNOWN",
      paymentRequest: { ...orderDetail.paymentRequest!, status: "unknown" },
      paymentProjection: {
        ...orderDetail.paymentProjection!,
        status: "UNKNOWN",
        settlementMode: "testnet",
        errorCode: "PAYMENT_OPERATION_UNKNOWN"
      },
      paymentOutbox: { ...orderDetail.paymentOutbox!, status: "unknown" }
    };
    const api = ordersApi({
      getOrder: vi
        .fn()
        .mockResolvedValueOnce(orderDetail)
        .mockResolvedValueOnce(unknownOrder)
        .mockResolvedValue(unknownOrder),
      submitPayment: vi.fn(async () => unknownOrder),
      recoverPayment: vi.fn(async () => unknownOrder)
    });
    const user = userEvent.setup();

    render(<App ordersApi={api} />);
    await user.click(await screen.findByRole("button", { name: "Submit payment" }));
    expect(api.submitPayment).toHaveBeenCalledWith("order-1", "admin-secret");
    expect(
      await screen.findByRole("button", { name: "Recover original operation" })
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Recover original operation" })
    );
    expect(api.recoverPayment).toHaveBeenCalledWith("order-1", "admin-secret");
  });

  it("keeps stale list data visible while a refresh is pending", async () => {
    window.history.replaceState({}, "", "/?view=orders");
    authenticateAdmin();
    let resolveRefresh!: (value: typeof orderSummary[]) => void;
    const pendingRefresh = new Promise<typeof orderSummary[]>((resolve) => {
      resolveRefresh = resolve;
    });
    const api = ordersApi({
      listOrders: vi
        .fn()
        .mockResolvedValueOnce([orderSummary])
        .mockImplementationOnce(() => pendingRefresh)
    });
    const user = userEvent.setup();

    render(<App ordersApi={api} />);
    expect((await screen.findAllByText("Friday lunch")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Refresh orders" }));

    expect(screen.getByText("Refreshing list")).toBeVisible();
    expect(screen.getAllByText("Friday lunch").length).toBeGreaterThan(0);
    resolveRefresh([orderSummary]);
    await waitFor(() =>
      expect(screen.queryByText("Refreshing list")).not.toBeInTheDocument()
    );
  });

  it("retries a failed list request", async () => {
    window.history.replaceState({}, "", "/?view=orders");
    authenticateAdmin();
    const api = ordersApi({
      listOrders: vi
        .fn()
        .mockRejectedValueOnce(
          new ApiRequestError("Orders are unavailable.", "NOT_READY")
        )
        .mockResolvedValueOnce([])
    });
    const user = userEvent.setup();

    render(<App ordersApi={api} />);
    expect(await screen.findByText("Orders are unavailable.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No orders")).toBeVisible();
    expect(api.listOrders).toHaveBeenCalledTimes(2);
  });

  it("keeps orders behind a session-scoped administrator gate", async () => {
    window.history.replaceState({}, "", "/?view=orders");
    const api = ordersApi();
    const user = userEvent.setup();

    render(<App ordersApi={api} />);

    expect(screen.getByRole("heading", { name: "Administrator access" })).toBeVisible();
    expect(api.listOrders).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Administrator API key"), "admin-secret");
    await user.click(screen.getByRole("button", { name: "Unlock orders" }));

    await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
    expect(api.listOrders).toHaveBeenCalledWith("admin-secret", expect.any(AbortSignal));
    expect(window.sessionStorage.getItem("poolmate.admin-api-key")).toBe("admin-secret");

    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(screen.getByRole("heading", { name: "Administrator access" })).toBeVisible();
    expect(window.sessionStorage.getItem("poolmate.admin-api-key")).toBeNull();
  });

  it.each([
    ["UNAUTHORIZED", "Administrator key is required."],
    ["FORBIDDEN", "Administrator key was rejected."]
  ])("returns to the gate on %s", async (code, message) => {
    window.history.replaceState({}, "", "/?view=orders");
    authenticateAdmin();
    const api = ordersApi({
      listOrders: vi.fn(async () => {
        throw new ApiRequestError("Access denied.", code);
      })
    });

    render(<App ordersApi={api} />);

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByText(code)).toBeVisible();
    expect(window.sessionStorage.getItem("poolmate.admin-api-key")).toBeNull();
  });

  it("reports a 503 without treating it as an authentication failure", async () => {
    window.history.replaceState({}, "", "/?view=orders");
    authenticateAdmin();
    const api = ordersApi({
      listOrders: vi.fn(async () => {
        throw new ApiRequestError("Order storage is unavailable.", "HTTP_503");
      })
    });

    render(<App ordersApi={api} />);

    expect(await screen.findByText("Orders API is not ready")).toBeVisible();
    expect(screen.getByText("HTTP_503")).toBeVisible();
    expect(screen.getByRole("button", { name: "Exit" })).toBeVisible();
    expect(window.sessionStorage.getItem("poolmate.admin-api-key")).toBe("admin-secret");
  });
});

describe("trusted confirmation surface", () => {
  it("consumes the fragment secret and confirms with Telegram initData", async () => {
    openConfirmation("token-1", "signed-init-data");
    const api = ordersApi();
    const user = userEvent.setup();

    render(<App ordersApi={api} />);

    expect(window.location.hash).toBe("");
    expect(
      await screen.findByRole("heading", { name: "500 inj atomic" })
    ).toBeVisible();
    expect(screen.getByText("Dumpling box")).toBeVisible();
    expect(screen.getByText("1500 inj atomic", { selector: ".amount-breakdown__total dd" })).toBeVisible();
    expect(screen.getByText("SHA-256")).toBeVisible();
    expect(screen.getByText("poolmate-checkout-json-v1")).toBeVisible();
    expect(screen.getByText("Sponsored demo")).toBeVisible();
    expect(screen.getByText(/You have not funded this order/)).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm allocation" }));

    expect(await screen.findByText("Confirmation recorded")).toBeVisible();
    expect(api.confirm).toHaveBeenCalledWith("token-1", "signed-init-data");
    expect(screen.getByText(/No settlement Receipt is present/)).toBeVisible();
    expect(screen.queryByText(/^Paid$/i)).not.toBeInTheDocument();
  });

  it("records an explicit rejection without creating a payment request", async () => {
    openConfirmation("decline-token", "signed-init-data");
    const api = ordersApi();
    const user = userEvent.setup();

    render(<App ordersApi={api} />);
    await screen.findByRole("heading", { name: "500 inj atomic" });
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(await screen.findByText("Rejection recorded")).toBeVisible();
    expect(api.decline).toHaveBeenCalledWith("decline-token", "signed-init-data");
    expect(screen.getByText(/No payment request was created/)).toBeVisible();
  });

  it("keeps confirmation read-only outside Telegram", async () => {
    openConfirmation();
    const api = ordersApi();

    render(<App ordersApi={api} />);

    expect(await screen.findByText(/read-only mode/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm allocation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(api.confirm).not.toHaveBeenCalled();
    expect(api.decline).not.toHaveBeenCalled();
  });

  it.each([
    ["confirmed", "already confirmed"],
    ["superseded", "invalidated Checkout version"],
    ["expired", "link has expired"]
  ] as const)("disables a %s confirmation", async (status, message) => {
    openConfirmation(status, "signed-init-data");
    const api = ordersApi({
      getConfirmation: vi.fn(async () => ({ ...confirmation, status }))
    });

    render(<App ordersApi={api} />);

    expect(await screen.findByText(new RegExp(message, "i"))).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm allocation" })).toBeDisabled();
    expect(api.confirm).not.toHaveBeenCalled();
  });
});
