import { describe, expect, it } from "vitest";
import { cardId, cryptoRandomInt, cut, fullDeck, parseCardId, shuffle } from "../src/cards.ts";
import { deal } from "../src/round.ts";
import { seeded } from "./helpers.ts";

describe("paquet", () => {
  it("contient exactement 31 cartes uniques", () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(31);
    expect(new Set(deck.map(cardId)).size).toBe(31);
  });

  it("a 8 cartes de 3 à 10 en tchaka, zing, koubi et 7 cartes de 3 à 9 en black", () => {
    const deck = fullDeck();
    for (const suit of ["tchaka", "zing", "koubi"] as const) {
      expect(deck.filter((x) => x.suit === suit).map((x) => x.rank)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    }
    expect(deck.filter((x) => x.suit === "black").map((x) => x.rank)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("refuse une carte qui n'existe pas (black 10)", () => {
    expect(() => parseCardId("black-10")).toThrow();
    expect(parseCardId("zing-10")).toEqual({ suit: "zing", rank: 10 });
  });

  it("mélange sans perdre ni dupliquer de carte", () => {
    const shuffled = shuffle(fullDeck(), seeded(42));
    expect(shuffled.map(cardId).sort()).toEqual(fullDeck().map(cardId).sort());
    expect(shuffled.map(cardId)).not.toEqual(fullDeck().map(cardId));
  });

  it("l'aléa cryptographique reste dans les bornes", () => {
    for (let i = 0; i < 1000; i++) {
      const n = cryptoRandomInt(31);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(31);
    }
  });

  it("coupe le paquet", () => {
    expect(cut([1, 2, 3, 4, 5], 2)).toEqual([3, 4, 5, 1, 2]);
    expect(() => cut([1, 2, 3], 0)).toThrow();
    expect(() => cut([1, 2, 3], 3)).toThrow();
  });
});

describe("distribution", () => {
  it("donne 3 cartes puis 2 cartes à chacun, en partant du premier joueur", () => {
    const deck = fullDeck();
    const { hands, rest } = deal(deck, ["A", "B", "C", "D"]);
    expect(hands.A).toEqual([...deck.slice(0, 3), ...deck.slice(12, 14)]);
    expect(hands.B).toEqual([...deck.slice(3, 6), ...deck.slice(14, 16)]);
    expect(hands.D).toEqual([...deck.slice(9, 12), ...deck.slice(18, 20)]);
    expect(rest).toHaveLength(11);
  });

  it("laisse 21 cartes hors jeu à 2 joueurs", () => {
    const { hands, rest } = deal(fullDeck(), ["A", "B"]);
    expect(hands.A).toHaveLength(5);
    expect(hands.B).toHaveLength(5);
    expect(rest).toHaveLength(21);
  });
});
