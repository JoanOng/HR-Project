"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RunRow = {
  id: string;
  year: number;
  month: number;
  status: "DRAFT" | "COMPLETED" | "PUBLISHED" | "VOIDED";
  preparedById: string;
  isSelfPrepared: boolean;
};

/**
 * Top of /payroll: the new-run form (past months only) and the
 * complete / publish / void buttons, gated by status and the
 * no-self-approve rule. Actions call the API, then revalidate.
 */
export function RunActions({ runs }: { runs: RunRow[] }) {
  const router = useRouter();
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [month, setMonth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

//   // months fully in the past (1-12)
//   const now = new Date();
//   const pastMonths: number[] = [];
//   const curY = now.getUTCFullYear();
//   const curM = now.getUTCMonth() + 1; // 1-12
//   for (let m = 12; m >= 1; m--) pastMonths.push(m); // same year
//   // previous years
//   for (let y = curY - 1; y >= curY - 2; y--) pastMonths.push(y * 100 + 12, y * 100 + 6, y * 100 + 1);
//   // simplify: build a flat list of {y, m}
//   const options: { y: number; m: number }[] = [];
//   for (let m = 12; m >= 1; m--) {
//     if (y === curY && m >= curM) continue;
//     options.push({ y: curY, m });
//   }

  // months fully in the past (last 36, most recent first)
  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1; // 1-12; the current month is NOT yet payable
  
  const monthOptions: { y: number; m: number; label: string }[] = [];
  for (let y = curY; y >= curY - 2; y--) {
    const maxM = y === curY ? curM - 1 : 12;
    for (let m = maxM; m >= 1; m--) {
      monthOptions.push({ y, m, label: `${y}-${String(m).padStart(2, "0")}` });
    }
  }

  async function act(runId: string, verb: "complete" | "publish" | "void", body?: object) {
    if (verb === "void") {
      const reason = prompt("Reason for voiding?");
      if (!reason) return;
      (body as { reason?: string }).reason = reason;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/payroll/runs/${runId}/${verb}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, text: d.error ?? `failed (${res.status})` });
        return;
      }
      setResult({ ok: true, text: `Run ${d.status}.` });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, text: d.error ?? `failed (${res.status})` });
        return;
      }
      setResult({ ok: true, text: `Run created for ${d.year}-${String(d.month).padStart(2, "0")} — ${d.employeeCount} employee(s).` });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // default month = last month
  const lastM = curM - 1 >= 1 ? curM - 1 : 12;
  const lastY = curM - 1 >= 1 ? curY : curY - 1;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        {/* new run */}
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">New payroll run</h2>
          <div className="space-y-2 text-sm">
            <p className="text-xs text-zinc-500">
              Only fully-past months. A month can have at most one non-voided run.
            </p>
            <div className="flex gap-2">
              <select value={`${lastY}-${String(lastM).padStart(2, "0")}`} onChange={(e) => {
                const [yy, mm] = e.target.value.split("-").map(Number);
                setYear(yy); setMonth(mm);
              }} className="flex-1 rounded border border-zinc-300 px-2 py-1.5">
                {monthOptions.map((o) => (
                  <option key={o.label} value={o.label}>{o.label}</option>
                ))}
              </select>
            </div>
            <button
              disabled={busy || month === 0}
              onClick={create}
              className="w-full rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {busy ? "Working…" : "Create run"}
            </button>
            {result && (
              <p className={result.ok ? "text-xs text-green-700" : "text-xs text-red-700"}>{result.text}</p>
            )}
          </div>
        </div>

        {/* actions */}
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Run actions</h2>
          <ul className="space-y-2 text-sm">
            {runs.filter((r) => r.status !== "VOIDED").map((r) => (
              <li key={r.id} className="rounded bg-zinc-50 p-2">
                <div className="mb-1 font-mono text-xs">
                  {r.year}-{String(r.month).padStart(2, "0")} · {r.status}
                  {r.isSelfPrepared && r.status === "DRAFT" && (
                    <span className="ml-1 text-amber-700">(you prepared — cannot complete)</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {r.status === "DRAFT" && !r.isSelfPrepared && (
                    <button disabled={busy} onClick={() => act(r.id, "complete")}
                      className="rounded bg-blue-700 px-2 py-1 text-xs text-white hover:bg-blue-600">
                      Complete
                    </button>
                  )}
                  {r.status === "COMPLETED" && (
                    <button disabled={busy} onClick={() => act(r.id, "publish")}
                      className="rounded bg-green-700 px-2 py-1 text-xs text-white hover:bg-green-600">
                      Publish
                    </button>
                  )}
                  {r.status !== "PUBLISHED" && (
                    <button disabled={busy} onClick={() => act(r.id, "void")}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                      Void
                    </button>
                  )}
                </div>
              </li>
            ))}
            {runs.filter((r) => r.status !== "VOIDED").length === 0 && (
              <li className="text-xs text-zinc-500">No active runs.</li>
            )}
          </ul>
        </div>
      </div>

      <div />
    </div>
  );
}