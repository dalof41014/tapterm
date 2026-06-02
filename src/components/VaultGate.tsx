import { useState } from "react";
import { ArrowRight, KeyRound, ShieldCheck, TerminalSquare } from "lucide-react";
import { useStore } from "../store/useStore";
import { vaultInit, vaultInitNopass, vaultUnlock } from "../lib/api";

export function VaultGate() {
  const status = useStore((s) => s.status);
  const refreshStatus = useStore((s) => s.refreshStatus);
  const setNoPassword = useStore((s) => s.setNoPassword);
  const isNew = !status?.exists;

  const skip = async () => {
    setBusy(true);
    setError(null);
    try {
      await vaultInitNopass();
      setNoPassword(true);
      await refreshStatus();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isNew && pw !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (pw.length < 4) {
      setError("Use at least 4 characters");
      return;
    }
    setBusy(true);
    try {
      if (isNew) await vaultInit(pw);
      else await vaultUnlock(pw);
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface ring-1 ring-line-strong">
            <TerminalSquare size={32} className="text-accent" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isNew ? "Create your Vault" : "Unlock your Vault"}
          </h1>
          <p className="mt-2 max-w-xs text-sm text-content-muted">
            {isNew
              ? "Your hosts, keys and secrets are encrypted on this device with AES-256. Choose a master password."
              : "Enter your master password to decrypt your hosts and credentials."}
          </p>
        </div>

        <form onSubmit={submit} className="card p-6">
          <div className="mb-4">
            <label className="label">Master password</label>
            <div className="relative">
              <KeyRound
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-faint"
              />
              <input
                autoFocus
                type="password"
                className="input pl-9"
                placeholder="••••••••"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </div>
          </div>

          {isNew && (
            <div className="mb-4">
              <label className="label">Confirm password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            <ShieldCheck size={16} />
            {busy ? "Working…" : isNew ? "Create Vault" : "Unlock"}
          </button>
        </form>

        {isNew && (
          <button
            onClick={skip}
            disabled={busy}
            className="btn-ghost mt-3 w-full justify-center text-xs"
          >
            Skip — use without a master password
            <ArrowRight size={14} />
          </button>
        )}

        <p className="mt-4 text-center text-[11px] text-content-faint">
          End-to-end encrypted · Argon2id key derivation · stored locally
        </p>
      </div>
    </div>
  );
}
