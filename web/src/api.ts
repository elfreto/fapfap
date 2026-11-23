import type { SupabaseClient } from "@supabase/supabase-js";
import type { Card, RoundResult, Trick } from "@fapfap/engine";

// Clés publiques par conception : la clé « publishable » ne donne accès qu'à la vue publique des tables.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://ywrfjeplubwnvjmtyguh.supabase.co";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY ?? "sb_publishable_tQMqkolhUtrgqr6rUvpI8w_UqsANYOT";

let client: Promise<SupabaseClient> | null = null;
/** Client temps réel, chargé seulement à l'arrivée sur une table (l'accueil s'affiche sans l'attendre). */
export function realtimeClient(): Promise<SupabaseClient> {
  client ??= import("@supabase/supabase-js").then((m) => m.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } }));
  return client;
}

export interface Me {
  id: string;
  pseudo: string;
  balance: number;
  table_id?: string | null;
  avatar?: string | null;
  is_admin?: boolean;
  /** Le joueur peut se reconnecter (mot de passe, Google ou Facebook). */
  has_login?: boolean;
  auth_provider?: "google" | "facebook" | null;
}

export interface PublicRound {
  players: Array<{ id: string; cardsLeft: number; abandoned: boolean; lateAbandoned?: boolean; dealtHand?: Card[] }>;
  tricks: Trick[];
  turn: string | null;
  result: RoundResult | null;
  /** Le bouton Abandonner est encore disponible (avant le début du 3e pli). */
  abandonOpen?: boolean;
}

export interface PublicTable {
  id: string;
  stake: number;
  capacity: number;
  /** Table privée : il faut son mot de passe pour s'y asseoir. */
  isPrivate?: boolean;
  status: "waiting" | "playing" | "closed";
  seats: string[];
  roundNo: number;
  nextFirstPlayer: string | null;
  deadline: string | null;
  names: Record<string, string>;
  balances: Record<string, number>;
  avatars?: Record<string, string | null>;
  round: PublicRound | null;
}

export interface TableView {
  me: Me;
  table: PublicTable;
  hand: Card[];
  legal: Card[];
  serverTime: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/game`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ action, ...params }),
    });
  } catch {
    throw new ApiError(0, "Connexion interrompue, nouvelle tentative…");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "Erreur inattendue", body.code);
  return body as T;
}

const TOKEN_KEY = "fapfap.token";

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* navigation privée : la session ne survivra pas au rechargement */
  }
}

export interface Transaction {
  id: number;
  kind: "depot" | "retrait";
  method: "paypal" | "mobile_money" | "orange_money";
  amount: number;
  reference: string | null;
  account: string | null;
  status: "en_attente" | "validee" | "refusee" | "annulee";
  created_at: string;
}

/** Coordonnées où envoyer un dépôt, renseignées par l'administrateur. */
export interface PaymentAccount {
  method: Transaction["method"];
  account: string;
  ussd: string;
  note: string;
}

/** Demande vue par l'administrateur, avec le joueur concerné. */
export interface AdminTransaction extends Transaction {
  processed_at: string | null;
  player: { pseudo: string; balance: number } | null;
}

export type LoginProvider = "google" | "facebook";

let authClient: Promise<SupabaseClient> | null = null;
/** Client Supabase Auth, utilisé seulement pour la connexion Google ou Facebook (aller-retour PKCE). */
export function oauthClient(): Promise<SupabaseClient> {
  authClient ??= import("@supabase/supabase-js").then((m) =>
    m.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: false, storageKey: "fapfap.oauth", autoRefreshToken: false },
    }),
  );
  return authClient;
}

/** Fournisseurs activés dans Supabase (Google, Facebook). */
export async function enabledProviders(): Promise<Record<LoginProvider, boolean>> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    const body = await res.json();
    return { google: body?.external?.google === true, facebook: body?.external?.facebook === true };
  } catch {
    return { google: false, facebook: false };
  }
}

/** Part vers Google ou Facebook ; le retour se fait sur la page actuelle avec ?code=… */
export async function startOAuth(provider: LoginProvider) {
  const sb = await oauthClient();
  const back = new URL(location.href);
  back.searchParams.delete("code");
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: back.toString() } });
  if (error) throw new ApiError(400, error.message);
}

/** Au retour de Google ou Facebook : échange le code contre une session Supabase, puis contre un jeton du jeu. */
export async function finishOAuth(): Promise<{ token: string; me: Me } | null> {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const failure = url.searchParams.get("error_description");
  if (!code && !failure) return null;
  url.searchParams.delete("code");
  url.searchParams.delete("error");
  url.searchParams.delete("error_code");
  url.searchParams.delete("error_description");
  history.replaceState(null, "", url);
  if (failure) throw new ApiError(400, `Connexion annulée : ${failure}`);
  const sb = await oauthClient();
  const { data, error } = await sb.auth.exchangeCodeForSession(code!);
  if (error || !data.session) throw new ApiError(400, "Connexion Google ou Facebook interrompue, réessaie");
  try {
    return await call<{ token: string; me: Me }>("oauth_login", { access_token: data.session.access_token });
  } finally {
    await sb.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

/** Table ouverte affichée dans le Salon. */
export interface LobbyTable {
  id: string;
  stake: number;
  capacity: number;
  status: "waiting" | "playing";
  isPrivate: boolean;
  host: string | null;
  players: Array<{ id: string; pseudo: string; avatar: string | null }>;
  createdAt: string;
}

/** Données de la page Profil. */
export interface ProfileData {
  createdAt: string;
  rounds: number;
  wins: number;
  gained: number;
  lost: number;
}
