import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Card, SPECIAL_RULES, cardId, requiredBalance, sameCard } from "@fapfap/engine";
import { ApiError, type TableView, call, supabase } from "./api.ts";
import { CardFace, sortHand, SUIT_NAME, SUIT_SYMBOL, cardLabel } from "./cards.tsx";
import { Rules } from "./Rules.tsx";

const fmt = (n: number) => n.toLocaleString("fr-FR");

export function Table({
  token,
  view,
  setView,
  onLeave,
}: {
  token: string;
  view: TableView;
  setView: (v: TableView) => void;
  onLeave: () => void;
}) {
  const { table, me, legal } = view;
  const hand = useMemo(() => sortHand(view.hand), [view.hand]);
  const round = table.round;
  const code = table.id;
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "abandon" | "leave">(null);
  const [showRules, setShowRules] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const clockOffset = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    clockOffset.current = Date.parse(view.serverTime) - Date.now();
  }, [view.serverTime]);

  const refresh = useCallback(async () => {
    try {
      const v = await call<TableView>("view", { token, code });
      setView(v);
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOffline(true);
    }
  }, [token, code, setView]);

  // Temps réel : chaque changement de la table publique déclenche une relecture de ma vue.
  useEffect(() => {
    const channel = supabase
      .channel(`table-${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "table_public", filter: `id=eq.${code}` }, () => {
        void refresh();
      })
      .subscribe();
    const poll = setInterval(refresh, 4000);
    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [code, refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const act = useCallback(
    async (action: string, params: Record<string, unknown> = {}) => {
      setError(null);
      try {
        const v = await call<TableView>(action, { token, code, ...params });
        setView(v);
        setOffline(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) setOffline(true);
        setError(e instanceof Error ? e.message : String(e));
        void refresh();
      }
    },
    [token, code, setView, refresh],
  );

  const active = !!round && !round.result;
  const deadline = table.deadline ? Date.parse(table.deadline) : null;
  const remaining = active && deadline ? Math.max(0, Math.ceil((deadline - (now + clockOffset.current)) / 1000)) : null;

  // Délai dépassé : n'importe quel joueur demande au serveur d'appliquer l'abandon.
  useEffect(() => {
    if (!active || !deadline || ticking.current) return;
    if (now + clockOffset.current > deadline + 2500) {
      ticking.current = true;
      void call<TableView>("tick", { token, code })
        .then(setView)
        .catch(() => undefined)
        .finally(() => {
          ticking.current = false;
        });
    }
  }, [now, active, deadline, token, code, setView]);

  const myTurn = active && round!.turn === me.id;
  const inRound = !!round && round.players.some((p) => p.id === me.id);
  const iAbandoned = !!round?.players.find((p) => p.id === me.id)?.abandoned;
  const stillPlaying = active && inRound && !iAbandoned;
  const abandonOpen = stillPlaying && round!.abandonOpen !== false;
  const trick = round ? round.tricks[round.tricks.length - 1]! : null;
  const isLegal = (c: Card) => legal.some((l) => sameCard(l, c));
  const name = (id: string) => (id === me.id ? "Vous" : table.names[id] ?? "?");
  const enoughToStart = table.seats.filter((id) => (table.balances[id] ?? 0) >= requiredBalance(table.stake)).length >= 2;
  const [showResult, setShowResult] = useState(true);
  const resultKey = round?.result ? `${table.roundNo}` : "";
  useEffect(() => setShowResult(true), [resultKey]);

  // Places autour de la table : moi en bas, puis les autres dans le sens horaire (gauche, haut, droite).
  const sides = useMemo(() => seatLayout(table.seats, round?.players.map((p) => p.id) ?? [], me.id, table.capacity), [table.seats, round, me.id, table.capacity]);
  const playsBy = useMemo(() => {
    const m: Record<string, Array<{ card: Card; trick: number; won: boolean }>> = {};
    for (const t of round?.tricks ?? []) {
      for (const pl of t.plays) (m[pl.player] ??= []).push({ card: pl.card, trick: t.number, won: t.winner === pl.player });
    }
    return m;
  }, [round]);

  async function share() {
    const url = `${location.origin}${location.pathname}?t=${code}`;
    try {
      if (navigator.share) await navigator.share({ title: "FapFap", text: `Rejoins ma table FapFap (code ${code})`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* partage annulé */
    }
  }

  const ended = !!round?.result;
  const selectedCard = selected ? hand.find((c) => cardId(c) === selected) : undefined;
  const canPlaySelected = myTurn && !!selectedCard && isLegal(selectedCard);
  const canStart = (!round || ended) && enoughToStart && table.seats.includes(me.id);
  function jouer() {
    if (canPlaySelected) {
      setSelected(null);
      void act("play", { card: selected });
    } else if (canStart) void act("start");
  }
  const status = !round
    ? table.seats.length < 2
      ? "En attente de joueurs"
      : "Prêts à jouer"
    : ended
      ? "Manche terminée"
      : null;

  return (
    <main className="game">
      <div className="hud hud-left">
        <button type="button" className="hud-btn" aria-label="Menu" onClick={() => setMenu(true)}>
          <span className="burger" />
        </button>
      </div>
      <div className="hud hud-right">
        <div className="hud-info">
          <div>
            Table {code} · Mise {fmt(table.stake)}
          </div>
          <div>
            {status ?? (
              <>
                Tour : <b>{name(round!.turn!)}</b>
              </>
            )}
          </div>
        </div>
      </div>

      {offline && <div className="banner warn">Connexion interrompue, reconnexion en cours…</div>}

      <div className="arena">
        <div className="board">
          <div className="felt-line" />
          <div className="emblem" aria-hidden="true">
            <span className="em em-top">♠</span>
            <span className="em em-left">♥</span>
            <span className="em em-right">♦</span>
            <span className="em em-bottom">♣</span>
            {!active && <span className="em em-center">♣</span>}
          </div>

          <div className="center-info">
            {!round && (
              <>
                <p>{table.seats.length < 2 ? `Partagez le code ${code} pour inviter vos amis.` : "Tout le monde est prêt ?"}</p>
                {table.seats.length < table.capacity && (
                  <button type="button" className="btn small" onClick={share}>
                    {copied ? "Lien copié" : "Inviter"}
                  </button>
                )}
              </>
            )}
            {active && trick && (
              <>
                <div className="center-trick">Pli {trick.number}/5</div>
                {trick.ledSuit ? (
                  <div className={`center-suit ${trick.ledSuit === "zing" || trick.ledSuit === "koubi" ? "red" : ""}`} title="Enseigne demandée">
                    {SUIT_SYMBOL[trick.ledSuit]}
                    <span>{SUIT_NAME[trick.ledSuit]}</span>
                  </div>
                ) : (
                  <div className="center-lead">{name(round!.turn!)} mène</div>
                )}
              </>
            )}
            {ended && !showResult && (
              <button type="button" className="btn small primary" onClick={() => setShowResult(true)}>
                Voir le résultat
              </button>
            )}
          </div>

          {sides.map(({ side, id }) => {
            const rp = id ? round?.players.find((p) => p.id === id) : undefined;
            const isTurn = !!id && active && round!.turn === id;
            const plays = id ? playsBy[id] ?? [] : [];
            return (
              <div key={side} className={`seat seat-${side} ${rp?.abandoned ? "out" : ""}`}>
                <div className={`badge ${isTurn ? "turn" : ""} ${id ? "" : "empty"}`}>
                  <div className="avatar" style={id ? { background: avatarColor(id) } : undefined}>
                    {id ? initials(table.names[id] ?? "?") : "?"}
                  </div>
                  <div className="pill">
                    <span className="pname">{id ? name(id) : "Place libre"}</span>
                    {id && (
                      <span className="pcoins">
                        <span className="coin" />
                        {fmt(table.balances[id] ?? 0)}
                      </span>
                    )}
                    {rp?.abandoned && <span className="ptag">Abandon</span>}
                    {id && !rp && active && <span className="ptag">Prochaine manche</span>}
                    {isTurn && remaining !== null && <span className={`ptimer ${remaining <= 10 ? "hurry" : ""}`}>{remaining} s</span>}
                  </div>
                </div>
                {side !== "bottom" && rp && !rp.abandoned && !ended && (
                  <div className="backs">
                    {Array.from({ length: rp.cardsLeft }, (_, i) => (
                      <span key={i} className="cardback" />
                    ))}
                  </div>
                )}
                <div className="played-cards">
                  {plays.map((pl) => (
                    <CardFace
                      key={cardId(pl.card)}
                      card={pl.card}
                      size="sm"
                      state={trick && pl.trick === trick.number && !ended ? "current" : pl.won ? "won" : "old"}
                    />
                  ))}
                </div>
                {side === "bottom" && (
                  <div className="my-hand">
                    {hand.map((c, i) => {
                      const cid = cardId(c);
                      const legalCard = myTurn && isLegal(c);
                      const state = !myTurn ? undefined : selected === cid ? "selected" : legalCard ? "legal" : "illegal";
                      const off = i - (hand.length - 1) / 2;
                      return (
                        <div key={cid} className="fan" style={{ transform: `rotate(${off * 7}deg) translateY(${Math.abs(off) * 1.2}cqw)` }}>
                          <CardFace
                            card={c}
                            size="lg"
                            state={state}
                            onClick={
                              legalCard
                                ? () => {
                                    if (selected === cid) {
                                      setSelected(null);
                                      void act("play", { card: cid });
                                    } else setSelected(cid);
                                  }
                                : undefined
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="msg-line">
        {error ? (
          <span className="error">{error}</span>
        ) : myTurn ? (
          <span className="your-turn">
            À vous de jouer {remaining !== null && <b className={remaining <= 10 ? "hurry" : ""}>{remaining} s</b>}
            {!canPlaySelected && <span className="muted"> · choisissez une carte</span>}
          </span>
        ) : iAbandoned && active ? (
          <span>Vous avez abandonné cette manche.</span>
        ) : active && !inRound ? (
          <span>Vous jouerez à la prochaine manche.</span>
        ) : null}
      </div>

      <nav className="actions">
        <button type="button" className="act act-blue" onClick={() => setShowRules(true)}>
          <span className="ico">?</span> Règles
        </button>
        <button type="button" className="act act-green" disabled={!canPlaySelected && !canStart} onClick={jouer}>
          <span className="ico play" /> Jouer
        </button>
        <button type="button" className="act act-red" disabled={!abandonOpen} onClick={() => setConfirm("abandon")}>
          <span className="ico">✕</span> Abandonner
        </button>
        <button type="button" className="act act-navy" onClick={() => setMenu(true)}>
          <span className="ico">⚙</span> Options
        </button>
      </nav>

      {menu && (
        <div className="modal" role="dialog" onClick={() => setMenu(false)}>
          <div className="modal-box menu" onClick={(e) => e.stopPropagation()}>
            <h2>Options</h2>
            <p className="muted small">
              Table {code} · {table.seats.length}/{table.capacity} joueurs · Votre solde : {fmt(table.balances[me.id] ?? me.balance)} crédits
            </p>
            <button type="button" className="btn" onClick={share}>
              {copied ? "Lien copié" : "Inviter des amis"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setMenu(false);
                setShowRules(true);
              }}
            >
              Règles du jeu
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                setMenu(false);
                setConfirm("leave");
              }}
            >
              Quitter la table
            </button>
            <button type="button" className="btn ghost" onClick={() => setMenu(false)}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {round?.result && showResult && (
        <div className="modal" role="dialog">
          <Result view={view} name={name} onNext={() => act("start")} canNext={enoughToStart} onHide={() => setShowResult(false)} />
        </div>
      )}

      {confirm && (
        <div className="modal" role="dialog">
          <div className="modal-box">
            {confirm === "abandon" ? (
              <>
                <h2>Abandonner la manche ?</h2>
                <p>Vous paierez {fmt(table.stake)} crédits au vainqueur et ne pourrez plus jouer cette manche.</p>
              </>
            ) : stillPlaying && !abandonOpen ? (
              <>
                <h2>Impossible de quitter maintenant</h2>
                <p>À partir du 3e pli, on ne peut plus abandonner : terminez la manche (sans jouer, vous abandonnez au bout de 30 s).</p>
              </>
            ) : (
              <>
                <h2>Quitter la table ?</h2>
                <p>{stillPlaying ? `Une manche est en cours : vous abandonnerez et paierez ${fmt(table.stake)} crédits.` : "Vous pourrez revenir avec le code de la table."}</p>
              </>
            )}
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>
                {confirm === "leave" && stillPlaying && !abandonOpen ? "Compris" : "Annuler"}
              </button>
              {!(confirm === "leave" && stillPlaying && !abandonOpen) && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    const what = confirm;
                    setConfirm(null);
                    if (what === "abandon") void act("abandon");
                    else onLeave();
                  }}
                >
                  {confirm === "abandon" ? "Abandonner" : "Quitter"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {showRules && <Rules onClose={() => setShowRules(false)} />}
    </main>
  );
}

type Side = "bottom" | "left" | "top" | "right";
const LAYOUTS: Record<number, Side[]> = { 2: ["bottom", "top"], 3: ["bottom", "left", "right"], 4: ["bottom", "left", "top", "right"] };

/** Associe chaque côté de la table à un joueur (sens horaire à partir de moi, en bas). */
function seatLayout(seats: string[], roundPlayers: string[], me: string, capacity: number): Array<{ side: Side; id: string | null }> {
  const all = [...seats, ...roundPlayers.filter((p) => !seats.includes(p))];
  const order = rotateFrom(all, me);
  const n = Math.min(4, Math.max(2, capacity, order.length));
  return LAYOUTS[n]!.map((side, i) => ({ side, id: order[i] ?? null }));
}

function rotateFrom(list: string[], start: string): string[] {
  const i = list.indexOf(start);
  return i < 0 ? list : [...list.slice(i), ...list.slice(0, i)];
}

function Result({
  view,
  name,
  onNext,
  canNext,
  onHide,
}: {
  view: TableView;
  name: (id: string) => string;
  onNext: () => void;
  canNext: boolean;
  onHide: () => void;
}) {
  const { table } = view;
  const res = table.round!.result!;
  const s = res.settlement;
  const special = res.special ? SPECIAL_RULES.find((r) => r.kind === res.special!.special.kind) : null;
  const how =
    res.reason === "special"
      ? `Victoire spéciale : ${special?.label ?? ""}`
      : res.reason === "last_standing"
        ? "Tous les autres joueurs ont abandonné"
        : `Gagne le 5e pli avec le ${cardLabel(res.winningCard!)}`;
  return (
    <div className="result">
      <button type="button" className="btn small ghost result-hide" onClick={onHide}>
        Voir la table
      </button>
      <h2>
        {res.winner === view.me.id ? "Vous gagnez la manche !" : `${table.names[res.winner]} gagne la manche`}
      </h2>
      <p>
        {how}
        {res.payout === "korat" && <b className="korat"> · Korat</b>}
      </p>
      {res.reason === "special" && (
        <div className="all-hands">
          {table.round!.players.map((p) => (
            <div key={p.id} className={`all-hand ${p.id === res.winner ? "win" : ""}`}>
              <div>
                {name(p.id)} {p.id === res.winner && <span className="tag gold">Gagnant</span>}
              </div>
              <div className="row tight">
                {sortHand(p.dealtHand ?? []).map((c) => (
                  <CardFace key={cardId(c)} card={c} size="sm" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <table className="payments">
        <thead>
          <tr>
            <th>Joueur</th>
            <th>Résultat</th>
            <th>Nouveau solde</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(s.net).map(([id, net]) => (
            <tr key={id}>
              <td>
                {name(id)}
                {table.round!.players.find((p) => p.id === id)?.abandoned ? " (abandon)" : ""}
              </td>
              <td className={net >= 0 ? "pos" : "neg"}>
                {net >= 0 ? "+" : ""}
                {fmt(net)}
              </td>
              <td>{fmt(table.balances[id] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Gain {fmt(s.gain)} − contribution du croupier 10 % ({fmt(s.commission)}).
        {table.nextFirstPlayer && ` Prochaine manche : ${name(table.nextFirstPlayer)} commence.`}
      </p>
      <button type="button" className="btn primary" disabled={!canNext} onClick={onNext}>
        Manche suivante
      </button>
      {!canNext && <p className="muted small">Il faut au moins 2 joueurs avec 2 × la mise.</p>}
    </div>
  );
}

const AVATAR_COLORS = ["#e2553f", "#2f80ed", "#27ae60", "#9b51e0", "#f2994a", "#16a5a5", "#d6336c"];
function avatarColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return s.toUpperCase();
}
