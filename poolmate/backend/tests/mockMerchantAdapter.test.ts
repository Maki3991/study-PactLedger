import assert from "node:assert/strict";
import test from "node:test";
import {
  MOCK_MERCHANT_ID,
  MockMerchantAdapter
} from "../src/infrastructure/merchant/mockMerchantAdapter.js";
import { fallbackOrderIntent } from "../src/domain/orderIntent.js";

function orderIntent(title: string, quantity: number) {
  return fallbackOrderIntent(title, quantity);
}

test("MockMerchantAdapter returns the verified demo merchant and exact USDC amount", async () => {
  const adapter = new MockMerchantAdapter({
    now: () => new Date("2026-07-25T12:00:00.000Z")
  });

  const quote = await adapter.getQuote({
    orderId: "order-1",
    merchantId: MOCK_MERCHANT_ID,
    totalUnits: 3,
    orderIntent: orderIntent("可乐", 3)
  });

  assert.match(quote.checkoutId, /^mock-checkout-/);
  assert.deepEqual(
    { ...quote, checkoutId: "stable-for-test" },
    {
      checkoutId: "stable-for-test",
      sourceProtocol: "MOCK",
      merchant: {
        id: "merchant-demo",
        displayName: "Demo Merchant #001",
        payeeId: "payee-demo",
        verified: true
      },
      items: [
        {
          sku: "POOLMATE_DEMO_UNIT",
          name: "PoolMate demo item",
          quantity: "3",
          unitAmountAtomic: "89000000"
        }
      ],
      assetId: "USDC",
      goodsAmountAtomic: "267000000",
      shippingAmountAtomic: "18000000",
      discountAmountAtomic: "0",
      feeAmountAtomic: "0",
      totalAmountAtomic: "285000000",
      expiresAt: "2026-07-25T12:10:00.000Z",
      quoteReference: "mock:order-1:3"
    }
  );
  assert.equal(Object.isFrozen(quote), true);
  assert.equal(Object.isFrozen(quote.merchant), true);
  assert.equal(Object.isFrozen(quote.items), true);
  assert.equal(Object.isFrozen(quote.items[0]), true);
});

test("MockMerchantAdapter ignores caller-supplied payment fields", async () => {
  const adapter = new MockMerchantAdapter({
    now: () => new Date("2026-07-25T12:00:00.000Z")
  });
  const maliciousRequest = {
    orderId: "order-2",
    merchantId: MOCK_MERCHANT_ID,
    totalUnits: 1,
    orderIntent: orderIntent("可乐", 1),
    payeeId: "attacker",
    amountAtomic: "1",
    assetId: "FAKE",
    state: "PAID"
  };

  const quote = await adapter.getQuote(maliciousRequest);

  assert.equal(quote.merchant.payeeId, "payee-demo");
  assert.equal(quote.assetId, "USDC");
  assert.equal(quote.goodsAmountAtomic, "89000000");
  assert.equal(quote.shippingAmountAtomic, "6000000");
  assert.equal(quote.totalAmountAtomic, "95000000");
  assert.equal("state" in quote, false);
});

test("MockMerchantAdapter rejects unknown merchants and invalid units", async () => {
  const adapter = new MockMerchantAdapter();

  await assert.rejects(
    adapter.getQuote({
      orderId: "order-3",
      merchantId: "merchant-unverified",
      totalUnits: 1,
      orderIntent: orderIntent("可乐", 1)
    }),
    /not verified/
  );
  await assert.rejects(
    adapter.getQuote({
      orderId: "order-3",
      merchantId: MOCK_MERCHANT_ID,
      totalUnits: 0,
      orderIntent: orderIntent("可乐", 1)
    }),
    /between 1 and 1000/
  );
});
