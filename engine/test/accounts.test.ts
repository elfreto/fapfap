import { describe, expect, it } from "vitest";
import { checkPassword, checkPseudo, checkTablePassword, pseudoFromName, pseudoVariant } from "../src/accounts.ts";

describe("comptes", () => {
  it("contrôle le pseudo", () => {
    expect(checkPseudo("Boss")).toBeNull();
    expect(checkPseudo("  Léa_2 ")).toBeNull();
    expect(checkPseudo("ab")).toMatch(/au moins/);
    expect(checkPseudo("a".repeat(21))).toMatch(/au plus/);
    expect(checkPseudo("Jean Paul")).toMatch(/lettres/);
  });
  it("contrôle le mot de passe", () => {
    expect(checkPassword("secret")).toBeNull();
    expect(checkPassword("12345")).toMatch(/au moins/);
  });
  it("propose un pseudo pour Google et Facebook", () => {
    expect(pseudoFromName("Jean Dupont")).toBe("JeanDupont");
    expect(pseudoFromName("jo@gmail.com")).toBe("Joueurjo");
    expect(checkPseudo(pseudoFromName("Émilie N'Dour"))).toBeNull();
    expect(pseudoVariant("Jean", 1)).toBe("Jean");
    expect(pseudoVariant("a".repeat(20), 12)).toBe("a".repeat(18) + "12");
  });
  it("contrôle le mot de passe d'une table privée", () => {
    expect(checkTablePassword("1234")).toBeNull();
    expect(checkTablePassword("123")).toMatch(/au moins/);
    expect(checkTablePassword("x".repeat(33))).toMatch(/au plus/);
  });
});
