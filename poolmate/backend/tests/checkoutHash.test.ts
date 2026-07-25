import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalCheckout,
  hashCheckout,
  type CheckoutHashInput
} from "../src/domain/checkoutHash.js";

function checkout(): CheckoutHashInput {
  return {
    checkoutId: "checkout-1",
    orderId: "order-1",
    version: 1,
    merchant: {
      id: "merchant-demo",
      displayName: "Demo Merchant",
      payeeId: "payee-demo",
      verified: true
    },
    items: [
      {
        sku: "B",
        name: "Second",
        quantity: "1",
        unitAmountAtomic: "30"
      },
      {
        sku: "A",
        name: "First",
        quantity: "2",
        unitAmountAtomic: "30"
      }
    ],
    assetId: "USDC",
    goodsAmountAtomic: "90",
    shippingAmountAtomic: "10",
    discountAmountAtomic: "5",
    feeAmountAtomic: "5",
    totalAmountAtomic: "100",
    expiresAt: "2026-07-25T12:10:00.000Z",
    sourceProtocol: "MOCK"
  };
}

test("checkout hash exposes its algorithm and canonicalization version", () => {
  const input = checkout();
  const hash = hashCheckout(input);
  assert.equal(hash.algorithm, "SHA-256");
  assert.equal(hash.canonicalizationVersion, "poolmate-checkout-json-v1");
  assert.match(hash.value, /^[a-f0-9]{64}$/);

  const reordered = checkout();
  reordered.items.reverse();
  assert.equal(canonicalCheckout(reordered), canonicalCheckout(input));
  assert.equal(hashCheckout(reordered).value, hash.value);
});

test("checkout hash binds only canonical merchant checkout facts", () => {
  const base = checkout();
  const baseHash = hashCheckout(base).value;
  const mutations: CheckoutHashInput[] = [
    { ...checkout(), checkoutId: "checkout-2" },
    {
      ...checkout(),
      items: [
        { ...checkout().items[0]!, name: "Changed" },
        checkout().items[1]!
      ]
    },
    { ...checkout(), shippingAmountAtomic: "11", totalAmountAtomic: "101" },
    { ...checkout(), version: 2 },
    { ...checkout(), sourceProtocol: "A2A" }
  ];
  for (const mutation of mutations) {
    assert.notEqual(hashCheckout(mutation).value, baseHash);
  }
  assert.equal(
    hashCheckout({
      ...checkout(),
      merchant: { ...checkout().merchant, displayName: "Localized label" }
    }).value,
    baseHash
  );
});
