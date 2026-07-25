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
    .text("Confirm & publish", publishDraftCallbackData(orderId))
    .text("Discard draft", discardDraftCallbackData(orderId));
}

export function collectingOrderKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Claim 1", claimCallbackData(orderId, 1))
    .text("Leave", leaveCallbackData(orderId))
    .row()
    .text("Request final quote", quoteCallbackData(orderId))
    .row()
    .text("Close pool", closeCallbackData(orderId));
}
