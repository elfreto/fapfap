import { useCallback, useEffect, useState } from "react";
import { STAKES, STARTING_CREDITS, requiredBalance } from "@fapfap/engine";
import { ApiError, type Me, type TableView, call, finishOAuth, loadToken, saveToken } from "./api.ts";
import { ChangePassword, SetPassword, Welcome } from "./Login.tsx";
import { Avatar, type AvatarChoice, AvatarPicker } from "./Avatar.tsx";
import { Rules } from "./Rules.tsx";
import { Table } from "./Table.tsx";
import { Transactions } from "./Transactions.tsx";
import { Admin } from "./Admin.tsx";

type Page = "home" | "transactions" | "admin";

function pageFromUrl(): Page {
  if (location.pathname.endsWith("/transactions")) return "transactions";
  if (location.pathname.endsWith("/admin")) return "admin";
  return "home";
}

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
  const [page, setPage] = useState<Page>(pageFromUrl);
  const openPage = useCallback((p: Page) => {
    setPage(p);
    history.replaceState(null, "", (p === "home" ? "/" : `/${p}`) + location.search);
  }, []);

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

  // Retour de Google ou Facebook (?code=… dans l'adresse).
  useEffect(() => {
    run(async () => {
      const r = await finishOAuth();
      if (!r) return;
      saveToken(r.token);
      setMe(r.me);
      setToken(r.token);
    });
  }, [run]);

  const signedIn = (r: { token: string; me: Me }) => {
    saveToken(r.token);
    setMe(r.me);
    setToken(r.token);
  };

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
        onRegister={(pseudo, password) => run(async () => signedIn(await call<{ token: string; me: Me }>("register", { pseudo, password })))}
        onLogin={(pseudo, password) => run(async () => signedIn(await call<{ token: string; me: Me }>("login", { pseudo, password })))}
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

  if (page === "transactions") {
    return <Transactions token={token} me={me} onMe={setMe} onBack={() => openPage("home")} />;
  }

  if (page === "admin" && me.is_admin) {
    return <Admin token={token} onBack={() => openPage("home")} />;
  }

  return (
    <Home
      me={me}
      onTransactions={() => openPage("transactions")}
      onAdmin={() => openPage("admin")}
      onChangePassword={async (current, password) => {
        const r = await call<{ me: Me }>("change_password", { token, current, password });
        setMe(r.me);
      }}
      onSetPassword={async (password) => {
        const r = await call<{ me: Me }>("set_password", { token, password });
        setMe(r.me);
      }}
      onLogout={() => {
        saveToken(null);
        setToken(null);
        setMe(null);
        setView(null);
        setInvite(null);
        openPage("home");
      }}
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
      onAvatar={async (choice) => {
        const r = await call<{ me: Me }>("avatar", { token, ...choice });
        setMe(r.me);
      }}
      onReload={() =>
        run(async () => {
          const r = await call<{ me: Me }>("reload", { token });
          setMe(r.me);
        })
      }
    />
  );
}

function Home(props: {
  me: Me;
  busy: boolean;
  error: string | null;
  onCreate: (stake: number, capacity: number) => void;
  onJoin: (code: string) => void;
  onReload: () => void;
  onTransactions: () => void;
  onAdmin: () => void;
  onLogout: () => void;
  onSetPassword: (password: string) => Promise<void>;
  onChangePassword: (current: string, password: string) => Promise<void>;
  onAvatar: (choice: AvatarChoice) => Promise<void>;
  onRules: () => void;
  rules: React.ReactNode;
}) {
  const [picker, setPicker] = useState(false);
  const [logout, setLogout] = useState(false);
  const [changePw, setChangePw] = useState(false);
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
        <div className="profile">
          <button type="button" className="profile-avatar" onClick={() => setPicker(true)} aria-label="Changer d'avatar">
            <Avatar id={me.id} name={me.pseudo} avatar={me.avatar} className="avatar-mini" />
            <span className="profile-edit">✎</span>
          </button>
          <p>
            Bonjour <b>{me.pseudo}</b>
          </p>
        </div>
        <p className="balance">
          {me.balance.toLocaleString("fr-FR")} <small>crédits virtuels</small>
        </p>
        <button type="button" className="btn primary home-tx" onClick={props.onTransactions}>
          Dépôt et retrait
        </button>
        {me.is_admin && (
          <button type="button" className="btn home-admin" onClick={props.onAdmin}>
            Administration
          </button>
        )}
        {!me.has_login && <SetPassword onSave={props.onSetPassword} />}
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
        {me.has_login && !me.auth_provider &&
          (changePw ? (
            <ChangePassword onSave={props.onChangePassword} onClose={() => setChangePw(false)} />
          ) : (
            <button type="button" className="btn ghost" onClick={() => setChangePw(true)}>
              Changer de mot de passe
            </button>
          ))}
        {logout ? (
          <div className="logout-confirm" role="alertdialog" aria-labelledby="logout-title">
            <p id="logout-title">
              <b>Se déconnecter ?</b>
            </p>
            <p className="small">
              {me.has_login ? (
                me.auth_provider ? (
                  <>Tu pourras revenir avec le bouton {me.auth_provider === "google" ? "Gmail" : "Facebook"}.</>
                ) : (
                  <>
                    Tu pourras revenir avec ton pseudo <b>{me.pseudo}</b> et ton mot de passe.
                  </>
                )
              ) : (
                <>
                  Ce compte n'a pas de mot de passe : une fois déconnecté, tu ne pourras plus revenir sur <b>{me.pseudo}</b> ni sur ses{" "}
                  {me.balance.toLocaleString("fr-FR")} crédits. Choisis d'abord un mot de passe ci-dessus.
                </>
              )}
            </p>
            <div className="row">
              <button type="button" className="btn danger" onClick={props.onLogout}>
                Me déconnecter
              </button>
              <button type="button" className="btn ghost" onClick={() => setLogout(false)}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn ghost logout" onClick={() => setLogout(true)}>
            Déconnexion
          </button>
        )}
      </div>
      {picker && <AvatarPicker me={me} onSave={props.onAvatar} onClose={() => setPicker(false)} />}
      {props.rules}
    </main>
  );
}
