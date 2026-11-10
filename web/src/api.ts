import { createClient } from "@supabase/supabase-js";
import type { Card, RoundResult, Trick } from "@fapfap/engine";

// Clés publiques par conception : la clé « publishable » ne donne accès qu'à la vue publique des tables.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://ywrfjeplubwnvjmtyguh.supabase.co";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY ?? "sb_publishable_tQMqkolhUtrgqr6rUvpI8w_UqsANYOT";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

export interface Me {
  id: string;
  pseudo: string;
  balance: number;
  table_id?: string | null;
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
  status: "waiting" | "playing" | "closed";
  seats: string[];
  roundNo: number;
  nextFirstPlayer: string | null;
  deadline: string | null;
  names: Record<string, string>;
  balances: Record<string, number>;
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
  constructor(public status: number, message: string) {
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
  if (!res.ok) throw new ApiError(res.status, body.error ?? "Erreur inattendue");
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
