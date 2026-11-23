import { describe, expect, it } from "vitest";
import { PAYMENT_METHODS, checkAmount, checkRequest, cleanAccount, cleanReference, normalizePhone } from "../src/transactions.ts";

describe("transactions", () => {
  it("propose PayPal, Mobile Money et Orange Money, sans IBAN", () => {
    expect(PAYMENT_METHODS.map((m) => m.label)).toEqual(["PayPal", "Mobile Money", "Orange Money"]);
  });
  it("contrôle les montants", () => {
    expect(checkAmount("depot", 5000, 0)).toBeNull();
    expect(checkAmount("depot", 100, 0)).toMatch(/minimum/);
    expect(checkAmount("depot", 1_000_000, 0)).toMatch(/maximum/);
    expect(checkAmount("retrait", 500, 10_000)).toMatch(/minimum/);
    expect(checkAmount("retrait", 20_000, 10_000)).toMatch(/insuffisant/);
    expect(checkAmount("depot", 12.5, 0)).toMatch(/valide/);
  });
  it("demande la référence du transfert pour un dépôt", () => {
    expect(checkRequest("depot", { method: "orange_money", amount: 5000, reference: "PP2611.1612" }, 0)).toBeNull();
    expect(checkRequest("depot", { method: "orange_money", amount: 5000, reference: " " }, 0)).toMatch(/référence/);
    expect(cleanReference("  MP  2611 ")).toBe("MP 2611");
  });
  it("demande un numéro ou une adresse PayPal pour un retrait", () => {
    expect(checkRequest("retrait", { method: "mobile_money", amount: 2000, account: "+237 699 00 11 22" }, 5000)).toBeNull();
    expect(checkRequest("retrait", { method: "mobile_money", amount: 2000, account: "12" }, 5000)).toMatch(/téléphone/);
    expect(checkRequest("retrait", { method: "paypal", amount: 2000, account: "moi@exemple.fr" }, 5000)).toBeNull();
    expect(checkRequest("retrait", { method: "paypal", amount: 2000, account: "moi" }, 5000)).toMatch(/PayPal/);
    expect(checkRequest("retrait", { method: "iban", amount: 2000, account: "FR76" }, 5000)).toMatch(/moyen/);
  });
  it("nettoie le compte de réception", () => {
    expect(normalizePhone("+237 699-00-11-22")).toBe("237699001122");
    expect(cleanAccount("orange_money", "+237 699 00 11 22")).toBe("+237699001122");
    expect(cleanAccount("paypal", " Moi@Exemple.fr ")).toBe("moi@exemple.fr");
  });
});
