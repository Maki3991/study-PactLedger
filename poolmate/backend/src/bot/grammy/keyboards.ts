import { InlineKeyboard } from "grammy";
import {
  claimCallbackData,
  leaveCallbackData,
  quoteCallbackData
} from "../callbackData.js";

export function collectingOrderKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Claim 1", claimCallbackData(orderId, 1))
    .text("Leave", leaveCallbackData(orderId))
    .row()
    .text("Request final quote", quoteCallbackData(orderId));
}
