"use client";

import { useState } from "react";

type Type = { code: string; name: string; entitlement: number | null; used: number; available: number | null };
type Req = {
  id: string;
  employeeId: string;
  employeeNumber: string;
  typeName: string;
  from: string;
  to: string;
  days: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
};

/**
 * Left-hand panel of /leave: the new-request form (employees) and the
 * approve/reject/cancel buttons (manager / HR). Actions call the API,
 * then revalidate the server component.
 */
export function LeaveActions(props: {
  canRequest: boolean;
  canDecide: boolean;
  types: Type[];
  requests: Req[];
}) {
  const { canRequest, canDecide, types, requests } = props;
  const router = useRouterLazy();

  // new request form
  const [typeCode, setTypeCode] = useState(types[0]?.code ?? "ANNUAL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // decide
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typeCode, from, to, days, reason }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, text: (d.problems ?? [d.title ?? `failed (${res.status})`]).join(" ") });
        return;
      }
      setResult({ ok: true, text: d.notice ? `Request created. ${d.notice}` : "Request created." });
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: "APPROVED" | "REJECTED", comment: string | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leave/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(d.title ?? `failed (${res.status})`);
        return;
      }
      setRejectingId(null);
      setRejectComment("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    const r = prompt("Reason for cancelling?");
    if (!r) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leave/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: r }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) alert(d.title ?? `failed (${res.status})`);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {canRequest && (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">New leave request</h2>
          <div className="space-y-2 text-sm">
            <select value={typeCode} onChange={(e) => setTypeCode(e.target.value)} className="w-full rounded border border-zinc-300 px-2 py-1.5">
              {types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                  {t.entitlement != null ? ` — ${t.available} left` : ""}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-zinc-500">
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="flex-1 text-xs text-zinc-500">
                To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm" />
              </label>
            </div>
            <label className="block text-xs text-zinc-500">
              Days (0.5 steps — a half day = same from/to with 0.5)
              <input type="number" min={0.5} step={0.5} value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-0.5 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="block text-xs text-zinc-500">
              Reason
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-0.5 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm" />
            </label>
            <button disabled={busy || !from || !to} onClick={submit} className="w-full rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50">
              {busy ? "Sending…" : "Request leave"}
            </button>
            {result && (
              <p className={result.ok ? "text-xs text-green-700" : "text-xs text-red-700"}>{result.text}</p>
            )}
          </div>
        </div>
      )}

      {canDecide && (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Decisions</h2>
          <p className="mb-2 text-xs text-zinc-500">
            Approve or reject the pending requests on the right. Rejections need a comment. Unpaid leave
            needs HR — managers get “HR approval required”.
          </p>
          <ul className="space-y-2 text-sm">
            {requests.filter((r) => r.status === "PENDING").map((r) => (
              <li key={r.id} className="rounded bg-zinc-50 p-2">
                <div className="mb-1 font-mono text-xs">
                  {r.employeeNumber} · {r.typeName} · {r.from.slice(0, 10)} → {r.to.slice(0, 10)} ({r.days}d)
                </div>
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => decide(r.id, "APPROVED", null)} className="rounded bg-green-700 px-2 py-1 text-xs text-white hover:bg-green-600">
                    Approve
                  </button>
                  {rejectingId === r.id ? (
                    <>
                      <input
                        autoFocus
                        value={rejectComment}
                        onChange={(e) => setRejectComment(e.target.value)}
                        placeholder="reason (required)"
                        className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs"
                      />
                      <button disabled={busy || !rejectComment.trim()} onClick={() => decide(r.id, "REJECTED", rejectComment)} className="rounded bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-600">
                        Confirm
                      </button>
                      <button onClick={() => setRejectingId(null)} className="rounded border border-zinc-300 px-2 py-1 text-xs">
                        Back
                      </button>
                    </>
                  ) : (
                    <button disabled={busy} onClick={() => setRejectingId(r.id)} className="rounded bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-600">
                      Reject
                    </button>
                  )}
                </div>
              </li>
            ))}
            {requests.filter((r) => r.status === "PENDING").length === 0 && (
              <li className="text-xs text-zinc-500">Nothing pending.</li>
            )}
          </ul>
        </div>
      )}

      {canRequest && (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Cancel a request</h2>
          <p className="mb-2 text-xs text-zinc-500">
            Pending requests can always be cancelled; approved ones only if they start in the future.
          </p>
          <ul className="space-y-2 text-sm">
            {requests
              .filter((r) => r.status === "PENDING" || (r.status === "APPROVED" && r.from.slice(0, 10) > today))
              .map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded bg-zinc-50 p-2">
                  <span className="font-mono text-xs">
                    {r.typeName} · {r.from.slice(0, 10)} → {r.to.slice(0, 10)} ({r.status})
                  </span>
                  <button disabled={busy} onClick={() => cancel(r.id)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                    Cancel
                  </button>
                </li>
              ))}
            {requests.filter((r) => r.status === "PENDING" || (r.status === "APPROVED" && r.from.slice(0, 10) > today)).length === 0 && (
              <li className="text-xs text-zinc-500">Nothing to cancel.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

import { useRouter } from "next/navigation";
function useRouterLazy() {
  return useRouter();
}