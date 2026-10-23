# HR System — Build Skill

Building a complete HR system. Use this skill whenever asked to build, extend, or
resume work on this system. It defines the scope, architecture, data model, business
rules and build order so the system can be built end to end without re-deciding basics.

---

## 1. Product scope

Five modules, one web application:

1. **Employee management** — employee details, salary, bank account, employment status.
2. **Timesheet** — every half-month a fresh timesheet is assigned to each employee to
   fill in their working hours; the system validates entries before a manager sees them.
3. **Leave management** — the time-off engine: policies, accruals, requests, approvals
   and balances.
4. **Salaries dashboard & payslip** — payroll summaries for managers/HR, and
   employee-facing payslips.
5. **Payroll engine** — computes gross salary, tax, contributions and net salary for a
   monthly pay run, feeding the dashboard and payslips.

### Roles

- **Employee** — views own profile, payslips, leave balance; enters own timesheet; requests leave. Never sees other employees' data.
- **Manager** — project allocation to their direct reports and set approved hours; approves timesheets and leave requests; able operate what Employee can do
- **HR Admin** — everything: manages employees, leave policies, payroll configuration, runs payroll for all, exports data.

Every feature must enforce role + ownership: an employee only reaches their own records; a manager only their direct reports; HR sees all.

### Period model (critical — two different rhythms)

- **Salary is paid monthly, in full** at the end of each calendar month. The payroll
  unit is the **PayMonth** (`year`, `month`): one payroll run and one payslip per
  employee per month, covering the whole month.
- **Timesheets are half-monthly.** Within each PayMonth there are **two time-entry
  periods** (a `TimesheetPeriod`): the 1st–15th and the 16th–last day. At the start
  of each half-month a new timesheet is assigned to every active employee to fill in.
  Each half-month timesheet is validated and approved **separately** as soon as that
  half-month closes — the manager does not wait for the month to end.
