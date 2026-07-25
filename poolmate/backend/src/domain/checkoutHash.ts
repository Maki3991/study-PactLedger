import { createHash } from "node:crypto";
import type {
  CheckoutHashView,
  CheckoutItemView,
  MerchantView
} from "@poolmate/shared";
import type { ExactAllocation } from "./allocation.js";

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
  allocations: ExactAllocation[];
}

export function canonicalCheckout(input: CheckoutHashInput): string {
  return JSON.stringify({
    canonicalizationVersion: CHECKOUT_CANONICALIZATION_VERSION,
    checkoutId: input.checkoutId,
    orderId: input.orderId,
    version: input.version,
    merchant: {
      id: input.merchant.id,
      displayName: input.merchant.displayName,
      payeeId: input.merchant.payeeId,
      verified: input.merchant.verified
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
    assetId: input.assetId,
    goodsAmountAtomic: input.goodsAmountAtomic,
    shippingAmountAtomic: input.shippingAmountAtomic,
    discountAmountAtomic: input.discountAmountAtomic,
    feeAmountAtomic: input.feeAmountAtomic,
    totalAmountAtomic: input.totalAmountAtomic,
    expiresAt: input.expiresAt,
    allocations: [...input.allocations]
      .sort((left, right) =>
        left.participantId.localeCompare(right.participantId)
      )
      .map((allocation) => ({
        participantId: allocation.participantId,
        units: allocation.units,
        money: {
          assetId: allocation.money.assetId,
          amountAtomic: allocation.money.amountAtomic
        }
      }))
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
