import { useCallback, useEffect, useState } from "react";
import { ApiError, type Me, type TableView, call, finishOAuth, loadToken, saveToken } from "./api.ts";
import { Welcome } from "./Login.tsx";
import { Rules } from "./Rules.tsx";
import { HomePage, ProfilePage, SalonPage } from "./Pages.tsx";
import { Table } from "./Table.tsx";
import { Transactions } from "./Transactions.tsx";
import { Admin } from "./Admin.tsx";

type Page = "home" | "salon" | "profil" | "transactions" | "admin";

function pageFromUrl(): Page {
  for (const p of ["salon", "profil", "transactions", "admin"] as const) if (location.pathname.endsWith(`/${p}`)) return p;
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
  /** Invitation à une table privée : le Salon demande son mot de passe. */
  const [askCode, setAskCode] = useState<string | null>(null);
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
        try {
          const v = await call<TableView>(me.table_id === code ? "view" : "join", { token, code });
          setView(v);
          setInvite(v.table.id);
        } catch (e) {
          if (!(e instanceof ApiError && e.code === "table_password")) throw e;
          setAskCode(code);
          setInvite(null);
          setPage("salon");
          history.replaceState(null, "", "/salon");
        }
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

  const rules = showRules ? <Rules onClose={() => setShowRules(false)} /> : null;
  const sitDown = (v: TableView) => {
    setView(v);
    setMe(v.me);
    setInvite(v.table.id);
    setAskCode(null);
  };

  if (page === "salon") {
    return (
      <SalonPage
        token={token}
        me={me}
        onMe={setMe}
        onPage={openPage}
        askCode={askCode}
        onCreate={async (stake, capacity, password) => {
          sitDown(await call<TableView>("create", { token, stake, capacity, private: password !== null, password }));
        }}
        onJoin={async (code, password) => {
          sitDown(await call<TableView>("join", { token, code, password }));
        }}
      />
    );
  }

  if (page === "profil") {
    return (
      <ProfilePage
        token={token}
        me={me}
        onMe={setMe}
        onPage={openPage}
        onTransactions={() => openPage("transactions")}
        onAvatar={async (choice) => {
          const r = await call<{ me: Me }>("avatar", { token, ...choice });
          setMe(r.me);
        }}
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
      />
    );
  }

  return (
    <>
      <HomePage
        me={me}
        busy={busy}
        onPage={openPage}
        onTransactions={() => openPage("transactions")}
        onAdmin={() => openPage("admin")}
        onSetPassword={async (password) => {
          const r = await call<{ me: Me }>("set_password", { token, password });
          setMe(r.me);
        }}
        onReload={() =>
          run(async () => {
            const r = await call<{ me: Me }>("reload", { token });
            setMe(r.me);
          })
        }
        onRules={() => setShowRules(true)}
        rules={rules}
      />
      {error && <p className="error page-error">{error}</p>}
    </>
  );
}
