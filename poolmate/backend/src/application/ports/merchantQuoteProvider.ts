import type {
  CheckoutItemView,
  MerchantView,
  OrderIntentView
} from "@poolmate/shared";

export interface MerchantQuoteRequest {
  orderId: string;
  merchantId: string;
  totalUnits: number;
  orderIntent: OrderIntentView;
}

export interface MerchantQuote {
  checkoutId: string;
  sourceProtocol: "A2A" | "MOCK";
  merchant: MerchantView;
  items: CheckoutItemView[];
  assetId: string;
  goodsAmountAtomic: string;
  shippingAmountAtomic: string;
  discountAmountAtomic: string;
  feeAmountAtomic: string;
  totalAmountAtomic: string;
  expiresAt: string;
  quoteReference: string;
}

export interface MerchantQuoteProvider {
  getQuote(request: MerchantQuoteRequest): Promise<MerchantQuote>;
}
