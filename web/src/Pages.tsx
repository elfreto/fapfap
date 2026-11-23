import { useCallback, useEffect, useState } from "react";
import { STAKES, STARTING_CREDITS, TABLE_PASSWORD_MAX, checkTablePassword, requiredBalance } from "@fapfap/engine";
import { ApiError, type LobbyTable, type Me, type ProfileData, call } from "./api.ts";
import { Avatar, type AvatarChoice, AvatarPicker } from "./Avatar.tsx";
import { ChangePassword, SetPassword } from "./Login.tsx";

export type MainPage = "home" | "salon" | "profil";

const fmt = (n: number) => n.toLocaleString("fr-FR");
const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Barre de navigation commune aux pages Accueil, Salon et Profil. */
export function NavBar({ page, onPage }: { page: MainPage; onPage: (p: MainPage) => void }) {
  const items: Array<{ id: MainPage; label: string; icon: string }> = [
    { id: "home", label: "Accueil", icon: "⌂" },
    { id: "salon", label: "Salon", icon: "♣" },
    { id: "profil", label: "Profil", icon: "☺" },
  ];
  return (
    <nav className="nav-bar" aria-label="Pages">
      {items.map((it) => (
        <button key={it.id} type="button" className={page === it.id ? "on" : ""} aria-current={page === it.id ? "page" : undefined} onClick={() => onPage(it.id)}>
          <span aria-hidden="true">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="tx-head page-head">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

/** Accueil : solde et accès rapides. */
export function HomePage(props: {
  me: Me;
  busy: boolean;
  onPage: (p: MainPage) => void;
  onTransactions: () => void;
  onAdmin: () => void;
  onReload: () => void;
  onSetPassword: (password: string) => Promise<void>;
  onRules: () => void;
  rules: React.ReactNode;
}) {
  const { me } = props;
  return (
    <main className="screen page-screen">
      <div className="panel home-panel">
        <h1 className="logo">
          FapFap <span>♣♦♥♠</span>
        </h1>
        <button type="button" className="profile home-hello" onClick={() => props.onPage("profil")}>
          <Avatar id={me.id} name={me.pseudo} avatar={me.avatar} className="avatar-mini" />
          <span>
            Bonjour <b>{me.pseudo}</b>
          </span>
        </button>
        <p className="balance">
          {fmt(me.balance)} <small>crédits virtuels</small>
        </p>
        {!me.has_login && <SetPassword onSave={props.onSetPassword} />}
        <button type="button" className="btn primary home-play" onClick={() => props.onPage("salon")}>
          Jouer : aller au salon
        </button>
        <button type="button" className="btn home-tx" onClick={props.onTransactions}>
          Dépôt et retrait
        </button>
        {me.balance < STARTING_CREDITS && (
          <button type="button" className="btn" onClick={props.onReload} disabled={props.busy}>
            Recharger à {fmt(STARTING_CREDITS)} (prototype)
          </button>
        )}
        {me.is_admin && (
          <button type="button" className="btn home-admin" onClick={props.onAdmin}>
            Administration
          </button>
        )}
        <button type="button" className="btn ghost" onClick={props.onRules}>
          Règles du jeu
        </button>
      </div>
      <NavBar page="home" onPage={props.onPage} />
      {props.rules}
    </main>
  );
}

/** Formulaire de création : mise, places, table publique ou privée. */
function CreateTable({ me, onCreate, onClose }: { me: Me; onCreate: (stake: number, capacity: number, password: string | null) => Promise<void>; onClose: () => void }) {
  const [stake, setStake] = useState(() => (STAKES as readonly number[]).find((s) => s === 100 && me.balance >= requiredBalance(s)) ?? STAKES[0]);
  const [capacity, setCapacity] = useState(4);
  const [privee, setPrivee] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = privee && password ? checkTablePassword(password) : null;
  const ready = !privee || (!!password && !problem);
  return (
    <form
      className="tx-card salon-create"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        setError(null);
        try {
          await onCreate(stake, capacity, privee ? password : null);
        } catch (err) {
          setError(errText(err));
          setBusy(false);
        }
      }}
    >
      <h2>Créer une table</h2>
      <label>Type de table</label>
      <div className="seg">
        <button type="button" className={!privee ? "on" : ""} onClick={() => setPrivee(false)}>
          Publique
        </button>
        <button type="button" className={privee ? "on" : ""} onClick={() => setPrivee(true)}>
          🔒 Privée
        </button>
      </div>
      <p className="tx-hint">{privee ? "Seuls ceux qui ont le mot de passe peuvent s'asseoir." : "Tout le monde peut s'asseoir depuis le Salon."}</p>
      {privee && (
        <>
          <label htmlFor="table-pw">Mot de passe de la table</label>
          <input id="table-pw" type="text" autoComplete="off" maxLength={TABLE_PASSWORD_MAX} placeholder="Au moins 4 caractères" value={password} onChange={(e) => setPassword(e.target.value)} />
        </>
      )}
      <label htmlFor="stake">Mise</label>
      <select id="stake" value={stake} onChange={(e) => setStake(Number(e.target.value) as typeof stake)}>
        {STAKES.map((s) => (
          <option key={s} value={s} disabled={me.balance < requiredBalance(s)}>
            {fmt(s)} crédits {me.balance < requiredBalance(s) ? "(solde insuffisant)" : ""}
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
      {(problem || error) && <p className="error">{problem ?? error}</p>}
      <div className="row two">
        <button className="btn primary" disabled={busy || !ready}>
          Créer la table
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Une table du Salon, avec la saisie du mot de passe pour une table privée. */
function LobbyRow({ t, me, ask, onJoin }: { t: LobbyTable; me: Me; ask: boolean; onJoin: (code: string, password?: string) => Promise<void> }) {
  const [askPw, setAskPw] = useState(ask);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = t.players.some((p) => p.id === me.id);
  const full = t.players.length >= t.capacity;
  const poor = me.balance < requiredBalance(t.stake);
  const blocked = !mine && (full || poor);

  async function join(pw?: string) {
    setBusy(true);
    setError(null);
    try {
      await onJoin(t.id, pw);
    } catch (e) {
      if (e instanceof ApiError && e.code === "table_password") setAskPw(true);
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <li className={`salon-table${t.isPrivate ? " private" : ""}`}>
      <div className="salon-top">
        <div className="salon-stake">
          <b>{fmt(t.stake)}</b>
          <small>mise</small>
        </div>
        <div className="salon-info">
          <p>
            <b>{t.isPrivate ? "🔒 Table privée" : "Table publique"}</b> <span className="muted">· {t.id}</span>
          </p>
          <p className="small muted">
            {t.host ? `Créée par ${t.host} · ` : ""}
            {t.status === "playing" ? "Manche en cours" : "En attente de joueurs"}
          </p>
        </div>
        <span className={`salon-seats${full ? " full" : ""}`}>
          {t.players.length}/{t.capacity}
        </span>
      </div>
      <div className="salon-bottom">
        <div className="salon-players">
          {t.players.map((p) => (
            <Avatar key={p.id} id={p.id} name={p.pseudo} avatar={p.avatar} className="avatar-mini salon-avatar" />
          ))}
          {Array.from({ length: Math.max(0, t.capacity - t.players.length) }, (_, i) => (
            <span key={`free${i}`} className="salon-free" aria-label="Place libre" />
          ))}
        </div>
        {!askPw && (
          <button
            type="button"
            className={`btn small${blocked ? "" : " primary"}`}
            disabled={busy || blocked}
            onClick={() => (mine || !t.isPrivate ? join() : setAskPw(true))}
          >
            {mine ? "Revenir" : full ? "Complète" : poor ? "Solde insuffisant" : "Rejoindre"}
          </button>
        )}
      </div>
      {askPw && !mine && (
        <form
          className="row tight salon-pw"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) void join(password);
          }}
        >
          <input type="text" autoComplete="off" aria-label="Mot de passe de la table" placeholder="Mot de passe de la table" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
          <button className="btn small primary" disabled={busy || !password}>
            Entrer
          </button>
        </form>
      )}
      {error && <p className="error small">{error}</p>}
    </li>
  );
}

/** Salon : toutes les tables ouvertes, création d'une table publique ou privée, accès par code. */
export function SalonPage(props: {
  token: string;
  me: Me;
  onMe: (me: Me) => void;
  onPage: (p: MainPage) => void;
  onCreate: (stake: number, capacity: number, password: string | null) => Promise<void>;
  onJoin: (code: string, password?: string) => Promise<void>;
  askCode: string | null;
}) {
  const { token, onMe } = props;
  const [tables, setTables] = useState<LobbyTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [filter, setFilter] = useState<"all" | "public" | "private">("all");
  const [code, setCode] = useState(props.askCode ?? "");
  const [codePw, setCodePw] = useState("");
  const [needPw, setNeedPw] = useState(!!props.askCode);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(props.askCode ? "Cette table est privée : saisis son mot de passe" : null);

  const load = useCallback(async () => {
    try {
      const r = await call<{ me: Me; tables: LobbyTable[] }>("lobby", { token });
      setTables(r.tables);
      onMe(r.me);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [token, onMe]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const shown = (tables ?? []).filter((t) => filter === "all" || (filter === "private") === t.isPrivate);

  return (
    <main className="screen page-screen">
      <div className="tx-screen">
        <PageHead title="Salon">
          <button type="button" className="tx-icon" aria-label="Actualiser" onClick={() => void load()}>
            ↻
          </button>
        </PageHead>
        {create ? (
          <CreateTable me={props.me} onCreate={props.onCreate} onClose={() => setCreate(false)} />
        ) : (
          <button type="button" className="btn primary salon-new" onClick={() => setCreate(true)}>
            + Créer une table
          </button>
        )}

        <section className="tx-card">
          <div className="salon-head">
            <h2>Tables ouvertes</h2>
            <div className="seg salon-filter">
              {(
                [
                  ["all", "Toutes"],
                  ["public", "Publiques"],
                  ["private", "Privées"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          {tables === null && !error && <p className="muted">Chargement…</p>}
          {tables !== null && shown.length === 0 && <p className="muted">Aucune table ouverte pour le moment. Crée la première !</p>}
          <ul className="salon-list">
            {shown.map((t) => (
              <LobbyRow key={t.id} t={t} me={props.me} ask={props.askCode === t.id} onJoin={props.onJoin} />
            ))}
          </ul>
        </section>

        <section className="tx-card">
          <h2>Rejoindre avec un code</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (code.trim().length < 5) return;
              setCodeBusy(true);
              setCodeError(null);
              try {
                await props.onJoin(code.trim().toUpperCase(), needPw ? codePw : undefined);
              } catch (err) {
                if (err instanceof ApiError && err.code === "table_password") setNeedPw(true);
                setCodeError(errText(err));
                setCodeBusy(false);
              }
            }}
          >
            <div className="row tight">
              <input placeholder="Code (ex. K7M2Q)" aria-label="Code de la table" value={code} maxLength={5} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              {!needPw && (
                <button className="btn" disabled={codeBusy || code.trim().length < 5}>
                  Rejoindre
                </button>
              )}
            </div>
            {needPw && (
              <div className="row tight">
                <input type="text" autoComplete="off" aria-label="Mot de passe de la table" placeholder="Mot de passe de la table" value={codePw} onChange={(e) => setCodePw(e.target.value)} />
                <button className="btn primary" disabled={codeBusy || code.trim().length < 5 || !codePw}>
                  Entrer
                </button>
              </div>
            )}
            {codeError && <p className="error">{codeError}</p>}
          </form>
        </section>
      </div>
      <NavBar page="salon" onPage={props.onPage} />
    </main>
  );
}

/** Profil : identité, mode de connexion, statistiques, avatar, mot de passe et déconnexion. */
export function ProfilePage(props: {
  token: string;
  me: Me;
  onMe: (me: Me) => void;
  onPage: (p: MainPage) => void;
  onTransactions: () => void;
  onAvatar: (choice: AvatarChoice) => Promise<void>;
  onSetPassword: (password: string) => Promise<void>;
  onChangePassword: (current: string, password: string) => Promise<void>;
  onLogout: () => void;
}) {
  const { token, me, onMe } = props;
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [changePw, setChangePw] = useState(false);
  const [logout, setLogout] = useState(false);

  useEffect(() => {
    call<{ me: Me; profile: ProfileData }>("profile", { token })
      .then((r) => {
        setProfile(r.profile);
        onMe(r.me);
      })
      .catch((e) => setError(errText(e)));
  }, [token, onMe]);

  const login = me.auth_provider === "google" ? "Gmail" : me.auth_provider === "facebook" ? "Facebook" : me.has_login ? "Pseudo et mot de passe" : "Aucun (choisis un mot de passe)";
  const winRate = profile && profile.rounds > 0 ? Math.round((100 * profile.wins) / profile.rounds) : null;
  const net = profile ? profile.gained - profile.lost : 0;

  return (
    <main className="screen page-screen">
      <div className="tx-screen">
        <PageHead title="Profil" />
        <section className="tx-card profile-card">
          <button type="button" className="profile-avatar profile-big" onClick={() => setPicker(true)} aria-label="Changer d'avatar">
            <Avatar id={me.id} name={me.pseudo} avatar={me.avatar} className="avatar-big" />
            <span className="profile-edit">✎</span>
          </button>
          <h2>{me.pseudo}</h2>
          {me.is_admin && <span className="profile-badge">Administrateur</span>}
          <dl className="profile-facts">
            <div>
              <dt>Solde</dt>
              <dd>{fmt(me.balance)} crédits</dd>
            </div>
            <div>
              <dt>Connexion</dt>
              <dd>{login}</dd>
            </div>
            <div>
              <dt>Membre depuis</dt>
              <dd>{profile ? dayFmt.format(new Date(profile.createdAt)) : "…"}</dd>
            </div>
          </dl>
        </section>

        <section className="tx-card">
          <h2>Statistiques</h2>
          {error && <p className="error">{error}</p>}
          <div className="profile-stats">
            <div>
              <b>{profile ? fmt(profile.rounds) : "…"}</b>
              <small>manches jouées</small>
            </div>
            <div>
              <b>{profile ? fmt(profile.wins) : "…"}</b>
              <small>manches gagnées</small>
            </div>
            <div>
              <b>{winRate === null ? "–" : `${winRate} %`}</b>
              <small>de victoires</small>
            </div>
            <div>
              <b className={net > 0 ? "up" : net < 0 ? "down" : ""}>{profile ? `${net > 0 ? "+" : ""}${fmt(net)}` : "…"}</b>
              <small>bilan des manches</small>
            </div>
          </div>
          {profile && (
            <p className="small muted">
              Gagné : {fmt(profile.gained)} · Perdu : {fmt(profile.lost)} (après commission)
            </p>
          )}
        </section>

        <section className="tx-card profile-actions">
          <h2>Mon compte</h2>
          <button type="button" className="btn" onClick={props.onTransactions}>
            Dépôt et retrait
          </button>
          {!me.has_login && <SetPassword onSave={props.onSetPassword} />}
          {me.has_login &&
            !me.auth_provider &&
            (changePw ? (
              <ChangePassword onSave={props.onChangePassword} onClose={() => setChangePw(false)} />
            ) : (
              <button type="button" className="btn" onClick={() => setChangePw(true)}>
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
                    Ce compte n'a pas de mot de passe : une fois déconnecté, tu ne pourras plus revenir sur <b>{me.pseudo}</b> ni sur ses {fmt(me.balance)} crédits.
                    Choisis d'abord un mot de passe ci-dessus.
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
        </section>
      </div>
      <NavBar page="profil" onPage={props.onPage} />
      {picker && <AvatarPicker me={me} onSave={props.onAvatar} onClose={() => setPicker(false)} />}
    </main>
  );
}
