import assert from "node:assert/strict";
import test from "node:test";
import { allocateCheckout } from "../src/domain/allocation.js";

const participants = [
  { id: "participant-b", units: 1 },
  { id: "participant-a", units: 2 }
];

test("BY_QUANTITY allocates every checkout component and preserves the exact total", () => {
  const result = allocateCheckout(
    {
      assetId: "USDC",
      goodsAmountAtomic: "101",
      shippingAmountAtomic: "11",
      discountAmountAtomic: "5",
      feeAmountAtomic: "2",
      totalAmountAtomic: "109"
    },
    participants
  );

  assert.deepEqual(result, [
    {
      participantId: "participant-a",
      units: 2,
      strategy: "BY_QUANTITY",
      status: "CONFIRMATION_PENDING",
      goodsAmountAtomic: "67",
      shippingAmountAtomic: "7",
      discountAmountAtomic: "3",
      feeAmountAtomic: "1",
      totalAmountAtomic: "72",
      money: { assetId: "USDC", amountAtomic: "72" }
    },
    {
      participantId: "participant-b",
      units: 1,
      strategy: "BY_QUANTITY",
      status: "CONFIRMATION_PENDING",
      goodsAmountAtomic: "34",
      shippingAmountAtomic: "4",
      discountAmountAtomic: "2",
      feeAmountAtomic: "1",
      totalAmountAtomic: "37",
      money: { assetId: "USDC", amountAtomic: "37" }
    }
  ]);
});

test("EQUAL_SPLIT assigns tied atomic tails by participant ID", () => {
  const result = allocateCheckout(
    {
      assetId: "USDC",
      goodsAmountAtomic: "5",
      shippingAmountAtomic: "0",
      discountAmountAtomic: "0",
      feeAmountAtomic: "0",
      totalAmountAtomic: "5"
    },
    participants,
    "EQUAL_SPLIT"
  );

  assert.deepEqual(
    result.map((allocation) => [
      allocation.participantId,
      allocation.totalAmountAtomic
    ]),
    [
      ["participant-a", "3"],
      ["participant-b", "2"]
    ]
  );
});

test("allocation rejects unbalanced checkout components", () => {
  assert.throws(
    () =>
      allocateCheckout(
        {
          assetId: "USDC",
          goodsAmountAtomic: "10",
          shippingAmountAtomic: "1",
          discountAmountAtomic: "0",
          feeAmountAtomic: "0",
          totalAmountAtomic: "10"
        },
        participants
      ),
    /do not balance/
  );
});
