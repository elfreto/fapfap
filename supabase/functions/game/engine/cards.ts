/**
 * Paquet FapFap : 31 cartes.
 * tchaka (trèfle), zing (carreau), koubi (cœur) : 3 à 10 ; black (pique) : 3 à 9.
 */

export const SUITS = ["tchaka", "zing", "koubi", "black"] as const;
export type Suit = (typeof SUITS)[number];

export type Rank = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Card {
  suit: Suit;
  rank: Rank;
}

export const SUIT_COLOR: Record<Suit, "noir" | "rouge"> = {
  tchaka: "noir",
  black: "noir",
  zing: "rouge",
  koubi: "rouge",
};

export function maxRank(suit: Suit): Rank {
  return suit === "black" ? 9 : 10;
}

/** Identifiant stable d'une carte, ex. "zing-10". */
export function cardId(card: Card): string {
  return `${card.suit}-${card.rank}`;
}

export function parseCardId(id: string): Card {
  const [suit, rankStr] = id.split("-");
  const rank = Number(rankStr);
  if (!SUITS.includes(suit as Suit) || !Number.isInteger(rank) || rank < 3 || rank > maxRank(suit as Suit)) {
    throw new Error(`Carte inconnue : ${id}`);
  }
  return { suit: suit as Suit, rank: rank as Rank };
}

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Les 31 cartes dans un ordre fixe. */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let r = 3; r <= maxRank(suit); r++) deck.push({ suit, rank: r as Rank });
  }
  return deck;
}

/** Entier aléatoire dans [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number;

/** Aléa cryptographique (Web Crypto, disponible dans Node 18+, Deno et les navigateurs). */
export const cryptoRandomInt: RandomInt = (maxExclusive) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error("maxExclusive invalide");
  // Rejet pour éviter le biais du modulo.
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % maxExclusive;
  }
};

/** Mélange de Fisher-Yates (ne modifie pas l'entrée). */
export function shuffle<T>(items: readonly T[], randomInt: RandomInt = cryptoRandomInt): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Coupe : les `at` premières cartes passent sous le paquet (1 ≤ at < longueur). */
export function cut<T>(deck: readonly T[], at: number): T[] {
  if (!Number.isInteger(at) || at < 1 || at >= deck.length) throw new Error(`Coupe invalide : ${at}`);
  return [...deck.slice(at), ...deck.slice(0, at)];
}

export function handSum(hand: readonly Card[]): number {
  return hand.reduce((s, c) => s + c.rank, 0);
}
