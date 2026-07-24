import { afterEach, describe, expect, it, vi } from "vitest";
import { createOrdersApi } from "./ordersApi";
import {
  confirmation,
  confirmationResult,
  orderDetail,
  orderSummary
} from "../test/orderFixtures";

afterEach(() => vi.restoreAllMocks());

describe("orders API", () => {
  it("uses protected order routes and header-bound confirmation secrets", async () => {
    const declinedResult = {
      ...confirmationResult,
      confirmation: {
        ...confirmationResult.confirmation,
        status: "declined" as const,
        confirmedAt: undefined
      },
      paymentRequestCreated: false
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([orderSummary])))
      .mockResolvedValueOnce(new Response(JSON.stringify(orderDetail)))
      .mockResolvedValueOnce(new Response(JSON.stringify(confirmation)))
      .mockResolvedValueOnce(new Response(JSON.stringify(confirmationResult)))
      .mockResolvedValueOnce(new Response(JSON.stringify(declinedResult)));
    const api = createOrdersApi("https://poolmate.test/");

    await expect(api.listOrders("admin-secret")).resolves.toEqual([orderSummary]);
    await expect(api.getOrder("order-1", "admin-secret")).resolves.toEqual(orderDetail);
    await expect(api.getConfirmation("token/1")).resolves.toEqual(confirmation);
    await expect(api.confirm("token/1", "signed-init-data")).resolves.toEqual(
      confirmationResult
    );
    await expect(api.decline("token/1", "signed-init-data")).resolves.toEqual(
      declinedResult
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://poolmate.test/api/orders",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer admin-secret"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://poolmate.test/api/orders/order-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer admin-secret"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://poolmate.test/api/public/confirmation",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-PoolMate-Confirmation-Token": "token/1"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://poolmate.test/api/public/confirmation/confirm",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          Authorization: "tma signed-init-data",
          "X-PoolMate-Confirmation-Token": "token/1"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "https://poolmate.test/api/public/confirmation/decline",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "tma signed-init-data",
          "X-PoolMate-Confirmation-Token": "token/1"
        })
      })
    );
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain("token/1");
      expect(String(url)).not.toContain("token%2F1");
    }
  });

  it("rejects an order detail whose atomic allocations do not balance", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ...orderDetail,
          checkout: {
            ...orderDetail.checkout,
            total: { assetId: "inj", amountAtomic: "1501" }
          }
        })
      )
    );

    await expect(
      createOrdersApi().getOrder("order-1", "admin-secret")
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects wrapped list responses that violate the frozen contract", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ orders: [orderSummary] }))
    );

    await expect(
      createOrdersApi().listOrders("admin-secret")
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts isolated mock evidence without treating it as chain settlement", async () => {
    const demoOrder = {
      ...orderDetail,
      state: "DEMO_CONFIRMED" as const,
      paymentRequest: {
        ...orderDetail.paymentRequest!,
        status: "demo_confirmed" as const
      },
      paymentProjection: {
        ...orderDetail.paymentProjection!,
        status: "DEMO_CONFIRMED" as const,
        settlementMode: "mock" as const,
        receipt: {
          receiptId: "mock-receipt-1",
          transactionHash: "mock-hash",
          explorerUrl: "http://mock.invalid/receipt/mock-hash",
          confirmedAt: "2026-07-25T02:01:00.000Z"
        }
      },
      paymentOutbox: {
        ...orderDetail.paymentOutbox!,
        status: "completed" as const
      }
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(demoOrder))
    );

    await expect(
      createOrdersApi().getOrder("order-1", "admin-secret")
    ).resolves.toEqual(demoOrder);
  });

  it.each([
    [
      "legacy string hash",
      {
        ...orderDetail,
        checkout: { ...orderDetail.checkout!, hash: "sha256:checkout-v1" }
      }
    ],
    [
      "unbalanced itemized checkout",
      {
        ...orderDetail,
        checkout: {
          ...orderDetail.checkout!,
          goods: { assetId: "inj", amountAtomic: "1499" }
        }
      }
    ]
  ])("rejects a %s", async (_name, response) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response))
    );

    await expect(
      createOrdersApi().getOrder("order-1", "admin-secret")
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
