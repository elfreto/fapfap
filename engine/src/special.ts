import { type Card, handSum } from "./cards.ts";

export type Payout = "simple" | "korat";

export type SpecialKind =
  | "brelan_7"
  | "carre_7"
  | "total_16"
  | "carre"
  | "couleur"
  | "brelan_3"
  | "total_17_21";

export interface SpecialHand {
  kind: SpecialKind;
  /** 1 = la plus forte. */
  rank: number;
  payout: Payout;
  sum: number;
}

/**
 * Ordre de force V1.1 (décision du 10/11/2026) : le brelan de 7 bat toutes les autres mains spéciales.
 * Un carré de 7 n'est pas un brelan de 7 (il n'y a que quatre 7, les deux ne se croisent jamais).
 */
export const SPECIAL_RULES: ReadonlyArray<{ kind: SpecialKind; rank: number; payout: Payout; label: string }> = [
  { kind: "brelan_7", rank: 1, payout: "simple", label: "Brelan de 7" },
  { kind: "carre_7", rank: 2, payout: "korat", label: "Carré de 7" },
  { kind: "total_16", rank: 3, payout: "korat", label: "Total 16" },
  { kind: "carre", rank: 4, payout: "simple", label: "Carré" },
  { kind: "couleur", rank: 5, payout: "simple", label: "Cinq cartes de la même enseigne" },
  { kind: "brelan_3", rank: 6, payout: "simple", label: "Brelan de 3" },
  { kind: "total_17_21", rank: 7, payout: "simple", label: "Total entre 17 et 21" },
];

function countRank(hand: readonly Card[], rank: number): number {
  return hand.filter((c) => c.rank === rank).length;
}

function matches(kind: SpecialKind, hand: readonly Card[]): boolean {
  const sum = handSum(hand);
  switch (kind) {
    case "brelan_7":
      return countRank(hand, 7) === 3;
    case "carre_7":
      return countRank(hand, 7) === 4;
    case "total_16":
      return sum === 16;
    case "carre":
      return [3, 4, 5, 6, 8, 9, 10].some((r) => countRank(hand, r) === 4);
    case "couleur":
      return hand.every((c) => c.suit === hand[0]!.suit);
    case "brelan_3":
      return countRank(hand, 3) === 3;
    case "total_17_21":
      return sum >= 17 && sum <= 21;
  }
}

/** La victoire spéciale la plus forte d'une main de 5 cartes, ou null. */
export function detectSpecial(hand: readonly Card[]): SpecialHand | null {
  if (hand.length !== 5) return null;
  for (const rule of SPECIAL_RULES) {
    if (matches(rule.kind, hand)) {
      return { kind: rule.kind, rank: rule.rank, payout: rule.payout, sum: handSum(hand) };
    }
  }
  return null;
}

export interface SpecialWin {
  winner: string;
  special: SpecialHand;
  /** Toutes les mains spéciales trouvées, pour l'écran de résultat. */
  candidates: Array<{ player: string; special: SpecialHand }>;
}

/**
 * Départage : rang le plus fort, puis plus petite somme, puis le joueur servi en premier.
 * @param dealOrder joueurs dans l'ordre de distribution (premier joueur d'abord)
 */
export function resolveSpecial(hands: Readonly<Record<string, readonly Card[]>>, dealOrder: readonly string[]): SpecialWin | null {
  const candidates: Array<{ player: string; special: SpecialHand; order: number }> = [];
  dealOrder.forEach((player, order) => {
    const special = detectSpecial(hands[player] ?? []);
    if (special) candidates.push({ player, special, order });
  });
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort(
    (a, b) => a.special.rank - b.special.rank || a.special.sum - b.special.sum || a.order - b.order,
  );
  const best = sorted[0]!;
  return {
    winner: best.player,
    special: best.special,
    candidates: candidates.map(({ player, special }) => ({ player, special })),
  };
}
