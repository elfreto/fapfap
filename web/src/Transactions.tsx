import { useCallback, useEffect, useState } from "react";
import {
  DEPOSIT_MAX,
  DEPOSIT_MIN,
  PAYMENT_METHODS,
  type PaymentMethod,
  STATUS_LABELS,
  WITHDRAW_MIN,
  checkAmount,
  checkRequest,
  methodInfo,
} from "@fapfap/engine";
import { type Me, type PaymentAccount, type Transaction, call } from "./api.ts";

const fmt = (n: number) => n.toLocaleString("fr-FR");
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
type View = "accueil" | "depot" | "retrait";

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Page Transactions : solde, boutons Dépôt et Retrait, demandes récentes (modèle fourni par LeCerf, sans IBAN). */
export function Transactions({ token, me, onMe, onBack }: { token: string; me: Me; onMe: (me: Me) => void; onBack: () => void }) {
  const [view, setView] = useState<View>("accueil");
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call<{ me: Me; transactions: Transaction[]; accounts: PaymentAccount[] }>("transactions", { token });
    setTxs(r.transactions);
    setAccounts(r.accounts);
    onMe(r.me);
  }, [token, onMe]);

  useEffect(() => {
    load().catch((e) => setError(errText(e)));
  }, [load]);

  function done(me: Me, tx: Transaction, message: string) {
    onMe(me);
    setTxs((t) => [tx, ...(t ?? [])]);
    setNotice(message);
    setView("accueil");
  }

  const title = view === "depot" ? "Demande de dépôt" : view === "retrait" ? "Demande de retrait" : "Transactions";
  return (
    <main className="screen tx-screen">
      <header className="tx-head">
        <button
          type="button"
          className="tx-icon"
          aria-label="Retour"
          onClick={() => {
            if (view === "accueil") onBack();
            else setView("accueil");
          }}
        >
          ‹
        </button>
        <h1>{title}</h1>
        {view === "accueil" && (
          <button type="button" className="tx-icon tx-plus" aria-label="Nouveau dépôt" onClick={() => setView("depot")}>
            +
          </button>
        )}
      </header>

      {view === "accueil" && (
        <Accueil
          me={me}
          txs={txs}
          error={error}
          notice={notice}
          onOpen={(v) => {
            setNotice(null);
            setView(v);
          }}
          onCancel={async (id) => {
            setError(null);
            try {
              const r = await call<{ me: Me }>("cancel_transaction", { token, id });
              onMe(r.me);
              setTxs((t) => (t ?? []).map((x) => (x.id === id ? { ...x, status: "annulee" } : x)));
            } catch (e) {
              setError(errText(e));
            }
          }}
        />
      )}
      {view === "depot" && (
        <Depot token={token} accounts={accounts} onDone={(m, tx) => done(m, tx, "Demande de dépôt envoyée. Ton compte sera crédité après vérification.")} />
      )}
      {view === "retrait" && (
        <Retrait token={token} me={me} onDone={(m, tx) => done(m, tx, "Demande de retrait envoyée. Le montant est réservé jusqu'au traitement.")} />
      )}
    </main>
  );
}

