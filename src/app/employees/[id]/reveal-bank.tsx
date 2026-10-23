"use client";

import { useState } from "react";

/** HR-only. The button is rendered only when the caller is HR; the
 *  endpoint re-checks the role. Every click writes a BANK_REVEAL audit row. */
export function RevealBank({ employeeId }: { employeeId: string }) {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="pt-2">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`/api/employees/${employeeId}/bank/reveal`, { method: "POST" });
            if (!res.ok) {
              setError(`Reveal failed (${res.status})`);
              return;
            }
            const d = await res.json();
            setResult(`${d.bank.accountNumber} — ${d.bank.accountHolderName}`);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
      >
        {busy ? "Revealing…" : "Reveal account (audited)"}
      </button>
      {result && <p className="mt-1 font-mono text-xs text-zinc-800">{result}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}