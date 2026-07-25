import type {
  MerchantQuote,
  MerchantQuoteProvider,
  MerchantQuoteRequest
} from "../../application/ports/merchantQuoteProvider.js";
import { randomUUID } from "node:crypto";

export const MOCK_MERCHANT_ID = "merchant-demo";
export const MOCK_MERCHANT_PAYEE_ID = "payee-demo";
export const MOCK_MERCHANT_ASSET_ID = "USDC";
export const MOCK_GOODS_UNIT_AMOUNT_ATOMIC = 89_000_000n;
export const MOCK_SHIPPING_UNIT_AMOUNT_ATOMIC = 6_000_000n;
export const MOCK_UNIT_AMOUNT_ATOMIC =
  MOCK_GOODS_UNIT_AMOUNT_ATOMIC + MOCK_SHIPPING_UNIT_AMOUNT_ATOMIC;
export const MOCK_QUOTE_TTL_MS = 10 * 60 * 1_000;

export interface MockMerchantAdapterOptions {
  now?: () => Date;
}

function frozenQuote(quote: MerchantQuote): MerchantQuote {
  Object.freeze(quote.merchant);
  for (const item of quote.items) Object.freeze(item);
  Object.freeze(quote.items);
  return Object.freeze(quote);
}

export class MockMerchantAdapter implements MerchantQuoteProvider {
  private readonly now: () => Date;

  constructor({ now = () => new Date() }: MockMerchantAdapterOptions = {}) {
    this.now = now;
  }

  async getQuote(request: MerchantQuoteRequest): Promise<MerchantQuote> {
    if (request.merchantId !== MOCK_MERCHANT_ID) {
      throw new Error(`Merchant is not verified: ${request.merchantId}`);
    }
    if (!request.orderId.trim()) {
      throw new Error("Order id is required for a merchant quote.");
    }
    if (
      !Number.isSafeInteger(request.totalUnits) ||
      request.totalUnits <= 0 ||
      request.totalUnits > 1_000
    ) {
      throw new Error("Total units must be an integer between 1 and 1000.");
    }

    const issuedAt = this.now();
    if (Number.isNaN(issuedAt.getTime())) {
      throw new Error("Merchant clock returned an invalid time.");
    }

    return frozenQuote({
      checkoutId: `mock-checkout-${randomUUID()}`,
      sourceProtocol: "MOCK",
      merchant: {
        id: MOCK_MERCHANT_ID,
        displayName: "Demo Merchant #001",
        payeeId: MOCK_MERCHANT_PAYEE_ID,
        verified: true
      },
      items: [
        {
          sku: "POOLMATE_DEMO_UNIT",
          name: "PoolMate demo item",
          quantity: String(request.totalUnits),
          unitAmountAtomic: MOCK_GOODS_UNIT_AMOUNT_ATOMIC.toString()
        }
      ],
      assetId: MOCK_MERCHANT_ASSET_ID,
      goodsAmountAtomic: (
        BigInt(request.totalUnits) * MOCK_GOODS_UNIT_AMOUNT_ATOMIC
      ).toString(),
      shippingAmountAtomic: (
        BigInt(request.totalUnits) * MOCK_SHIPPING_UNIT_AMOUNT_ATOMIC
      ).toString(),
      discountAmountAtomic: "0",
      feeAmountAtomic: "0",
      totalAmountAtomic: (
        BigInt(request.totalUnits) * MOCK_UNIT_AMOUNT_ATOMIC
      ).toString(),
      expiresAt: new Date(issuedAt.getTime() + MOCK_QUOTE_TTL_MS).toISOString(),
      quoteReference: `mock:${request.orderId}:${request.totalUnits}`
    });
  }
}
