import type {
  AllocationStrategy,
  AtomicMoney,
  PaymentAllocationStatus
} from "@poolmate/shared";
import { DomainError } from "./domainError.js";

export interface AllocationParticipant {
  id: string;
  units: number;
}

export interface CheckoutAmounts {
  assetId: string;
  goodsAmountAtomic: string;
  shippingAmountAtomic: string;
  discountAmountAtomic: string;
  feeAmountAtomic: string;
  totalAmountAtomic: string;
}

export interface ExactAllocation {
  participantId: string;
  units: number;
  strategy: AllocationStrategy;
  status: PaymentAllocationStatus;
  goodsAmountAtomic: string;
  shippingAmountAtomic: string;
  discountAmountAtomic: string;
  feeAmountAtomic: string;
  totalAmountAtomic: string;
  money: AtomicMoney;
}

export function parseAtomicAmount(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new DomainError(
      "INVALID_REQUEST",
      "Atomic amounts must be non-negative integer strings.",
      400
    );
  }
  return BigInt(value);
}

function participantWeight(
  participant: AllocationParticipant,
  strategy: AllocationStrategy
): bigint {
  return strategy === "BY_QUANTITY" ? BigInt(participant.units) : 1n;
}

function allocateComponent(
  total: bigint,
  participants: AllocationParticipant[],
  strategy: AllocationStrategy
): Map<string, bigint> {
  const totalWeight = participants.reduce(
    (sum, participant) => sum + participantWeight(participant, strategy),
    0n
  );
  const ranked = participants.map((participant) => {
    const weighted = total * participantWeight(participant, strategy);
    return {
      id: participant.id,
      amount: weighted / totalWeight,
      remainder: weighted % totalWeight
    };
  });
  let undistributed =
    total - ranked.reduce((sum, participant) => sum + participant.amount, 0n);

  ranked.sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });
  for (const participant of ranked) {
    if (undistributed === 0n) break;
    participant.amount += 1n;
    undistributed -= 1n;
  }
  return new Map(
    ranked.map((participant) => [participant.id, participant.amount])
  );
}

export function allocateCheckout(
  amounts: CheckoutAmounts,
  participants: AllocationParticipant[],
  strategy: AllocationStrategy = "BY_QUANTITY"
): ExactAllocation[] {
  if (participants.length === 0) {
    throw new DomainError(
      "INVALID_REQUEST",
      "At least one participant is required.",
      400
    );
  }
  if (
    participants.some(
      (participant) =>
        !Number.isSafeInteger(participant.units) || participant.units <= 0
    )
  ) {
    throw new DomainError(
      "INVALID_REQUEST",
      "Participant units must be positive safe integers.",
      400
    );
  }
  if (
    new Set(participants.map((participant) => participant.id)).size !==
    participants.length
  ) {
    throw new DomainError(
      "INVALID_REQUEST",
      "Participant IDs must be unique.",
      400
    );
  }

  const goods = parseAtomicAmount(amounts.goodsAmountAtomic);
  const shipping = parseAtomicAmount(amounts.shippingAmountAtomic);
  const discount = parseAtomicAmount(amounts.discountAmountAtomic);
  const fee = parseAtomicAmount(amounts.feeAmountAtomic);
  const total = parseAtomicAmount(amounts.totalAmountAtomic);
  if (total <= 0n || goods + shipping + fee - discount !== total) {
    throw new DomainError(
      "INVALID_CHECKOUT",
      "Checkout allocation amounts do not balance.",
      422
    );
  }

  const goodsByParticipant = allocateComponent(goods, participants, strategy);
  const shippingByParticipant = allocateComponent(
    shipping,
    participants,
    strategy
  );
  const discountByParticipant = allocateComponent(
    discount,
    participants,
    strategy
  );
  const feeByParticipant = allocateComponent(fee, participants, strategy);

  const allocations = participants
    .map((participant) => {
      const participantGoods = goodsByParticipant.get(participant.id)!;
      const participantShipping = shippingByParticipant.get(participant.id)!;
      const participantDiscount = discountByParticipant.get(participant.id)!;
      const participantFee = feeByParticipant.get(participant.id)!;
      const participantTotal =
        participantGoods +
        participantShipping +
        participantFee -
        participantDiscount;
      if (participantTotal < 0n) {
        throw new DomainError(
          "INVALID_CHECKOUT",
          "A participant allocation cannot be negative.",
          422
        );
      }
      return {
        participantId: participant.id,
        units: participant.units,
        strategy,
        status: "CONFIRMATION_PENDING" as const,
        goodsAmountAtomic: participantGoods.toString(),
        shippingAmountAtomic: participantShipping.toString(),
        discountAmountAtomic: participantDiscount.toString(),
        feeAmountAtomic: participantFee.toString(),
        totalAmountAtomic: participantTotal.toString(),
        money: {
          assetId: amounts.assetId,
          amountAtomic: participantTotal.toString()
        }
      };
    })
    .sort((left, right) =>
      left.participantId.localeCompare(right.participantId)
    );

  const allocatedTotal = allocations.reduce(
    (sum, allocation) => sum + BigInt(allocation.totalAmountAtomic),
    0n
  );
  if (allocatedTotal !== total) {
    throw new DomainError(
      "INVALID_CHECKOUT",
      "Participant allocations do not equal the checkout total.",
      422
    );
  }
  return allocations;
}

export function allocateExactly(
  money: AtomicMoney,
  participants: AllocationParticipant[]
): ExactAllocation[] {
  return allocateCheckout(
    {
      assetId: money.assetId,
      goodsAmountAtomic: money.amountAtomic,
      shippingAmountAtomic: "0",
      discountAmountAtomic: "0",
      feeAmountAtomic: "0",
      totalAmountAtomic: money.amountAtomic
    },
    participants
  );
}
