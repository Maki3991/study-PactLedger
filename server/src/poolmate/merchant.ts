/**
 * Demo merchant – fixed catalog, stateless checkout.
 * Treasury policy requires payee to be 'merchant' (whitelist).
 */

export interface MerchantItem {
  id: string
  name: string
  priceEach: number  // USDT
  unit: string
  stock: number
}

const CATALOG: MerchantItem[] = [
  { id: 'yangmei-box', name: '新鲜杨梅礼盒', priceEach: 89,  unit: '箱', stock: 50 },
  { id: 'fruit-gift',  name: '水果礼盒',     priceEach: 128, unit: '盒', stock: 30 },
  { id: 'lychee-box',  name: '妃子笑荔枝',   priceEach: 76,  unit: '斤', stock: 40 },
  { id: 'coffee-sub',  name: '精品咖啡月订', priceEach: 199, unit: '份', stock: 20 },
]

export function matchItem(product: string): MerchantItem | undefined {
  const lower = product.toLowerCase()
  return CATALOG.find(
    (item) => item.name.includes(product) || lower.includes(item.id) ||
      product.includes('杨梅') && item.id === 'yangmei-box' ||
      product.includes('荔枝') && item.id === 'lychee-box' ||
      product.includes('水果') && item.id === 'fruit-gift' ||
      product.includes('咖啡') && item.id === 'coffee-sub',
  )
}

export interface OrderResult {
  orderId: string
  item: MerchantItem
  quantity: number
  totalPaid: number
  shippingFee: number
  estimatedDelivery: string
}

export function checkout(itemId: string, quantity: number, paidAmount: number): OrderResult {
  const item = CATALOG.find((i) => i.id === itemId) ?? CATALOG[0]
  const orderId = `ORD-${Date.now().toString(36).toUpperCase()}`
  const shippingFee = quantity >= 3 ? 0 : 12   // free shipping 3+
  return {
    orderId,
    item,
    quantity,
    totalPaid: paidAmount,
    shippingFee,
    estimatedDelivery: '3-5 个工作日',
  }
}