function Accueil({
  me,
  txs,
  error,
  notice,
  onOpen,
  onCancel,
}: {
  me: Me;
  txs: Transaction[] | null;
  error: string | null;
  notice: string | null;
  onOpen: (v: View) => void;
  onCancel: (id: number) => Promise<void>;
}) {
  const [hidden, setHidden] = useState(false);
  const reserved = (txs ?? []).filter((t) => t.kind === "retrait" && t.status === "en_attente").reduce((s, t) => s + t.amount, 0);
  return (
    <>
      <section className="tx-balance">
        <div className="tx-balance-label">
          Solde actuel
          <button type="button" className="tx-eye" aria-label={hidden ? "Afficher le solde" : "Masquer le solde"} onClick={() => setHidden(!hidden)}>
            {hidden ? "◡" : "◉"}
          </button>
        </div>
        <div className="tx-balance-value">
          {hidden ? "••••" : fmt(me.balance)}
          <span className="coin" />
        </div>
        <div className="tx-reserved">{reserved > 0 ? `${fmt(reserved)} réservés` : "crédits virtuels"}</div>
        <div className="tx-chips" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      {notice && <p className="tx-done">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="tx-actions">
        <button type="button" className="tx-action depot" onClick={() => onOpen("depot")}>
          <span className="tx-arrow">↑</span>
          <span>
            <b>Dépôt</b>
            <small>Ajouter des fonds</small>
          </span>
        </button>
        <button type="button" className="tx-action retrait" onClick={() => onOpen("retrait")}>
          <span className="tx-arrow">↓</span>
          <span>
            <b>Retrait</b>
            <small>Retirer des fonds</small>
          </span>
        </button>
      </div>

      <section className="tx-card tx-recent">
        <h2>Demandes récentes</h2>
        {txs === null ? (
          <p className="muted small">Chargement…</p>
        ) : txs.length === 0 ? (
          <p className="muted small">Aucune demande pour le moment.</p>
        ) : (
          <ul className="tx-list">
            {txs.map((t) => (
              <li key={t.id}>
                <div className="tx-main">
                  <b>
                    {t.kind === "depot" ? "Dépôt" : "Retrait"} · {methodInfo(t.method)?.label}
                  </b>
                  <span className="tx-date">{dateFmt.format(new Date(t.created_at)).replace(",", "")}</span>
                  {t.reference && <span className="tx-ref">{t.reference}</span>}
                  {t.status === "en_attente" && (
                    <button type="button" className="tx-cancel" onClick={() => void onCancel(t.id)}>
                      Annuler la demande
                    </button>
                  )}
                </div>
                <span className="tx-amt">{fmt(t.amount)}</span>
                <span className={`tx-status ${t.status}`}>{STATUS_LABELS[t.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="muted small tx-proto">Prototype : crédits virtuels, sans valeur.</p>
    </>
  );
}

function MethodPicker({ value, onChange }: { value: PaymentMethod | null; onChange: (m: PaymentMethod) => void }) {
  return (
    <div className="pm-grid">
      {PAYMENT_METHODS.map((m) => (
        <button key={m.id} type="button" className={`pm ${value === m.id ? "on" : ""}`} aria-pressed={value === m.id} onClick={() => onChange(m.id)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

function AmountInput({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      id={id}
      className="tx-amount"
      inputMode="numeric"
      placeholder="Ex. 5000"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
    />
  );
}

function Depot({ token, accounts, onDone }: { token: string; accounts: PaymentAccount[]; onDone: (me: Me, tx: Transaction) => void }) {
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(amount);
  const amountProblem = amount ? checkAmount("depot", value, 0) : null;
  const acc = accounts.find((a) => a.method === method);
  const ussd = acc?.ussd ? acc.ussd.replaceAll("{montant}", String(value)) : "";

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ me: Me; transaction: Transaction }>("deposit", { token, method, amount: value, reference });
      onDone(r.me, r.transaction);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tx-card tx-flow">
      <p className="tx-kicker">Ajouter des fonds</p>
      <h2>Demande de dépôt</h2>
      <ol className="tx-steps">
        {["Montant", "Moyen", "Transfert"].map((s, i) => (
          <li key={s} className={step >= i + 1 ? "on" : ""}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (amount && !amountProblem) setStep(2);
          }}
        >
          <p className="tx-lead">Indique le montant que tu souhaites ajouter à ton solde.</p>
          <label htmlFor="dep-amount">Montant en crédits</label>
          <AmountInput id="dep-amount" value={amount} onChange={setAmount} autoFocus />
          <p className="tx-hint">
            De {fmt(DEPOSIT_MIN)} à {fmt(DEPOSIT_MAX)}
          </p>
          {amountProblem && <p className="error">{amountProblem}</p>}
          <button className="tx-cta" disabled={!amount || !!amountProblem}>
            Continuer
          </button>
        </form>
      )}

      {step === 2 && (
        <>
          <p className="tx-lead">Choisis ton moyen de paiement.</p>
          <MethodPicker
            value={method}
            onChange={(m) => {
              setMethod(m);
              setStep(3);
            }}
          />
          <button type="button" className="tx-back-btn" onClick={() => setStep(1)}>
            ← Retour au montant
          </button>
        </>
      )}

      {step === 3 && method && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!checkRequest("depot", { method, amount: value, reference }, 0) && !busy) void confirm();
          }}
        >
          <div className="tx-transfer">
            {ussd ? (
              <>
                <span>Appuie pour composer le transfert {methodInfo(method)!.label}</span>
                <a href={`tel:${ussd.replaceAll("#", "%23")}`}>{ussd}</a>
              </>
            ) : acc?.account ? (
              <>
                <span>
                  Envoie {fmt(value)} par {methodInfo(method)!.label} à
                </span>
                <b>{acc.account}</b>
              </>
            ) : (
              <span>Les coordonnées {methodInfo(method)!.label} ne sont pas encore renseignées. Contacte l'organisateur.</span>
            )}
            {acc?.note && <small>{acc.note}</small>}
          </div>
          <p className="tx-lead">Après le transfert, saisis sa référence. Ton compte sera crédité après vérification.</p>
          <label htmlFor="dep-ref">Référence du transfert</label>
          <input id="dep-ref" placeholder="ID ou nom de l'envoi" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
          {error && <p className="error">{error}</p>}
          <button className="tx-cta" disabled={busy || !!checkRequest("depot", { method, amount: value, reference }, 0)}>
            Confirmer la demande
          </button>
          <button type="button" className="tx-back-btn" onClick={() => setStep(2)}>
            ← Changer de moyen
          </button>
        </form>
      )}
    </section>
  );
}

function Retrait({ token, me, onDone }: { token: string; me: Me; onDone: (me: Me, tx: Transaction) => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = Number(amount);
  const amountProblem = amount ? checkAmount("retrait", value, me.balance) : null;
  const problem = method ? checkRequest("retrait", { method, amount: value, account }, me.balance) : "Choisis un moyen de réception";
  const info = method ? methodInfo(method) : null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ me: Me; transaction: Transaction }>("withdraw", { token, method, amount: value, account });
      onDone(r.me, r.transaction);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="tx-card tx-flow"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && !busy) void confirm();
      }}
    >
      <p className="tx-kicker">Retirer des fonds</p>
      <h2>Demande de retrait</h2>
      <p className="tx-lead">Le montant sera bloqué jusqu'au traitement de ta demande.</p>
      <label htmlFor="ret-amount">Montant en crédits</label>
      <AmountInput id="ret-amount" value={amount} onChange={setAmount} />
      <div className="tx-row">
        <span>Solde retirable</span>
        <b>{fmt(me.balance)}</b>
      </div>
      <p className="tx-hint">Minimum {fmt(WITHDRAW_MIN)}</p>
      {amountProblem && <p className="error">{amountProblem}</p>}
      <label>Moyen de réception</label>
      <MethodPicker value={method} onChange={setMethod} />
      {info && (
        <>
          <label htmlFor="ret-account">{info.account === "phone" ? "Numéro de téléphone" : "Adresse PayPal"}</label>
          <input
            id="ret-account"
            type={info.account === "phone" ? "tel" : "email"}
            inputMode={info.account === "phone" ? "tel" : "email"}
            autoComplete={info.account === "phone" ? "tel" : "email"}
            placeholder={info.account === "phone" ? "+237…" : "adresse@exemple.com"}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button className="tx-cta" disabled={busy || !!problem}>
        Confirmer la demande
      </button>
    </form>
  );
}
