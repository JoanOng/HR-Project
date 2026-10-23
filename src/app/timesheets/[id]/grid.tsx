"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Day = string; // ISO date
type Project = { id: string; code: string; name: string };
type Entry = {
  id: string | null;
  projectId: string | null;
  projectCode: string | null;
  workCategory: string | null;
  comment: string | null;
  hours: Record<string, number>;
};
type Cfg = {
  maxHoursPerDay: number;
  standardDailyHours: number;
  maxOvertimePerDay: number;
  maxHoursPerPeriod: number;
  allowEmptySubmit: boolean;
} | null;

type Period = {
  id: string;
  employeeNumber: string;
  start: string;
  end: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
};

export function TimesheetGrid(props: {
  period: Period;
  days: Day[];
  weekends: Day[];
  holidays: { date: string; name: string }[];
  projects: Project[];
  entries: Entry[];
  cfg: Cfg;
  leaveDays?: { from: Date | string; to: Date | string; days: number }[];
}) {
  const { period, days, weekends, holidays, projects, entries: initial, cfg, leaveDays } = props;
  const router = useRouter();
  const canEdit = period.status === "DRAFT" || period.status === "REJECTED";
//   const isReviewer = period.status === "SUBMITTED";

  const [rows, setRows] = useState<Entry[]>(initial);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [problems, setProblems] = useState<string[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekendSet = useMemo(() => new Set(weekends), [weekends]);
  const holidayMap = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);
  const disabledDays = useMemo(
    () => new Set([...weekends, ...holidays.map((h) => h.date)]),
    [weekends, holidays],
  );
  const leaveSet = useMemo(() => {
    const s = new Set<string>();
    if (!leaveDays) return s;
    const f = (x: Date | string) => (typeof x === "string" ? x.slice(0, 10) : x.toISOString().slice(0, 10));
    for (const lv of leaveDays) {
      const start = f(lv.from);
      const end = f(lv.to);
      let d = new Date(`${start}T00:00:00Z`);
      const endD = new Date(`${end}T00:00:00Z`);
      while (d <= endD) {
        s.add(d.toISOString().slice(0, 10));
        d = new Date(d.getTime() + 86400000);
      }
    }
    return s;
  }, [leaveDays]);

  // ------- totals -------
  const rowTotals = useMemo(
    () => rows.map((r) => Object.values(r.hours).reduce((a, b) => a + b, 0)),
    [rows],
  );
  const dayTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of days) m[d] = 0;
    for (const r of rows) for (const [d, h] of Object.entries(r.hours)) m[d] = (m[d] ?? 0) + h;
    return m;
  }, [rows, days]);
  const grandTotal = useMemo(
    () => Object.values(dayTotals).reduce((a, b) => a + b, 0),
    [dayTotals],
  );

  // ------- autosave (DRAFT only) -------
  const payload = useCallback(
    () =>
      rows.map((r) => ({
        projectId: r.projectId,
        workCategory: r.workCategory,
        comment: r.comment,
        hours: r.hours,
      })),
    [rows],
  );

  const autosave = useCallback(() => {
    if (!canEdit) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      try {
        const res = await fetch(`/api/timesheets/periods/${period.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: payload() }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setProblems(d.problems ?? [`save failed (${res.status})`]);
          setSaved("error");
          return;
        }
        setProblems(null);
        setSaved("saved");
      } catch {
        setProblems(["network error — not saved"]);
        setSaved("error");
      }
    }, 600);
  }, [canEdit, period.id, payload]);

  useEffect(() => {
    autosave();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [rows, autosave]);

  // ------- cell editing -------
  const bump = (rowIdx: number, day: Day, delta: number) => {
    if (disabledDays.has(day)) return;
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIdx) return r;
        const cur = r.hours[day] ?? 0;
        const next = Math.max(0, Math.min(cfg?.maxHoursPerDay ?? 12, Math.round((cur + delta) * 2) / 2));
        const hours = { ...r.hours };
        if (next === 0) delete hours[day];
        else hours[day] = next;
        return { ...r, hours };
      }),
    );
  };

  const setCell = (rowIdx: number, day: Day, value: number) => {
    if (disabledDays.has(day)) return;
    const snapped = Math.max(0, Math.round(value * 2) / 2);
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIdx) return r;
        const hours = { ...r.hours };
        if (snapped === 0) delete hours[day];
        else hours[day] = snapped;
        return { ...r, hours };
      }),
    );
  };

  const addNonProject = (category: string) => {
    const clean = category.trim().toUpperCase();
    if (!clean) return;
    if (rows.some((r) => r.workCategory === clean)) return;
    setRows((prev) => [...prev, { id: null, projectId: null, projectCode: null, workCategory: clean, comment: null, hours: {} }]);
  };

  const addProject = (project: Project) => {
    if (rows.some((r) => r.projectId === project.id)) return;
    setRows((prev) => [...prev, { id: null, projectId: project.id, projectCode: project.code, workCategory: null, comment: null, hours: {} }]);
  };

  // ------- actions -------
  const act = async (method: string, body?: unknown) => {
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/timesheets/periods/${period.id}${method === "REVIEW" ? "/review" : ""}`, {
        method: method === "REVIEW" ? "POST" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblems(d.problems ?? [d.title ?? `failed (${res.status})`]);
        return;
      }
      router.refresh();
      setBanner(
        method === "SUBMIT"
          ? "Submitted for approval."
          : method === "WITHDRAW"
            ? "Withdrawn — back to draft."
            : method === "APPROVE"
              ? "Approved — now immutable."
              : "Rejected — the employee can fix and resubmit.",
      );
    } finally {
      setBusy(false);
    }
  };

  const statusStyle: Record<string, string> = {
    DRAFT: "bg-zinc-100 text-zinc-700",
    SUBMITTED: "bg-amber-100 text-amber-800",
    APPROVED: "bg-green-100 text-green-700",
    REJECTED: "bg-red-100 text-red-700",
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Timesheet{" "}
          <span className="ml-1 font-mono text-base text-zinc-500">
            {period.employeeNumber} · {period.start} → {period.end}
          </span>
          <span className={`ml-2 rounded px-2 py-0.5 text-sm ${statusStyle[period.status]}`}>
            {period.status}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">
            {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "error" ? "Not saved" : ""}
          </span>
          <Link href="/timesheets" className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100">
            All timesheets
          </Link>
        </div>
      </div>

      {banner && <p className="mb-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800">{banner}</p>}
      {problems && (
        <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          <ul className="list-inside list-disc">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {/* action bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <select
              className="rounded border border-zinc-300 px-2 py-1 text-xs"
              defaultValue=""
              onChange={(e) => {
                const p = projects.find((x) => x.id === e.target.value);
                if (p) addProject(p);
              }}
            >
              <option value="" disabled>
                + add project row…
              </option>
              {projects
                .filter((p) => !rows.some((r) => r.projectId === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
            </select>
            <input
              className="rounded border border-zinc-300 px-2 py-1 text-xs"
              placeholder="+ non-project category (e.g. TRAINING)"
              onKeyDown={(e) => {
                if (e.key === "Enter") addNonProject((e.target as HTMLInputElement).value);
              }}
            />
          </>
        )}
        {period.status === "DRAFT" && (
          <button
            disabled={busy}
            onClick={() => act("SUBMIT")}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700"
          >
            Submit
          </button>
        )}
        {period.status === "SUBMITTED" && (
          <>
            <button
              disabled={busy}
              onClick={() => act("WITHDRAW", { action: "withdraw", reason: prompt("Reason for withdrawing?") ?? "" })}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
              title="Only your own submitted timesheets can be withdrawn"
            >
              Withdraw
            </button>
            <button
              disabled={busy}
              onClick={() => act("REVIEW", { decision: "APPROVED", comment: null })}
              className="rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-600"
            >
              Approve
            </button>
            <button
              disabled={busy}
              onClick={() => act("REVIEW", { decision: "REJECTED", comment: rejectComment || undefined })}
              className="rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-600"
            >
              Reject
            </button>
            <input
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="reject comment (required)"
              className="rounded border border-zinc-300 px-2 py-1 text-xs"
            />
          </>
        )}
      </div>

      {/* the grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-300 text-left text-zinc-600">
              <th className="sticky left-0 bg-white py-1 pr-2 align-bottom">Project / category</th>
              {days.map((d) => {
                const date = new Date(`${d}T00:00:00Z`);
                const isWknd = weekendSet.has(d);
                const hol = holidayMap.get(d);
                const isLeave = leaveSet.has(d) && !isWknd && !hol;
                const dayTotal = dayTotals[d] ?? 0;
                const ot = dayTotal - (cfg?.standardDailyHours ?? 8);
                const overOt = ot > (cfg?.maxOvertimePerDay ?? 4);
                return (
                  <th key={d} className={`px-1 py-1 text-center ${isWknd || hol ? "bg-zinc-100 text-zinc-400" : isLeave ? "bg-blue-100" : ""}`}>
                    <div>{date.toLocaleDateString("en-GB", { weekday: "short" })}</div>
                    <div className="font-mono">{d.slice(5)}</div>
                    {hol && <div className="text-[10px]">{hol}</div>}
                    {isLeave && <div className="text-[10px] font-semibold text-blue-700">LV</div>}
                    <div className={`mt-0.5 font-mono ${overOt ? "text-red-700" : ot > 0 ? "text-amber-700" : "text-zinc-500"}`}>
                      {dayTotal || "·"}
                    </div>
                  </th>
                );
              })}
              <th className="px-2 py-1 text-right align-bottom">Row total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.projectId ?? r.workCategory ?? `row-${i}`} className="border-b border-zinc-200">
                <td className="sticky left-0 bg-white py-1 pr-2">
                  <span className="font-mono">{r.projectCode ?? r.workCategory}</span>
                </td>
                {days.map((d) => {
                  const disabled = disabledDays.has(d);
                  const v = r.hours[d] ?? 0;
                  return (
                    <td key={d} className={`px-1 py-1 text-center ${disabled ? "bg-zinc-100" : ""}`}>
                      {disabled ? (
                        <span className="text-zinc-300">—</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={cfg?.maxHoursPerDay ?? 12}
                          step={0.5}
                          value={v || ""}
                          disabled={!canEdit}
                          onChange={(e) => setCell(i, d, Number(e.target.value))}
                          className="h-7 w-12 rounded border border-zinc-200 px-1 text-center font-mono disabled:bg-zinc-50"
                        />
                      )}
                    </td>
                  );
                })}
                <td
                  className={`px-2 py-1 text-right font-mono ${
                    (cfg && rowTotals[i] > cfg.maxHoursPerPeriod) ? "text-red-700" : "text-zinc-700"
                  }`}
                >
                  {rowTotals[i] || "·"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={days.length + 2} className="py-6 text-center text-zinc-500">
                  No rows yet. Add a project or a non-project category above.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-400 bg-blue-50 font-semibold">
              <td className="sticky left-0 bg-white py-1 pr-2">Day total</td>
              {days.map((d) => {
                const v = dayTotals[d] ?? 0;
                const ot = v - (cfg?.standardDailyHours ?? 8);
                const overOt = ot > (cfg?.maxOvertimePerDay ?? 4);
                return (
                  <td key={d} className={`px-1 py-1 text-center font-mono ${disabledDays.has(d) ? "bg-zinc-100 text-zinc-400" : overOt ? "text-red-700" : ot > 0 ? "text-amber-700" : ""}`}>
                    {v || "·"}
                  </td>
                );
              })}
              <td className={`px-2 py-1 text-right font-mono ${cfg && grandTotal > cfg.maxHoursPerPeriod ? "text-red-700" : ""}`}>
                {grandTotal || "·"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-zinc-500">
        Grey cells are weekends{holidays.length ? " or public holidays" : ""} — hours cannot be recorded there.
        Blue “LV” days are approved leave — still editable, so a half-day leave lets you log the working half.
        OT above {cfg?.standardDailyHours ?? 8}h is shown in amber; over the {cfg?.maxOvertimePerDay ?? 4}h cap in red.
      </p>
    </div>
  );
}

// the grid from a server component, so wrap it there instead.
export function GridWithSuspense(props: Parameters<typeof TimesheetGrid>[0]) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <TimesheetGrid {...props} />
    </Suspense>
  );
}