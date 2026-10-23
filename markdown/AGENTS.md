# AGENTS.md — Working Rules for This Repository

This repo builds a **complete HR system** (employee management, half-monthly
timesheets, leave engine, salaries dashboard & payslips, payroll engine).
The full specification lives in **`hr-system/SKILL.md`** — read it
before making any change, and treat it as the single source of truth for scope and
business rules. This file is the short rulebook; the skill file has the detail.

## The one rule that prevents the most bugs

**Two rhythms, do not confuse them:**
- **Timesheets are half-monthly.** A fresh timesheet is assigned to every active
  employee on the 1st and on the 16th; each half-month is validated and approved
  separately as soon as that half-month closes.
- **Payroll is monthly, in full.** One run per calendar month, one payslip per
  employee per month, covering BOTH half-months.
- Therefore: **never "÷ 2" a monthly salary.** Base pay, tax bands and contribution
  caps are monthly. The half-month split exists only in the timesheet grid. 
  Payroll is monthly and does not consume timesheet hours (no OT pay) — 
  unapproved half-months are flagged, not paid off.

## Non-negotiables

1. **Money is integer minor units** (cents/paise) end to end — no floats, no
   decimal strings in math. Rounding: HALF_UP at the total line only.
2. **Server-side validation is the validation.** Client checks are UX only. Over-cap
   values are *rejected*, never silently trimmed.
3. **Permissions are enforced in the API layer**, not the UI. Role → scope:
   employee = own records only, manager = direct reports, HR = all. Every query
   scoped. Test permissions as the *least-privileged* role first.
4. **Bank account fields are encrypted at rest** (AES-256-GCM, `ENCRYPTION_KEY`)
   and masked everywhere except an explicit HR reveal. Never log or return them in
   plaintext.
5. **Approved timesheets are immutable**; approved leave is immutable (cancel +
   re-request instead). Corrections to a completed payroll run happen only via a
   supplementary run — never by editing a run.
6. **Timesheets do not feed pay (no OT pay)**. A missing/late half-month approval 
    is flagged on the payroll summary; corrections to a run happen only via a 
    supplementary run — never by editing a run.
7. **Tax bands, contribution rates and the holiday calendar are data**
   (`PayrollConfig`), HR-editable in a settings UI. Never hard-code a jurisdiction's
   real rates in code; the skill's values are placeholders.
8. **Audit log** for: employee status/salary/bank changes, leave approvals, payroll
   run state changes, config changes.
9. **One active (non-voided) payroll run per month** — idempotency enforced.
10. Terminated employees: read-only, history preserved, excluded from future runs
    except a prorated final pay; never hard-deleted.

## Build order

Milestones M1–M6 in the skill file (§6), in order. Each milestone ends in something
runnable and demoable. Money/payroll code gets the strictest test coverage of
anything in this repo — a payroll bug is a compliance incident, not a cosmetic bug.

  ## 2. Tech stack

- **Framework:** Next.js (App Router) + React + TypeScript, one monorepo folder.
- **Server:** API routes (Route Handlers) for all writes; server components for reads
  where convenient.
- **Database:** Prisma with SQLite for local development (file `dev.db`). The schema is
  written to migrate cleanly to Postgres later (no SQLite-only features).
- **Money:** integer minor units (cents/paise) — never float.
- **Auth:** session-based (cookie)
- **Validation:** a schema layer (zod) shared by server and client.
- **Tests:** per-module unit tests for the business logic (payroll math, leave accrual,
  timesheet validation) + API tests for permission rules.

## Before calling work done

Run the acceptance checklist in the skill file (§7). At minimum:
- mid-month termination prorates and produces a final payslip;
- a run with an unapproved half-month flags the employee (no pay impact)
- tax at a band boundary tested on both sides;
- employee A cannot read employee B's payslip/timesheet/bank (test as the
  least-privileged role);
- dashboard totals reconcile with the sum of payslip nets.