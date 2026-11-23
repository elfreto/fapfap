/**
 * Dépôts et retraits (page Transactions), sur le modèle fourni par LeCerf le 23/11/2026.
 * Pas de virement IBAN. Chaque opération est une demande vérifiée par un administrateur :
 * - dépôt : le joueur envoie le transfert puis saisit sa référence ; le solde est crédité à la validation ;
 * - retrait : le montant est réservé (retiré du solde) jusqu'au traitement ; un refus ou une annulation le rend.
 */
export type TransactionKind = "depot" | "retrait";
export type PaymentMethod = "paypal" | "mobile_money" | "orange_money";
export type TransactionStatus = "en_attente" | "validee" | "refusee" | "annulee";

export interface PaymentMethodInfo {
  id: PaymentMethod;
  label: string;
  /** Ce que le joueur indique pour recevoir un retrait. */
  account: "phone" | "email";
}

export const PAYMENT_METHODS: readonly PaymentMethodInfo[] = [
  { id: "paypal", label: "PayPal", account: "email" },
  { id: "mobile_money", label: "Mobile Money", account: "phone" },
  { id: "orange_money", label: "Orange Money", account: "phone" },
];

export const STATUS_LABELS: Record<TransactionStatus, string> = {
  en_attente: "En attente",
  validee: "Validée",
  refusee: "Refusée",
  annulee: "Annulée",
};

export const DEPOSIT_MIN = 500;
export const DEPOSIT_MAX = 500_000;
export const WITHDRAW_MIN = 1_000;
/** Demandes en attente autorisées en même temps par joueur. */
export const MAX_PENDING = 3;

export function methodInfo(id: string): PaymentMethodInfo | undefined {
  return PAYMENT_METHODS.find((m) => m.id === id);
}

/** Numéro de téléphone : chiffres seulement (indicatif compris), 8 à 15 chiffres. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s.()-]/g, "").replace(/^\+/, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function isEmail(raw: string): boolean {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(raw.trim());
}

/** Référence du transfert saisie après un dépôt (identifiant ou nom de l'envoi). */
export function cleanReference(raw: string): string | null {
  const ref = raw.trim().replace(/\s+/g, " ");
  return ref.length >= 3 && ref.length <= 80 ? ref : null;
}

const fmt = (n: number) => n.toLocaleString("fr-FR");

/** Étape « Montant » du dépôt et montant du retrait. */
export function checkAmount(kind: TransactionKind, amount: number, available: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "Saisis un montant valide";
  if (kind === "depot") {
    if (amount < DEPOSIT_MIN) return `Dépôt minimum : ${fmt(DEPOSIT_MIN)}`;
    if (amount > DEPOSIT_MAX) return `Dépôt maximum : ${fmt(DEPOSIT_MAX)}`;
  } else {
    if (amount < WITHDRAW_MIN) return `Retrait minimum : ${fmt(WITHDRAW_MIN)}`;
    if (amount > available) return "Solde retirable insuffisant";
  }
  return null;
}

/** Vérifie une demande complète ; renvoie le message à afficher, ou null si elle est valable. */
export function checkRequest(
  kind: TransactionKind,
  r: { method: string; amount: number; reference?: string; account?: string },
  available: number,
): string | null {
  const amountProblem = checkAmount(kind, r.amount, available);
  if (amountProblem) return amountProblem;
  const m = methodInfo(r.method);
  if (!m) return "Choisis un moyen de paiement";
  if (kind === "depot") {
    if (!cleanReference(r.reference ?? "")) return "Saisis la référence du transfert";
  } else if (m.account === "phone") {
    if (!normalizePhone(r.account ?? "")) return "Numéro de téléphone invalide";
  } else if (!isEmail(r.account ?? "")) {
    return "Adresse PayPal invalide";
  }
  return null;
}

/** Compte de réception conservé pour un retrait (numéro sans espaces ou adresse PayPal). */
export function cleanAccount(method: string, raw: string): string | null {
  const m = methodInfo(method);
  if (!m) return null;
  if (m.account === "phone") {
    const d = normalizePhone(raw);
    return d ? `+${d}` : null;
  }
  return isEmail(raw) ? raw.trim().toLowerCase() : null;
}

/**
 * Clé d'unicité d'une référence de dépôt : sans espaces ni différence de majuscules.
 * Une même référence ne peut servir qu'une fois (règle de LeCerf du 23/11/2026) ; la base applique la même clé.
 */
export function referenceKey(raw: string): string {
  return raw.replace(/\s+/g, "").toLowerCase();
}

/** Coordonnées de dépôt saisies par l'administrateur. */
export function checkPaymentAccount(a: { account: string; ussd: string; note: string }): string | null {
  if (a.account.length > 120) return "Coordonnées trop longues (120 caractères maximum)";
  if (a.ussd.length > 60) return "Code USSD trop long (60 caractères maximum)";
  if (a.ussd && !/^[*#\d{}a-z]+$/i.test(a.ussd)) return "Le code USSD ne peut contenir que des chiffres, *, # et {montant}";
  if (a.note.length > 200) return "Note trop longue (200 caractères maximum)";
  return null;
}
