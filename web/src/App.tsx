import { useCallback, useEffect, useState } from "react";
import { STAKES, STARTING_CREDITS, requiredBalance } from "@fapfap/engine";
import { ApiError, type Me, type TableView, call, loadToken, saveToken } from "./api.ts";
import { Rules } from "./Rules.tsx";
import { Table } from "./Table.tsx";

function inviteCode(): string | null {
  const t = new URLSearchParams(location.search).get("t");
  return t ? t.toUpperCase() : null;
}

function setInvite(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("t", code);
  else url.searchParams.delete("t");
  history.replaceState(null, "", url);
}

export function App() {
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<TableView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        saveToken(null);
        setToken(null);
        setMe(null);
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Reprise de session : profil, puis table en cours ou invitation.
  useEffect(() => {
    if (!token) return;
    run(async () => {
      const { me } = await call<{ me: Me }>("me", { token });
      setMe(me);
      const code = inviteCode() ?? me.table_id ?? null;
      if (code) {
        const v = await call<TableView>(me.table_id === code ? "view" : "join", { token, code });
        setView(v);
        setInvite(v.table.id);
      }
    });
  }, [token, run]);

  if (!token || !me) {
    return (
      <Welcome
        busy={busy}
        error={error}
        hasInvite={!!inviteCode()}
        onRules={() => setShowRules(true)}
        onRegister={(pseudo) =>
          run(async () => {
            const r = await call<{ token: string; me: Me }>("register", { pseudo });
            saveToken(r.token);
            setMe(r.me);
            setToken(r.token);
          })
        }
        rules={showRules ? <Rules onClose={() => setShowRules(false)} /> : null}
      />
    );
  }

  if (view && view.table.seats.includes(me.id)) {
    return (
      <Table
        token={token}
        view={view}
        setView={setView}
        onLeave={() =>
          run(async () => {
            await call("leave", { token });
            const { me: fresh } = await call<{ me: Me }>("me", { token });
            setMe(fresh);
            setView(null);
            setInvite(null);
          })
        }
      />
    );
  }

  return (
    <Home
      me={me}
      busy={busy}
      error={error}
      onRules={() => setShowRules(true)}
      rules={showRules ? <Rules onClose={() => setShowRules(false)} /> : null}
      onCreate={(stake, capacity) =>
        run(async () => {
          const v = await call<TableView>("create", { token, stake, capacity });
          setView(v);
          setMe(v.me);
          setInvite(v.table.id);
        })
      }
      onJoin={(code) =>
        run(async () => {
          const v = await call<TableView>("join", { token, code: code.trim().toUpperCase() });
          setView(v);
          setMe(v.me);
          setInvite(v.table.id);
        })
      }
      onReload={() =>
        run(async () => {
          const r = await call<{ me: Me }>("reload", { token });
          setMe(r.me);
        })
      }
    />
  );
}

function Welcome(props: {
  busy: boolean;
  error: string | null;
  hasInvite: boolean;
  onRegister: (pseudo: string) => void;
  onRules: () => void;
  rules: React.ReactNode;
}) {
  const [pseudo, setPseudo] = useState("");
  return (
    <main className="screen center">
      <div className="panel">
        <h1 className="logo">
          FapFap <span>♣♦♥♠</span>
        </h1>
        <p className="muted">Prototype de test entre amis. Crédits virtuels, sans aucune valeur.</p>
        {props.hasInvite && <p className="notice">Vous avez été invité à une table. Choisissez un pseudo pour la rejoindre.</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pseudo.trim()) props.onRegister(pseudo.trim());
          }}
        >
          <label htmlFor="pseudo">Votre pseudo</label>
          <input id="pseudo" value={pseudo} maxLength={20} onChange={(e) => setPseudo(e.target.value)} autoFocus />
          <button className="btn primary" disabled={props.busy || !pseudo.trim()}>
            Entrer
          </button>
        </form>
        {props.error && <p className="error">{props.error}</p>}
        <button type="button" className="btn ghost" onClick={props.onRules}>
          Lire les règles
        </button>
      </div>
      {props.rules}
    </main>
  );
}

function Home(props: {
  me: Me;
  busy: boolean;
  error: string | null;
  onCreate: (stake: number, capacity: number) => void;
  onJoin: (code: string) => void;
  onReload: () => void;
  onRules: () => void;
  rules: React.ReactNode;
}) {
  const [stake, setStake] = useState(100);
  const [capacity, setCapacity] = useState(4);
  const [code, setCode] = useState("");
  const { me } = props;
  return (
    <main className="screen center">
      <div className="panel">
        <h1 className="logo">
          FapFap <span>♣♦♥♠</span>
        </h1>
        <p>
          Bonjour <b>{me.pseudo}</b>
        </p>
        <p className="balance">
          {me.balance.toLocaleString("fr-FR")} <small>crédits virtuels</small>
        </p>
        {me.balance < STARTING_CREDITS && (
          <button type="button" className="btn" onClick={props.onReload} disabled={props.busy}>
            Recharger à {STARTING_CREDITS.toLocaleString("fr-FR")} (prototype)
          </button>
        )}

        <section>
          <h2>Créer une table</h2>
          <label htmlFor="stake">Mise</label>
          <select id="stake" value={stake} onChange={(e) => setStake(Number(e.target.value))}>
            {STAKES.map((s) => (
              <option key={s} value={s} disabled={me.balance < requiredBalance(s)}>
                {s.toLocaleString("fr-FR")} crédits {me.balance < requiredBalance(s) ? "(solde insuffisant)" : ""}
              </option>
            ))}
          </select>
          <label>Nombre de places</label>
          <div className="seg">
            {[2, 3, 4].map((n) => (
              <button type="button" key={n} className={n === capacity ? "on" : ""} onClick={() => setCapacity(n)}>
                {n}
              </button>
            ))}
          </div>
          <button type="button" className="btn primary" disabled={props.busy} onClick={() => props.onCreate(stake, capacity)}>
            Créer la table
          </button>
        </section>

        <section>
          <h2>Rejoindre une table</h2>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) props.onJoin(code);
            }}
          >
            <input placeholder="Code (ex. K7M2Q)" value={code} maxLength={5} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button className="btn" disabled={props.busy || code.trim().length < 5}>
              Rejoindre
            </button>
          </form>
        </section>
        {props.error && <p className="error">{props.error}</p>}
        <button type="button" className="btn ghost" onClick={props.onRules}>
          Règles du jeu
        </button>
      </div>
      {props.rules}
    </main>
  );
}
