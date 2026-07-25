import { InlineKeyboard } from "grammy";
import {
  claimCallbackData,
  closeCallbackData,
  discardDraftCallbackData,
  leaveCallbackData,
  publishDraftCallbackData,
  quoteCallbackData
} from "../callbackData.js";

export function draftOrderKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ 发布拼单", publishDraftCallbackData(orderId))
    .text("✕ 放弃草稿", discardDraftCallbackData(orderId));
}

export function collectingOrderKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ 认领 1 份", claimCallbackData(orderId, 1))
    .text("↩️ 退出拼单", leaveCallbackData(orderId))
    .row()
    .text("🧾 请求最终报价", quoteCallbackData(orderId))
    .row()
    .text("✕ 关闭拼单", closeCallbackData(orderId));
}
