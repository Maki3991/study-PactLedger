import type { AtomicMoney } from "@poolmate/shared";
import { DomainError } from "./domainError.js";

export interface AllocationParticipant {
  id: string;
  units: number;
}

export interface ExactAllocation {
  participantId: string;
  units: number;
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

export function allocateExactly(
  money: AtomicMoney,
  participants: AllocationParticipant[]
): ExactAllocation[] {
  const total = parseAtomicAmount(money.amountAtomic);
  if (total <= 0n || participants.length === 0) {
    throw new DomainError(
      "INVALID_REQUEST",
      "A positive total and at least one participant are required.",
      400
    );
  }
  if (participants.some((participant) => participant.units <= 0)) {
    throw new DomainError(
      "INVALID_REQUEST",
      "Participant units must be positive integers.",
      400
    );
  }

  const totalUnits = participants.reduce(
    (sum, participant) => sum + BigInt(participant.units),
    0n
  );
  const ranked = participants.map((participant) => {
    const weighted = total * BigInt(participant.units);
    return {
      ...participant,
      amount: weighted / totalUnits,
      remainder: weighted % totalUnits
    };
  });
  let undistributed =
    total - ranked.reduce((sum, participant) => sum + participant.amount, 0n);

  // Largest remainder allocation makes the atomic split exact and deterministic.
  ranked.sort(
    (left, right) =>
      Number(right.remainder - left.remainder) ||
      left.id.localeCompare(right.id)
  );
  for (const participant of ranked) {
    if (undistributed === 0n) break;
    participant.amount += 1n;
    undistributed -= 1n;
  }

  return ranked
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((participant) => ({
      participantId: participant.id,
      units: participant.units,
      money: {
        assetId: money.assetId,
        amountAtomic: participant.amount.toString()
      }
    }));
}
