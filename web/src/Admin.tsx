import { useCallback, useEffect, useState } from "react";
import { PAYMENT_METHODS, STATUS_LABELS, checkPaymentAccount, methodInfo } from "@fapfap/engine";
import { type AdminTransaction, type PaymentAccount, call } from "./api.ts";

const fmt = (n: number) => n.toLocaleString("fr-FR");
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => dateFmt.format(new Date(iso)).replace(",", "");
type Tab = "attente" | "traitees" | "coordonnees";
/** Relecture automatique des demandes. */
const REFRESH_MS = 20_000;

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Page admin : valider ou refuser les dépôts et retraits, saisir les coordonnées de dépôt. */
export function Admin({ token, onBack }: { token: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("attente");
  const [pending, setPending] = useState<AdminTransaction[] | null>(null);
  const [done, setDone] = useState<AdminTransaction[]>([]);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call<{ pending: AdminTransaction[]; done: AdminTransaction[]; accounts: PaymentAccount[] }>("admin_list", { token });
    setPending(r.pending);
    setDone(r.done);
    setAccounts(r.accounts);
  }, [token]);

  useEffect(() => {
    load().catch((e) => setError(errText(e)));
    const id = setInterval(() => load().catch(() => undefined), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  async function decide(t: AdminTransaction, status: "validee" | "refusee") {
    setError(null);
    setNotice(null);
    try {
      await call("admin_close", { token, id: t.id, status });
      const verb = status === "validee" ? "validé" : "refusé";
      const who = t.player?.pseudo ?? "?";
      setNotice(`${t.kind === "depot" ? "Dépôt" : "Retrait"} de ${fmt(t.amount)} pour ${who} ${verb}.`);
    } catch (e) {
      setError(errText(e));
    }
    await load().catch((e) => setError(errText(e)));
  }

  const count = pending?.length ?? 0;
  return (
    <main className="screen tx-screen adm-screen">
      <header className="tx-head">
        <button type="button" className="tx-icon" aria-label="Retour" onClick={onBack}>
          ‹
        </button>
        <h1>Administration</h1>
        <button type="button" className="tx-icon adm-refresh" aria-label="Actualiser" onClick={() => load().catch((e) => setError(errText(e)))}>
          ↻
        </button>
      </header>

      <nav className="adm-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "attente"} className={tab === "attente" ? "on" : ""} onClick={() => setTab("attente")}>
          En attente {count > 0 && <span className="adm-count">{count}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === "traitees"} className={tab === "traitees" ? "on" : ""} onClick={() => setTab("traitees")}>
          Traitées
        </button>
        <button type="button" role="tab" aria-selected={tab === "coordonnees"} className={tab === "coordonnees" ? "on" : ""} onClick={() => setTab("coordonnees")}>
          Coordonnées
        </button>
      </nav>

      {notice && <p className="tx-done">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {tab === "attente" &&
        (pending === null ? (
          <p className="muted small">Chargement…</p>
        ) : pending.length === 0 ? (
          <section className="tx-card">
            <p className="muted">Aucune demande en attente.</p>
          </section>
        ) : (
          pending.map((t) => <PendingCard key={t.id} t={t} onDecide={(s) => decide(t, s)} />)
        ))}

      {tab === "traitees" && (
        <section className="tx-card tx-recent">
          <h2>50 dernières demandes traitées</h2>
          {done.length === 0 ? (
            <p className="muted small">Rien pour le moment.</p>
          ) : (
            <ul className="tx-list">
              {done.map((t) => (
                <li key={t.id}>
                  <div className="tx-main">
                    <b>
                      {t.player?.pseudo ?? "?"} · {t.kind === "depot" ? "Dépôt" : "Retrait"} · {methodInfo(t.method)?.label}
                    </b>
                    <span className="tx-date">
                      Demandé {when(t.created_at)}
                      {t.processed_at && ` · traité ${when(t.processed_at)}`}
                    </span>
                    {(t.reference || t.account) && <span className="tx-ref">{t.reference ?? t.account}</span>}
                  </div>
                  <span className="tx-amt">{fmt(t.amount)}</span>
                  <span className={`tx-status ${t.status}`}>{STATUS_LABELS[t.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "coordonnees" && (
        <Accounts
          key={accounts.map((a) => `${a.method}:${a.account}:${a.ussd}:${a.note}`).join("|")}
          accounts={accounts}
          onSave={async (rows) => {
            setError(null);
            setNotice(null);
            await call("admin_accounts", { token, accounts: rows });
            setAccounts(rows);
            setNotice("Coordonnées enregistrées. Les joueurs les voient à l'étape Transfert du dépôt.");
          }}
        />
      )}
    </main>
  );
}

function PendingCard({ t, onDecide }: { t: AdminTransaction; onDecide: (s: "validee" | "refusee") => Promise<void> }) {
  const [confirm, setConfirm] = useState<"validee" | "refusee" | null>(null);
  const [busy, setBusy] = useState(false);
  const depot = t.kind === "depot";
  async function go(s: "validee" | "refusee") {
    setBusy(true);
    await onDecide(s);
    setBusy(false);
    setConfirm(null);
  }
  return (
    <section className={`tx-card adm-card ${t.kind}`}>
      <div className="adm-top">
        <span className={`adm-kind ${t.kind}`}>{depot ? "↑ Dépôt" : "↓ Retrait"}</span>
        <span className="tx-date">{when(t.created_at)}</span>
      </div>
      <div className="adm-amount">{fmt(t.amount)}</div>
      <dl className="adm-info">
        <dt>Joueur</dt>
        <dd>
          <b>{t.player?.pseudo ?? "?"}</b> <span className="muted">(solde {fmt(t.player?.balance ?? 0)})</span>
        </dd>
        <dt>Moyen</dt>
        <dd>{methodInfo(t.method)?.label}</dd>
        <dt>{depot ? "Référence" : "Envoyer à"}</dt>
        <dd className="adm-ref">{(depot ? t.reference : t.account) ?? "?"}</dd>
      </dl>
      <p className="tx-hint adm-help">
        {depot
          ? "Vérifie que le transfert est bien arrivé avec cette référence avant de valider : le joueur sera crédité."
          : "Envoie d'abord l'argent au joueur, puis valide. Refuser lui rend le montant réservé."}
      </p>
      {confirm ? (
        <div className="adm-actions">
          <button type="button" className={`adm-btn ${confirm === "validee" ? "ok" : "ko"}`} disabled={busy} onClick={() => void go(confirm)}>
            {confirm === "validee" ? (depot ? "Confirmer : créditer le joueur" : "Confirmer : argent envoyé") : "Confirmer le refus"}
          </button>
          <button type="button" className="tx-back-btn" disabled={busy} onClick={() => setConfirm(null)}>
            Annuler
          </button>
        </div>
      ) : (
        <div className="adm-actions">
          <button type="button" className="adm-btn ok" onClick={() => setConfirm("validee")}>
            Valider
          </button>
          <button type="button" className="adm-btn ko" onClick={() => setConfirm("refusee")}>
            Refuser
          </button>
        </div>
      )}
    </section>
  );
}

function Accounts({ accounts, onSave }: { accounts: PaymentAccount[]; onSave: (rows: PaymentAccount[]) => Promise<void> }) {
  const [rows, setRows] = useState<PaymentAccount[]>(() =>
    PAYMENT_METHODS.map((m) => accounts.find((a) => a.method === m.id) ?? { method: m.id, account: "", ussd: "", note: "" }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, k: keyof Omit<PaymentAccount, "method">, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const problem = rows.map((r) => checkPaymentAccount(r)).find(Boolean) ?? null;

  return (
    <form
      className="tx-card tx-flow"
      onSubmit={async (e) => {
        e.preventDefault();
        if (problem) return;
        setBusy(true);
        setError(null);
        try {
          await onSave(rows);
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="tx-lead">Ce que les joueurs voient à l'étape « Transfert » d'un dépôt. Dans le code USSD, {"{montant}"} est remplacé par le montant du dépôt.</p>
      {rows.map((r, i) => {
        const info = methodInfo(r.method)!;
        return (
          <fieldset key={r.method} className="adm-fieldset">
            <legend>{info.label}</legend>
            <label htmlFor={`acc-${r.method}`}>{info.account === "email" ? "Adresse PayPal" : "Numéro de réception"}</label>
            <input
              id={`acc-${r.method}`}
              value={r.account}
              maxLength={120}
              placeholder={info.account === "email" ? "adresse@exemple.com" : "+237 6XX XX XX XX"}
              onChange={(e) => set(i, "account", e.target.value)}
            />
            {info.account === "phone" && (
              <>
                <label htmlFor={`ussd-${r.method}`}>Code USSD (facultatif)</label>
                <input
                  id={`ussd-${r.method}`}
                  value={r.ussd}
                  maxLength={60}
                  placeholder="*126*1*1*6XXXXXXXX*{montant}#"
                  onChange={(e) => set(i, "ussd", e.target.value)}
                />
              </>
            )}
            <label htmlFor={`note-${r.method}`}>Note pour les joueurs (facultatif)</label>
            <input id={`note-${r.method}`} value={r.note} maxLength={200} placeholder="Ex. nom du titulaire" onChange={(e) => set(i, "note", e.target.value)} />
          </fieldset>
        );
      })}
      {(problem || error) && <p className="error">{problem ?? error}</p>}
      <button className="tx-cta" disabled={busy || !!problem}>
        Enregistrer
      </button>
    </form>
  );
}
