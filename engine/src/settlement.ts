import type { Payout } from "./special.ts";

export const STAKES = [25, 50, 100, 200, 300, 400, 500, 1000, 2000, 5000, 10000] as const;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const COMMISSION_PERCENT = 10;
export const STARTING_CREDITS = 10_000;

export function isValidStake(stake: number): boolean {
  return (STAKES as readonly number[]).includes(stake);
}

export function isValidCapacity(capacity: number): boolean {
  return Number.isInteger(capacity) && capacity >= MIN_PLAYERS && capacity <= MAX_PLAYERS;
}

/** Solde minimum pour s'asseoir et pour jouer chaque manche : 2 × la mise. */
export function requiredBalance(stake: number): number {
  return 2 * stake;
}

export function canPlay(balance: number, stake: number): boolean {
  return balance >= requiredBalance(stake);
}

/** Commission : 10 % du gain, arrondie à l'unité inférieure. */
export function commissionOf(gain: number): number {
  return Math.floor((gain * COMMISSION_PERCENT) / 100);
}

export interface SettlementInput {
  stake: number;
  players: readonly string[];
  winner: string;
  payout: Payout;
  abandoned: readonly string[];
}

export interface Settlement {
  stake: number;
  winner: string;
  payout: Payout;
  /** Montant payé par chaque perdant (abandonnant : toujours 1 × la mise). */
  paidBy: Record<string, number>;
  /** Ce que le vainqueur reçoit de ses adversaires, sans sa propre mise. */
  gain: number;
  commission: number;
  /** Variation de solde de chaque joueur sur la manche (somme + commission = 0). */
  net: Record<string, number>;
}

/**
 * Chaque joueur a bloqué 2 × la mise avant la manche (1 × au pot, 1 × de côté),
 * donc personne ne peut devoir plus que ce qu'il a bloqué et aucun solde ne devient négatif.
 */
export function settle(input: SettlementInput): Settlement {
  const { stake, players, winner, payout, abandoned } = input;
  if (!players.includes(winner)) throw new Error("Le vainqueur ne fait pas partie de la manche");
  if (abandoned.includes(winner)) throw new Error("Un joueur qui a abandonné ne peut pas gagner");
  const paidBy: Record<string, number> = {};
  let gain = 0;
  for (const p of players) {
    if (p === winner) continue;
    const owed = abandoned.includes(p) ? stake : payout === "korat" ? 2 * stake : stake;
    paidBy[p] = owed;
    gain += owed;
  }
  const commission = commissionOf(gain);
  const net: Record<string, number> = {};
  for (const p of players) net[p] = p === winner ? gain - commission : -paidBy[p]!;
  return { stake, winner, payout, paidBy, gain, commission, net };
}
