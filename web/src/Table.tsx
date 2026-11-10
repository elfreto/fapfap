import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Card, SPECIAL_RULES, cardId, requiredBalance, sameCard } from "@fapfap/engine";
import { ApiError, type TableView, call, supabase } from "./api.ts";
import { CardBack, CardFace, SUIT_NAME, SUIT_SYMBOL, cardLabel } from "./cards.tsx";
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
  const { table, me, hand, legal } = view;
  const round = table.round;
  const code = table.id;
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "abandon" | "leave">(null);
  const [showRules, setShowRules] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
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

  return (
    <main className="screen table-screen">
      <header className="topbar">
        <div>
          <b>Table {code}</b> · Mise {fmt(table.stake)} · {table.seats.length}/{table.capacity} joueurs
        </div>
        <div className="topbar-actions">
          <span className="chip">{fmt(table.balances[me.id] ?? me.balance)} crédits</span>
          <button type="button" className="btn small" onClick={share}>
            {copied ? "Lien copié" : "Inviter"}
          </button>
          <button type="button" className="btn small ghost" onClick={() => setShowRules(true)}>
            Règles
          </button>
          <button type="button" className="btn small ghost" onClick={() => setConfirm("leave")}>
            Quitter
          </button>
        </div>
      </header>

      {offline && <div className="banner warn">Connexion interrompue, reconnexion en cours…</div>}

      <div className="stage">
        <div className="board-wrap">
          <div className="board">
            {sides.map(({ side, id }) => {
              if (!id) {
                return (
                  <div key={side} className={`seat seat-${side}`}>
                    <div className="plate empty">Place libre</div>
                  </div>
                );
              }
              const rp = round?.players.find((p) => p.id === id);
              const isTurn = active && round!.turn === id;
              const plays = playsBy[id] ?? [];
              return (
                <div key={side} className={`seat seat-${side} ${rp?.abandoned ? "out" : ""}`}>
                  <div className={`plate ${isTurn ? "turn" : ""}`}>
                    <span className="plate-name">{name(id)}</span>
                    <span className="plate-meta">{fmt(table.balances[id] ?? 0)} cr.</span>
                    {id !== me.id && rp && !rp.abandoned && !round!.result && <CardBack count={rp.cardsLeft} />}
                    {rp?.abandoned && <span className="tag">Abandon</span>}
                    {!rp && active && <span className="tag">Prochaine manche</span>}
                    {isTurn && remaining !== null && <span className={`timer ${remaining <= 10 ? "hurry" : ""}`}>{remaining} s</span>}
                  </div>
                  <div className="played-cards">
                    {plays.map((pl) => (
                      <CardFace
                        key={cardId(pl.card)}
                        card={pl.card}
                        size="sm"
                        state={trick && pl.trick === trick.number && !round!.result ? "current" : pl.won ? "won" : "old"}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="board-center">
              {!round && (
                <>
                  <p className="small">
                    {table.seats.length < 2 ? `Partagez le code ${code} pour inviter vos amis.` : "Tout le monde est prêt ?"}
                  </p>
                  <button type="button" className="btn primary small" disabled={!enoughToStart} onClick={() => act("start")}>
                    Lancer la manche
                  </button>
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
                    <div className="small muted">{name(round!.turn!)} mène</div>
                  )}
                  {remaining !== null && <div className={`center-timer ${remaining <= 10 ? "hurry" : ""}`}>{remaining} s</div>}
                </>
              )}
              {round?.result && !showResult && (
                <button type="button" className="btn small primary" onClick={() => setShowResult(true)}>
                  Voir le résultat
                </button>
              )}
            </div>
          </div>
        </div>

        <section className="me">
          <div className="me-status">
            {active && myTurn && (
              <span className="your-turn">
                À vous de jouer {remaining !== null && <b className={remaining <= 10 ? "hurry" : ""}>{remaining} s</b>}
              </span>
            )}
            {stillPlaying && !myTurn && <span>Au tour de {name(round!.turn!)}</span>}
            {iAbandoned && active && <span>Vous avez abandonné cette manche.</span>}
            {active && !inRound && <span>Vous jouerez à la prochaine manche.</span>}
            {abandonOpen && (
              <button type="button" className="btn small danger" onClick={() => setConfirm("abandon")}>
                Abandonner
              </button>
            )}
          </div>
          <div className="hand">
            {hand.map((c) => {
              const id = cardId(c);
              const legalCard = myTurn && isLegal(c);
              const state = !myTurn ? undefined : selected === id ? "selected" : legalCard ? "legal" : "illegal";
              return (
                <CardFace
                  key={id}
                  card={c}
                  size="lg"
                  state={state}
                  onClick={
                    legalCard
                      ? () => {
                          if (selected === id) {
                            setSelected(null);
                            void act("play", { card: id });
                          } else setSelected(id);
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
          {myTurn && <p className="hint">Touchez une carte pour la choisir, puis touchez-la encore pour la jouer.</p>}
          {error && <p className="error">{error}</p>}
        </section>
      </div>

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
                {(p.dealtHand ?? []).map((c) => (
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
