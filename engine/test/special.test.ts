import { describe, expect, it } from "vitest";
import { detectSpecial, resolveSpecial } from "../src/special.ts";
import { c } from "./helpers.ts";

describe("détection des victoires spéciales", () => {
  it("brelan de 7 : rang 1, gain simple", () => {
    const s = detectSpecial([c("zing", 7), c("tchaka", 7), c("koubi", 7), c("black", 9), c("zing", 10)]);
    expect(s).toMatchObject({ kind: "brelan_7", rank: 1, payout: "simple" });
  });

  it("carré de 7 : rang 2, Korat", () => {
    const s = detectSpecial([c("zing", 7), c("tchaka", 7), c("koubi", 7), c("black", 7), c("zing", 10)]);
    expect(s).toMatchObject({ kind: "carre_7", rank: 2, payout: "korat" });
  });

  it("total 16 (3, 3, 3, 3, 4) : rang 3, Korat, plutôt que carré de 3", () => {
    const s = detectSpecial([c("zing", 3), c("tchaka", 3), c("koubi", 3), c("black", 3), c("zing", 4)]);
    expect(s).toMatchObject({ kind: "total_16", rank: 3, payout: "korat", sum: 16 });
  });

  it("carré autre que 7 : rang 4", () => {
    const s = detectSpecial([c("zing", 9), c("tchaka", 9), c("koubi", 9), c("black", 9), c("zing", 10)]);
    expect(s).toMatchObject({ kind: "carre", rank: 4, payout: "simple" });
  });

  it("cinq cartes de la même enseigne : rang 5", () => {
    const s = detectSpecial([c("zing", 4), c("zing", 6), c("zing", 8), c("zing", 9), c("zing", 10)]);
    expect(s).toMatchObject({ kind: "couleur", rank: 5 });
  });

  it("brelan de 3 : rang 6, même si le total est entre 17 et 21", () => {
    const s = detectSpecial([c("zing", 3), c("tchaka", 3), c("koubi", 3), c("black", 4), c("zing", 4)]);
    expect(s).toMatchObject({ kind: "brelan_3", rank: 6, sum: 17 });
  });

  it("total entre 17 et 21 inclus : rang 7", () => {
    expect(detectSpecial([c("zing", 3), c("tchaka", 4), c("koubi", 3), c("black", 4), c("zing", 7)])).toMatchObject({
      kind: "total_17_21",
      sum: 21,
    });
    expect(detectSpecial([c("zing", 3), c("tchaka", 4), c("koubi", 3), c("black", 4), c("zing", 8)])).toBeNull();
  });

  it("aucune victoire spéciale pour une main ordinaire", () => {
    expect(detectSpecial([c("zing", 10), c("tchaka", 9), c("koubi", 8), c("black", 6), c("zing", 5)])).toBeNull();
  });
});

describe("départage des victoires spéciales", () => {
  const brelan7 = [c("zing", 7), c("tchaka", 7), c("koubi", 7), c("black", 9), c("zing", 10)];
  const total16 = [c("zing", 3), c("tchaka", 3), c("koubi", 3), c("black", 3), c("zing", 4)];

  it("le brelan de 7 bat le total 16 (Korat)", () => {
    const win = resolveSpecial({ A: total16, B: brelan7 }, ["A", "B"]);
    expect(win?.winner).toBe("B");
    expect(win?.special.payout).toBe("simple");
    expect(win?.candidates).toHaveLength(2);
  });

  it("à rang égal, la plus petite somme gagne", () => {
    const flushHigh = [c("zing", 6), c("zing", 7), c("zing", 8), c("zing", 9), c("zing", 10)];
    const flushLow = [c("koubi", 4), c("koubi", 5), c("koubi", 6), c("koubi", 8), c("koubi", 10)];
    expect(resolveSpecial({ A: flushHigh, B: flushLow }, ["A", "B"])?.winner).toBe("B");
  });

  it("à rang et somme égaux, le joueur servi en premier gagne", () => {
    const a = [c("zing", 4), c("tchaka", 4), c("koubi", 3), c("black", 5), c("zing", 5)]; // 21
    const b = [c("koubi", 4), c("black", 4), c("tchaka", 3), c("koubi", 5), c("tchaka", 5)]; // 21
    expect(resolveSpecial({ A: a, B: b }, ["B", "A"])?.winner).toBe("B");
    expect(resolveSpecial({ A: a, B: b }, ["A", "B"])?.winner).toBe("A");
  });
});