- So the pipeline per month is: two timesheets are entered and approved during the
  month, and at month-end the single payroll run consumes both approved half-month 
  timesheets (plus the month's leave and salary data)" — 
  contradicts "payroll does not consume timesheet hours at alls.

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

    ---

## 3. Module-by-module requirements

### 3.1 Employee management

Entity: **Employee**
- Personal: first name, last name, email (unique), phone, date of birth, gender,
  marital status, emergency contact (name, phone).
- Employment: employee number (auto-generated, format `EMP-0001`), department, job
  title, report-to (self-referential → manager), hire date, work email, location/office,
  **employment status**: `PROBATION | FULL_TIME | PART_TIME | CONTRACT | INTERN`.
- **Bank account** (1:1): bank name, account number, account holder name,
  currency, is-default. **Bank account fields are sensitive:
  encrypted at rest** (AES-256-GCM with the project's `ENCRYPTION_KEY`, never stored
  in plaintext) and masked in the UI (`****1234`); HR can reveal, employees see only
  the last 4 digits.

Rules:
- Terminated employees become read-only; history (payslips, timesheets) is preserved.
- A report-to must be an ACTIVE employee; no cycles allowed.
- HR can deactivate (terminate) but never hard-delete an employee with payroll history.

### 3.2 Timesheet

Entity: **TimesheetEntry** — one row = one employee × one half-month period × one activity or work category. Fields: period, employee, entry type (PROJECT_ACTIVITY | NON_PROJECT), project + activity (when project work), work category, hours per day grid, comment, status, manager decision.

Three ways an entry gets onto the grid (exactly as in the TPMS guide):

**Allocated project work** — activities the employee is allocated to are
auto-listed as rows when they open the period. The default work category is Project Work and must not be changed for these rows.

**Non-project work** — "New Entry → By Work Category": the employee picks a
non-project category (pre-sale, training, leave, …) and enters hours. Project-side categories are not selectable here.

**- Leave is recorded on the timesheet ONLY as a non-project work category —**
never on a project activity row. (TPMS hard rule; enforced server-side too.) Timesheet "Leave" hours are an operational record; the entitlement (balance, approval) still comes from the Leave module (§3.3) — a paid-leave request approved in the Leave module is what protects pay, and the two must reconcile (a timesheet Leave line on a day with no approved leave request is flagged on the manager view).

**- Per-entry comments** ("New Comment"): each entry row can carry a free-text
comment, editable until submission.

**- Autosave**: the screen warns unsaved changes on leave; "always save before
leave" — entries persist as DRAFT at any point.

UI — the interactive grid:
- One screen per half-month period (two tabs per month: 1st–15th, 16th–30/31st)
  showing **days as columns** (actual calendar dates of that half-month) and
  **projects as rows**.
- Click a cell → enter/edit decimal hours (0.5 increments, e.g. 3.5). Weekend/public
  holiday cells are disabled (configurable holiday list per company).
- Row totals (per project) and day totals (column sums) shown live; a grand total.

3.2.1 Public holidays vs employee leave (auto-sync rule)

These are two different things and the system must keep them separate:

  PUBLIC HOLIDAY (country/region)          EMPLOYEE LEAVE
  -------------------------------          ----------------

  Scope
    Whole company/region                     One employee

  Setup
    HR maintains a holiday calendar          Employee submits a request;
    per country/region + year (date +        manager (+ HR) approves
    name); it is auto-synced to the
    timesheet grid - holiday days appear
    shaded/disabled

  Entitlement
    Company-wide, no request needed,         Consumes the employee's balance
    never consumes a leave balance           per policy (section 3.3)

  Timesheet
    Employee CANNOT log hours on a           Approved-leave days are shown
    public holiday - the cells are           marked on the grid;
    disabled server-side and in the UI;      
    the day shows the holiday name on       
    the column header

  Pay
    Paid by default (no deduction);          Paid/unpaid per leave type
    worked holiday (if ALLOW_HOLIDAY_WORK 
    is true) is recorded but not paid 
    (no OT pay in this system). 

Notes:
- Holiday calendar is data (Holiday table: country/region code, year,
  date, name), HR-editable, and applies automatically to every employee
  in that region - no per-employee configuration, nothing for the
  employee to do.
- Server-side: any timesheet save containing hours on a holiday is
  rejected (or, if ALLOW_HOLIDAY_WORK is on, forced to the
  holiday-work treatment).
- Payroll: public holidays inside a period are part of
  calendarDaysInMonth for pro-ration but not workingDaysInMonth (so
  daily-rate treat them correctly).

**Assignment:** at the start of each half-month (the 1st and the 16th) the system
creates/assigns a fresh timesheet for each `ACTIVE`/`PROBATION` employee — they see it
as "to be filled". An employee who joins mid-half-month gets a timesheet for the
remaining days of that half-month. There is exactly one timesheet per employee per
half-month; if an employee is absent all month, the timesheet can be submitted empty
or skipped (config: `ALLOW_EMPTY_SUBMIT: true`).

Validation **server-side, before a manager ever sees it** (client-side checks are UX only):
- Hours per day ≥ 0, ≤ `maxHoursPerDay` (config, default 12); a day may be blank = 0.
- **Overtime rule:** "Hours above standardDailyHours (8) per day are recorded as OT for tracking only — they are not paid. Capped at maxOvertimePerDay (4) per day, rejected (not trimmed) beyond that."
- **Half-month total cap:** total hours in the period ≤ `maxHoursPerPeriod` (default
  176 for full-time; half of 352).
- No overlapping entries: one entry per employee × project × period.
- Entries only for periods ending within `maxBackDatedDays` (default 60) and only if
  the employee was employed during that period.
- Employee must **submit** the half-month timesheet; after submission it is locked
  (status `SUBMITTED`) until the manager acts.

Manager workflow:
- The half-month timesheet becomes actionable as soon as the half-month closes.
  Manager views their direct reports' submitted timesheets for that half-month, sees
  validation summary(incl. the flagged "leave logged without an approved request" cases), 
  and **approves** or **rejects with a comment** 
- Statuses: `DRAFT → SUBMITTED → APPROVED | REJECTED`; `APPROVED` is immutable
  (corrections = a HR-adjusted new entry, never an edit).

**Withdraw (TPMS rule)**: the employee may withdraw their own submitted timesheet only while it has NOT been approved — withdrawal requires a mandatory reason, the status returns to DRAFT, the employee adjusts, and re-submission is required. After approval there is no withdraw; corrections go through HR.

**Month-end rule (how the two rhythms meet):** when HR completes the monthly payroll
run, the system checks both half-month timesheets per employee:
- both APPROVED → both feed payroll" — same contradiction;
- either still `SUBMITTED`/`DRAFT`/`REJECTED` → the run **lists the missing approvals
  and completes with no pay impact from that half-month (payroll does not consume 
  timesheet hours at all — no OT pay) and the employee is flagged on the payroll summary. 
  Corrections to the run go via a supplementary run (§3.4).

### 3.3 Leave management (the time-off engine)

Entities:
- **LeaveType**: code (`ANNUAL | SICK | UNPAID `), name, request unit (hours),
  approval chain (`MANAGER | HR | MANAGER_THEN_HR`).
- **LeavePolicy**: annual entitlement (days/year) — default 14 for ANNUAL (placeholder, to confirm with company)
- **LeaveBalance**: Default placeholder: ANNUAL = 14 days/year entitlement
- **LeaveRequest**: employee, type, from date, to date (inclusive), unit/half-day
  flags, reason, status, approver decisions, timestamps.

Rules:
- **Request validation (server-side, before approval is possible):**
  - from ≤ to; unit matches the type's request unit;
  - request length ≤ `maxConsecutiveDays` (default 14 for annual);
  - notice ≥ the type's min notice days (warn, not block);
  - **balance check:** the request must not push the projected balance negative for a
    *paid* type (projected = available + accrued between now and from-date − already
    approved overlapping requests); unpaid types always pass;
  - no overlap with another approved/requested leave of any type;
  - employees only for periods when they were employed.
- **Approval:** request goes to the employee's manager (then HR, per chain). Approve /
  reject-with-comment / delegate to HR. A request is editable only while `PENDING`
  by its creator; after approval it is immutable — changes require cancel + new
  request. Cancel is allowed if the from-date is in the future and the type allows
  cancellation; it returns the balance.
- **Balances:** approving decreases available immediately; rejecting/cancelling
  restores it. The employee dashboard shows per-type: accrued / used / available /
  expiring.
- **Statuses:** `DRAFT | PENDING | APPROVED | REJECTED | CANCELLED`.
- The timesheet grid of a half-month shows approved-leave days marked (no hours
  entered for approved leave days; a paid-leave day counts as a full paid day in the
  month's payroll, see §3.4).

  ### 3.4 Payroll engine

Runs per **PayMonth × company** (HR triggers a run once a month; a run is a versioned
snapshot). One payslip per employee per run, covering the **full month**.

Pipeline, per employee in the month:
1. **Eligibility:** employed during the month (hire ≤ month end, not terminated
   before month start). Terminated mid-month → included for final pay, prorated.
2. **Base pay:** `baseMonthly` from the employee's current (or effective-dated) salary
   record. Joining or terminating mid-month → **pro-rate by employed days**:
   `baseMonthly × employedDays / calendarDaysInMonth`.
3. **Allowances & standing deductions** from the salary record: full month's amount
   (pro-rated by employed days alongside base when applicable).
4. **Overtime pay:no overtime pay.
5. **Leave:** approved paid-leave days in the month are already covered by base pay
   (no extra line); **unpaid leave days** deduct `dailyRate × unpaidDays` where
   `dailyRate = monthlyBase / workingDaysInMonth`.
6. **Gross salary** = base (pro-rated) + allowances - standing deductions −
   unpaid-leave deduction.
7. **Tax:** apply the tax regime (§3.5.1) to the **monthly gross** — the tax bands
   are defined per full-month gross.
8. **Contributions:** employee + employer portions, each `amount = min(gross, cap) ×
   rate` per the contribution scheme (§3.5.2); caps are **per month**, rounded per
   config.
9. **Net salary** = gross − employee tax − employee contributions.
10. **Bonus / one-off items:** HR can attach one-off lines (bonus, penalty, back pay)
    to a run with a code + amount; bonuses are taxable.
11. **Rounding:** every money computation in integer minor units; final HALF_UP
    rounding at the *total* line level only (not per line, to avoid cent drift).

**Run states:** `DRAFT` (editable one-offs) → `COMPLETED` (payslips generated,
locked) → `PUBLISHED` (visible to employees) / `VOIDED` (with reason; a new run
must be created, never a re-edit). A completed/published run can only be fixed by
a **supplementary run** for the same month (HR, with reason) that produces
corrected payslips; both stay visible with a "supersedes" link. This is the path 
for any post-completion correction (e.g. late leave data, salary error)..

**Idempotency:** one active (non-voided) run per PayMonth. Triggering a second run
for the same month with an existing non-voided run is rejected.

**Timing:** HR normally runs payroll right after month-end (both half-month
timesheets should be approved by then). The run can be triggered any time after the
month has fully passed; it cannot cover a month still in progress.

### 3.5 Configuration (data-driven, HR-editable)

All of the following live in a `PayrollConfig` table (one active row), editable by
HR in a settings screen. **These are the knobs that make the engine
jurisdiction-neutral; the values below are DEFAULTS to be confirmed with the
company, not legal advice:**

**3.5.1 Tax regime** — progressive bands applied to the **monthly gross**:
`[{ min, max, rate }]`, a placeholder table of 4–5 bands. Stored as data, so the
country's real table can be entered without a code change. Employee tax = sum over
bands of `(min(gross, band.max) − band.min) × band.rate` (clamped at 0).

**3.5.2 Contribution scheme** — list of `{ code, name, who: EMPLOYEE|EMPLOYER|BOTH,
rate, base: GROSS|BASE, capPerMonth, rounding }`, e.g. placeholder rows for
pension (employee 5% / employer 5%), medical (employee 1.5% / employer 1%),
unemployment. Cap is per month.

**3.5.3 Other:** `maxHoursPerDay: 12`, `standardDailyHours: 8`,
`maxOvertimePerDay: 4`, `maxHoursPerPeriod: 176` (per half-month),
`rounding: 'HALF_UP'`, `ALLOW_EMPTY_SUBMIT: true`, working-day calendar (weekends
Sat+Sun by default, public holidays list per year).

### 3.6 Salaries dashboard & payslip

**Dashboard (manager/HR):** for a selected **month** —
- Company/team totals: total gross, total employee tax, total employee contributions,
  total employer contributions, total net, headcount paid.
- Per-employee table: base, allowances, deductions, gross, tax, employee contributions, net. Expandable row →
  the line-item detail.
- Comparison vs previous month (Δ totals, flagged per-employee Δ > ±20%).
- Filters: department, employment status, search by name/number.
- Actions: run payroll (HR), view payslip, export CSV (HR/manager for their scope).

**Payslip (employee):** one payslip per employee × monthly payroll run, covering the
full month.
- Header: employee, month, employee number, bank (masked), run date.
- Earned lines: base (with pro-ration note if applicable), each allowance, bonus lines.
- Deduction lines: tax (band breakdown on expand), each employee contribution,
  standing deductions, unpaid leave.
- Totals: gross, total deductions, **net**, employer contributions (informational).
- PDF render (printable) + on-screen view. Visible to the employee only after the run
  is `PUBLISHED`; to HR/manager once `COMPLETED`.
- Employees see their own payslips only.

---

## 4. Data model (Prisma, summary)
Every table: `id` (ulid), `createdAt`, `updatedAt`. Soft delete only where the rules
require it (Employee).

---

## 5. Cross-cutting rules

- **Permissions** enforced in the API layer (middleware), not the UI: role → scope
  (self / direct-reports / all). Every query scoped.
- **Audit log** for: employee status changes, salary changes, bank changes, leave
  approvals, payroll runs (create/complete/publish/void), config changes.
- **No floats for money.** Integer minor units end to end.
- **Timezones:** store everything UTC; the UI shows the company timezone (config).
  Pay month and half-month day boundaries are the company timezone.
- **Validation layer:** zod schemas shared client/server; server re-validates always.
- **Errors:** consistent JSON error shape `{ status, title, errors? }`.
- **Testing:** payroll math (bands, pro-ration, caps, rounding)
  and leave accrual/balance projection get table-driven unit tests.
  Permission rules get API tests per role (test as the least-privileged role first —
  a suite that only signs in as admin passes with a broken ownership check).

---

## 6. Build order (milestones — each one ends in something runnable)

**M1 — Skeleton + auth + employees.**
Bootstrap Next.js + Prisma + SQLite. Auth (roles: employee/manager/HR). Employee
CRUD (HR) with salary, bank account (encrypted), status, audit log. Manager list view
scoped to direct reports. *Done when:* an HR user can create an employee with salary
+ bank account, a manager sees only their reports, bank fields are masked.

**M2 — Timesheet periods + timesheet.**
PayMonth + TimesheetPeriod generation (automatic half-month assignment per employee),
project codes, the day×project grid, server-side validation rules (§3.2), submit →
approve/reject flow, locking. *Done when:* an employee is assigned a fresh timesheet
on the 1st and on the 16th, enters and submits one, invalid entries are rejected
server-side, a manager approves it and it becomes immutable.

**M3 — Leave engine.**
Leave types + policies (HR config), accrual engine (monthly job + on-join pro-rata),
request validation (overlap, balance projection, notice), approval chain, balances
screen. *Done when:* an employee's balance accrues month to month, a request that
would go negative is rejected, approval decrements the balance, cancel restores it.

**M4 — Payroll engine.**
PayrollConfig (tax bands, contributions, other knobs), the monthly run pipeline
(§3.4) consuming both half-month approved timesheets, missing-approval handling,
run states + idempotency, supplementary runs. *Done when:* HR runs month-end payroll
and the per-employee lines match hand-computed expectations (unit-tested: pro-ration, 
band tax, contribution caps, rounding, missing-approval
flagging).

**M5 — Dashboard + payslip.**
Manager/HR dashboard (monthly) with totals, per-employee table, prev-month
comparison, CSV export. Payslip (screen + PDF), publish
flow, employee self-service. *Done when:* an employee sees their monthly payslip
after publish, the manager dashboard totals reconcile with the run, and a CSV export
matches the screen.

**M6 — Hardening.**
Permission API tests for every endpoint per role, edge cases (termination mid-month,
leave crossing the half-month boundary,
back-dated limits, empty timesheet), audit log completeness, final pass.

---

## 7. Acceptance checklist (run before calling it done)

- [ ] A fresh timesheet is assigned to every active employee at the start of each
      half-month (1st and 16th).
- [ ] Employee with terminated status is excluded from the month's run; a mid-month
      termination is prorated and produces a final payslip.
- [ ] A timesheet entry over the day/half-month/OT caps is rejected, not trimmed.
- [ ] A submitted timesheet cannot be edited; a rejected one returns to draft only
      while that half-month is still open.
- [ ] Month-end run with one half-month timesheet unapproved: completes and flags the employee;
      a supplementary run exists for any post-completion correction.
- [ ] Approving a leave with an insufficient projected balance is blocked server-side.
- [ ] Payroll tax on a monthly gross exactly on a band boundary is correct (test both
      sides).
- [ ] Two payroll runs for the same month cannot both be non-voided.
- [ ] An employee A cannot read employee B's payslip, timesheet or bank account —
      test signed in as the least-privileged role.
- [ ] Bank account fields: stored encrypted, masked in API responses for the employee,
      revealable by HR only.
- [ ] Every money value in the DB and API is integer minor units.
- [ ] Dashboard totals = sum of payslip nets (reconciliation query in a test).
- [ ] Payslip shows the single monthly net with no OT lines.

---