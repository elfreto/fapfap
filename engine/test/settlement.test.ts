import { describe, expect, it } from "vitest";
import { canPlay, commissionOf, isValidCapacity, isValidStake, settle } from "../src/settlement.ts";

describe("table et solde", () => {
  it("n'accepte que 2, 3 ou 4 joueurs (T01)", () => {
    expect(isValidCapacity(1)).toBe(false);
    expect(isValidCapacity(2)).toBe(true);
    expect(isValidCapacity(4)).toBe(true);
    expect(isValidCapacity(5)).toBe(false);
  });

  it("n'accepte que les mises prévues", () => {
    expect(isValidStake(500)).toBe(true);
    expect(isValidStake(150)).toBe(false);
  });

  it("exige 2 × la mise : 999 refusé, 1 000 accepté pour une mise de 500 (T02, T03)", () => {
    expect(canPlay(999, 500)).toBe(false);
    expect(canPlay(1000, 500)).toBe(true);
  });
});

describe("paiements et commission (exemples du doc, 4 joueurs, mise 100)", () => {
  const players = ["A", "B", "C", "D"];

  it("victoire simple : +270 pour le vainqueur, −100 par perdant", () => {
    const s = settle({ stake: 100, players, winner: "A", payout: "simple", abandoned: [] });
    expect(s.gain).toBe(300);
    expect(s.commission).toBe(30);
    expect(s.net).toEqual({ A: 270, B: -100, C: -100, D: -100 });
  });

  it("Korat : +540 pour le vainqueur, −200 par perdant", () => {
    const s = settle({ stake: 100, players, winner: "A", payout: "korat", abandoned: [] });
    expect(s.gain).toBe(600);
    expect(s.net).toEqual({ A: 540, B: -200, C: -200, D: -200 });
  });

  it("Korat avec un abandon : l'abandonnant ne paie que 1 × la mise", () => {
    const s = settle({ stake: 100, players, winner: "A", payout: "korat", abandoned: ["D"] });
    expect(s.gain).toBe(500);
    expect(s.commission).toBe(50);
    expect(s.net).toEqual({ A: 450, B: -200, C: -200, D: -100 });
  });

  it("la commission est arrondie à l'unité inférieure (10 % de 25 = 2)", () => {
    expect(commissionOf(25)).toBe(2);
    const s = settle({ stake: 25, players: ["A", "B"], winner: "B", payout: "simple", abandoned: [] });
    expect(s.net).toEqual({ A: -25, B: 23 });
  });

  it("la somme des variations plus la commission vaut toujours zéro", () => {
    const s = settle({ stake: 500, players: ["A", "B", "C"], winner: "C", payout: "korat", abandoned: ["A"] });
    const total = Object.values(s.net).reduce((a, b) => a + b, 0);
    expect(total + s.commission).toBe(0);
  });

  it("un joueur qui a abandonné ne peut pas gagner", () => {
    expect(() => settle({ stake: 100, players: ["A", "B"], winner: "A", payout: "simple", abandoned: ["A"] })).toThrow();
  });
});
