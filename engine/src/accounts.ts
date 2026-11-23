/**
 * Comptes joueurs (décision de LeCerf du 23/11/2026) : création de compte avec pseudo et mot de passe,
 * ou connexion avec Google (Gmail) ou Facebook. Le pseudo est unique, sans tenir compte des majuscules.
 */
export const PSEUDO_MIN = 3;
export const PSEUDO_MAX = 20;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72;

export type LoginProvider = "google" | "facebook";

const PSEUDO_RE = /^[\p{L}\p{N}_.-]+$/u;

/** Pseudo tel qu'il sera enregistré (espaces autour retirés). */
export function cleanPseudo(raw: string): string {
  return raw.trim();
}

export function checkPseudo(raw: string): string | null {
  const p = cleanPseudo(raw);
  if (p.length < PSEUDO_MIN) return `Le pseudo doit faire au moins ${PSEUDO_MIN} caractères`;
  if (p.length > PSEUDO_MAX) return `Le pseudo doit faire au plus ${PSEUDO_MAX} caractères`;
  if (!PSEUDO_RE.test(p)) return "Le pseudo ne peut contenir que des lettres, des chiffres, _ . et -";
  return null;
}

export function checkPassword(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères`;
  if (pw.length > PASSWORD_MAX) return `Le mot de passe doit faire au plus ${PASSWORD_MAX} caractères`;
  return null;
}

/** Pseudo proposé pour un compte Google ou Facebook, à partir du nom affiché (ou de l'adresse). */
export function pseudoFromName(name: string): string {
  const base = name
    .split("@")[0]!
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_.-]/gu, "")
    .slice(0, PSEUDO_MAX - 3);
  return base.length >= PSEUDO_MIN ? base : `Joueur${base}`;
}

/** Variante numérotée d'un pseudo déjà pris (Jean, Jean2, Jean3…), sans dépasser la longueur maximale. */
export function pseudoVariant(base: string, n: number): string {
  if (n <= 1) return base.slice(0, PSEUDO_MAX);
  const suffix = String(n);
  return base.slice(0, PSEUDO_MAX - suffix.length) + suffix;
}

/** Tables privées (décision de LeCerf du 23/11/2026) : une table est publique, ou privée avec un mot de passe. */
export const TABLE_PASSWORD_MIN = 4;
export const TABLE_PASSWORD_MAX = 32;

export function checkTablePassword(pw: string): string | null {
  if (pw.length < TABLE_PASSWORD_MIN) return `Le mot de passe de la table doit faire au moins ${TABLE_PASSWORD_MIN} caractères`;
  if (pw.length > TABLE_PASSWORD_MAX) return `Le mot de passe de la table doit faire au plus ${TABLE_PASSWORD_MAX} caractères`;
  return null;
}
