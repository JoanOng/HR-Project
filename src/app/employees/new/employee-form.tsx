"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Manager = { id: string; name: string };

export function EmployeeForm() {
  const router = useRouter();
  const [managers, setManagers] = useState<Manager[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    department: "",
    jobTitle: "",
    hireDate: "",
    status: "FULL_TIME",
    reportToId: "",
    // salary (optional but encouraged)
    salaryEnabled: true,
    baseMonthly: "",
    effectiveFrom: "",
    // bank (optional)
    bankEnabled: false,
    bankName: "",
    accountNumber: "",
    accountHolderName: "",
    currency: "SGD",
  });

  useEffect(() => {
    // manager dropdown = everyone in scope (HR sees all)
    fetch("/api/employees")
      .then((r) => r.json())
      .then((d) =>
        setManagers(
          (d.rows as { id: string; firstName: string; lastName: string }[]).map((e) => ({
            id: e.id,
            name: `${e.firstName} ${e.lastName}`,
          })),
        ),
      )
      .catch(() => {});
  }, []);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // 1. the employee
      const empRes = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          dateOfBirth: form.dateOfBirth || undefined,
          department: form.department,
          jobTitle: form.jobTitle,
          hireDate: form.hireDate,
          status: form.status,
          reportToId: form.reportToId || undefined,
        }),
      });
      if (!empRes.ok) {
        const d = await empRes.json().catch(() => ({}));
        setError(d.title || `Employee create failed (${empRes.status})`);
        return;
      }
      const { employee } = await empRes.json();

      // 2. salary (only if the box is ticked)
      if (form.salaryEnabled && form.baseMonthly) {
        const salRes = await fetch(`/api/employees/${employee.id}/salary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseMonthly: form.baseMonthly,
            effectiveFrom: form.effectiveFrom || form.hireDate,
          }),
        });
        if (!salRes.ok) {
          const d = await salRes.json().catch(() => ({}));
          setError(`Employee created, but salary failed: ${d.title || salRes.status}`);
          return;
        }
      }

      // 3. bank (only if the box is ticked)
      if (form.bankEnabled && form.accountNumber) {
        const bankRes = await fetch(`/api/employees/${employee.id}/bank`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bankName: form.bankName,
            accountNumber: form.accountNumber,
            accountHolderName: form.accountHolderName,
            currency: form.currency,
          }),
        });
        if (!bankRes.ok) {
          const d = await bankRes.json().catch(() => ({}));
          setError(`Employee created, but bank failed: ${d.title || bankRes.status}`);
          return;
        }
      }

      router.push(`/employees/${employee.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full border border-zinc-300 rounded px-2 py-1.5 text-sm";
  const label = "block text-xs font-medium text-zinc-600 mb-1";

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700">Employee</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>First name *</label>
            <input className={input} required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </div>
          <div>
            <label className={label}>Last name *</label>
            <input className={input} required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </div>
          <div>
            <label className={label}>Email *</label>
            <input className={input} type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <label className={label}>Phone</label>
            <input className={input} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div>
            <label className={label}>Date of birth</label>
            <input className={input} type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
          </div>
          <div>
            <label className={label}>Department</label>
            <input className={input} value={form.department} onChange={(e) => set("department", e.target.value)} />
          </div>
          <div>
            <label className={label}>Job title</label>
            <input className={input} value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
          </div>
          <div>
            <label className={label}>Hire date *</label>
            <input className={input} type="date" required value={form.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
          </div>
          <div>
            <label className={label}>Status</label>
            <select className={input} value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="FULL_TIME">FULL_TIME</option>
              <option value="PART_TIME">PART_TIME</option>
              <option value="CONTRACT">CONTRACT</option>
              <option value="INTERN">INTERN</option>
            </select>
          </div>
          <div>
            <label className={label}>Reports to</label>
            <select className={input} value={form.reportToId} onChange={(e) => set("reportToId", e.target.value)}>
              <option value="">— none —</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded border border-zinc-200 p-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <input
            type="checkbox"
            checked={form.salaryEnabled}
            onChange={(e) => set("salaryEnabled", e.target.checked)}
          />
          Set salary
        </label>
        {form.salaryEnabled && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Base monthly (major units, ≤2 dp) *</label>
              <input
                className={input}
                required
                placeholder="4500.50"
                value={form.baseMonthly}
                onChange={(e) => set("baseMonthly", e.target.value)}
              />
            </div>
            <div>
              <label className={label}>Effective from (defaults to hire date)</label>
              <input className={input} type="date" value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded border border-zinc-200 p-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <input
            type="checkbox"
            checked={form.bankEnabled}
            onChange={(e) => set("bankEnabled", e.target.checked)}
          />
          Set bank account
        </label>
        {form.bankEnabled && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Bank name *</label>
              <input className={input} required value={form.bankName} onChange={(e) => set("bankName", e.target.value)} />
            </div>
            <div>
              <label className={label}>Account number * (6–20 letters/digits)</label>
              <input className={input} required value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} />
            </div>
            <div>
              <label className={label}>Account holder name *</label>
              <input className={input} required value={form.accountHolderName} onChange={(e) => set("accountHolderName", e.target.value)} />
            </div>
            <div>
              <label className={label}>Currency</label>
              <input className={input} maxLength={3} value={form.currency} onChange={(e) => set("currency", e.target.value)} />
            </div>
          </div>
        )}
      </section>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Create employee"}
        </button>
        <Link href="/employees" className="rounded border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100">
          Cancel
        </Link>
      </div>
    </form>
  );
}