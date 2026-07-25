import { KeyRound, ShieldAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  ConsoleHeader,
  type ConsoleView
} from "../components/ConsoleHeader";

interface AdminAccessGateProps {
  notice?: { code: string; message: string };
  onNavigate(view: ConsoleView): void;
  onUnlock(apiKey: string): void;
}

export function AdminAccessGate({
  notice,
  onNavigate,
  onUnlock
}: AdminAccessGateProps) {
  const [apiKey, setApiKey] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = apiKey.trim();
    if (normalized) onUnlock(normalized);
  };

  return (
    <main className="app-shell">
      <ConsoleHeader activeView="orders" onNavigate={onNavigate} />
      <div className="access-gate-wrap">
        <section className="access-gate" aria-labelledby="access-heading">
          <div className="access-gate__icon" aria-hidden="true">
            <KeyRound size={20} />
          </div>
          <div className="access-gate__heading">
            <p className="section-kicker">Protected operations</p>
            <h2 id="access-heading">Administrator access</h2>
            <p>Enter the PoolMate Backend administrator API key.</p>
          </div>
          {notice ? (
            <div className="access-notice" role="alert">
              <ShieldAlert size={16} aria-hidden="true" />
              <div>
                <strong>{notice.message}</strong>
                <code>{notice.code}</code>
              </div>
            </div>
          ) : null}
          <form onSubmit={submit}>
            <label htmlFor="admin-api-key">Administrator API key</label>
            <div className="access-input-row">
              <input
                id="admin-api-key"
                type="password"
                autoComplete="current-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button type="submit" disabled={!apiKey.trim()}>
                Unlock orders
              </button>
            </div>
          </form>
          <p className="access-boundary">
            The key is kept in memory and this tab session only.
          </p>
        </section>
      </div>
    </main>
  );
}
