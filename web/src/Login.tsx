import { useEffect, useState } from "react";
import { PASSWORD_MIN, PSEUDO_MAX, checkPassword, checkPseudo } from "@fapfap/engine";
import { type LoginProvider, enabledProviders, startOAuth } from "./api.ts";

type Mode = "login" | "signup";

/**
 * Écran de connexion : compte pseudo + mot de passe (connexion ou création), Google (Gmail) ou Facebook.
 * Les boutons Google et Facebook ne sont actifs que si le fournisseur est activé dans Supabase.
 */
export function Welcome(props: {
  busy: boolean;
  error: string | null;
  hasInvite: boolean;
  onLogin: (pseudo: string, password: string) => void;
  onRegister: (pseudo: string, password: string) => void;
  onRules: () => void;
  rules: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [pseudo, setPseudo] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [providers, setProviders] = useState<Record<LoginProvider, boolean> | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    void enabledProviders().then(setProviders);
  }, []);

  const signup = mode === "signup";
  const problem = signup
    ? (pseudo && checkPseudo(pseudo)) || (password && checkPassword(password)) || (confirm && confirm !== password ? "Les deux mots de passe sont différents" : null)
    : null;
  const ready = signup ? !!pseudo && !!password && confirm === password && !problem : !!pseudo.trim() && !!password;

  async function oauth(p: LoginProvider) {
    setOauthError(null);
    try {
      await startOAuth(p);
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="screen center">
      <div className="panel login-panel">
        <h1 className="logo">
          FapFap <span>♣♦♥♠</span>
        </h1>
        <p className="muted">Prototype de test entre amis. Crédits virtuels, sans aucune valeur.</p>
        {props.hasInvite && <p className="notice">Tu as été invité à une table. Connecte-toi ou crée un compte pour la rejoindre.</p>}

        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={!signup} className={!signup ? "on" : ""} onClick={() => setMode("login")}>
            Se connecter
          </button>
          <button type="button" role="tab" aria-selected={signup} className={signup ? "on" : ""} onClick={() => setMode("signup")}>
            Créer un compte
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready || props.busy) return;
            if (signup) props.onRegister(pseudo.trim(), password);
            else props.onLogin(pseudo.trim(), password);
          }}
        >
          <label htmlFor="pseudo">Pseudo</label>
          <input id="pseudo" value={pseudo} maxLength={PSEUDO_MAX} autoComplete="username" onChange={(e) => setPseudo(e.target.value)} autoFocus />
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            value={password}
            autoComplete={signup ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signup && (
            <>
              <label htmlFor="confirm">Confirme le mot de passe</label>
              <input id="confirm" type="password" value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
              <p className="tx-hint">3 à {PSEUDO_MAX} caractères pour le pseudo, au moins {PASSWORD_MIN} pour le mot de passe.</p>
            </>
          )}
          {problem && <p className="error">{problem}</p>}
          <button className="btn primary" disabled={props.busy || !ready}>
            {signup ? "Créer mon compte" : "Se connecter"}
          </button>
        </form>
        {props.error && <p className="error">{props.error}</p>}

        <div className="login-or">
          <span>ou</span>
        </div>
        <button type="button" className="btn oauth google" disabled={!providers?.google} onClick={() => void oauth("google")}>
          <span className="oauth-logo" aria-hidden="true">
            G
          </span>
          Continuer avec Gmail
        </button>
        <button type="button" className="btn oauth facebook" disabled={!providers?.facebook} onClick={() => void oauth("facebook")}>
          <span className="oauth-logo" aria-hidden="true">
            f
          </span>
          Continuer avec Facebook
        </button>
        {providers && (!providers.google || !providers.facebook) && (
          <p className="tx-hint">
            {!providers.google && !providers.facebook ? "Gmail et Facebook" : !providers.google ? "Gmail" : "Facebook"} : bientôt disponible.
          </p>
        )}
        {oauthError && <p className="error">{oauthError}</p>}

        <button type="button" className="btn ghost" onClick={props.onRules}>
          Lire les règles
        </button>
      </div>
      {props.rules}
    </main>
  );
}

/** Comptes créés avant les mots de passe : choisir un mot de passe pour pouvoir se reconnecter. */
export function SetPassword({ onSave }: { onSave: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = password ? checkPassword(password) : null;
  return (
    <form
      className="secure-account"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!password || problem) return;
        setBusy(true);
        setError(null);
        try {
          await onSave(password);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <b>Choisis un mot de passe</b>
      <span className="small">Sans mot de passe, tu ne pourras pas revenir sur ce compte depuis un autre appareil ou après une déconnexion.</span>
      <input type="password" aria-label="Nouveau mot de passe" placeholder={`Au moins ${PASSWORD_MIN} caractères`} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {(problem || error) && <p className="error">{problem ?? error}</p>}
      <button className="btn primary" disabled={busy || !password || !!problem}>
        Enregistrer le mot de passe
      </button>
    </form>
  );
}
