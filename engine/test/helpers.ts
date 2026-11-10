import type { Card, Rank, Suit } from "../src/cards.ts";

export function c(suit: Suit, rank: number): Card {
  return { suit, rank: rank as Rank };
}

/** Générateur pseudo-aléatoire reproductible pour les tests (mulberry32). */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return (maxExclusive: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * maxExclusive);
  };
}
