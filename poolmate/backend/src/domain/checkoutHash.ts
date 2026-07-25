import { createHash } from "node:crypto";
import type {
  CheckoutHashView,
  CheckoutItemView,
  MerchantView
} from "@poolmate/shared";

export const CHECKOUT_HASH_ALGORITHM = "SHA-256" as const;
export const CHECKOUT_CANONICALIZATION_VERSION =
  "poolmate-checkout-json-v1" as const;

export interface CheckoutHashInput {
  checkoutId: string;
  orderId: string;
  version: number;
  merchant: MerchantView;
  items: CheckoutItemView[];
  assetId: string;
  goodsAmountAtomic: string;
  shippingAmountAtomic: string;
  discountAmountAtomic: string;
  feeAmountAtomic: string;
  totalAmountAtomic: string;
  expiresAt: string;
  sourceProtocol: "A2A" | "MOCK";
}

export function canonicalCheckout(input: CheckoutHashInput): string {
  return JSON.stringify({
    canonicalizationVersion: CHECKOUT_CANONICALIZATION_VERSION,
    checkoutId: input.checkoutId,
    checkoutVersion: input.version,
    orderId: input.orderId,
    merchant: {
      merchantId: input.merchant.id,
      payeeRef: input.merchant.payeeId
    },
    items: [...input.items]
      .sort(
        (left, right) =>
          left.sku.localeCompare(right.sku) ||
          left.name.localeCompare(right.name)
      )
      .map((item) => ({
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unitAmountAtomic: item.unitAmountAtomic
      })),
    amounts: {
      asset: input.assetId,
      goodsAmountAtomic: input.goodsAmountAtomic,
      shippingAmountAtomic: input.shippingAmountAtomic,
      discountAmountAtomic: input.discountAmountAtomic,
      feeAmountAtomic: input.feeAmountAtomic,
      totalAmountAtomic: input.totalAmountAtomic
    },
    expiresAt: input.expiresAt,
    sourceProtocol: input.sourceProtocol
  });
}

export function hashCheckout(input: CheckoutHashInput): CheckoutHashView {
  return {
    algorithm: CHECKOUT_HASH_ALGORITHM,
    canonicalizationVersion: CHECKOUT_CANONICALIZATION_VERSION,
    value: createHash("sha256")
      .update(canonicalCheckout(input), "utf8")
      .digest("hex")
  };
}
