// M2 piece-2 smoke probe. Run from hr_system:  node check-timesheet.mjs
// Logs in as Alice (employee) and Morgan (manager) against the dev server
// on :3000 and prints what each timesheet endpoint returns.
const BASE = "http://localhost:3000";

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: username, password }),
  });
  const setCookie = r.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : "";
  if (!cookie) {
    console.log(`  login ${username} FAILED status=${r.status}`);
    return null;
  }
  console.log(`  login ${username}: ${r.status}`);
  return cookie;
}

async function api(cookie, method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let pretty = text;
  try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
  console.log(`\n  ${method} ${path} -> ${r.status}\n${pretty.length > 600 ? pretty.slice(0, 600) + " …" : pretty}`);
  return r.status;
}

async function main() {
  console.log("== Alice (employee) ==");
  const alice = await login("alice@example.com", "Password123!");
  if (!alice) return;

  let s = await api(alice, "GET", "/api/timesheets/periods");
  // find Alice's current DRAFT period id
  const periods = JSON.parse(await (await fetch(`${BASE}/api/timesheets/periods`, {
    headers: { Cookie: alice },
  })).text()).periods;
  console.log(`\n  Alice sees ${periods.length} period(s):`);
  for (const p of periods) console.log(`    ${p.id}  ${p.start} → ${p.end}  ${p.status}`);
  const draft = periods.find((p) => p.status === "DRAFT");

  if (draft) {
    s = await api(alice, "GET", `/api/timesheets/periods/${draft.id}`);

    // find a weekday inside the period that's not a holiday and Alice was hired before
    const view = JSON.parse(await (await fetch(`${BASE}/api/timesheets/periods/${draft.id}`, {
      headers: { Cookie: alice },
    })).text());
    console.log(`\n  grid: ${view.days.length} days, projects: ${view.projects.map((p) => p.code).join(", ") || "(none)"}`);
    const weekday = view.days.find((d) => [1, 2, 3, 4, 5].includes(new Date(d + "T00:00:00Z").getUTCDay()));
    const prj = view.projects[0];
    if (weekday && prj) {
      // valid save: 8h on one weekday
      s = await api(alice, "PUT", `/api/timesheets/periods/${draft.id}`, {
        entries: [{ projectId: prj.id, workCategory: null, comment: null, hours: { [weekday]: 8 } }],
      });
      // invalid save: 20h in one day → must be 400 with problems
      s = await api(alice, "PUT", `/api/timesheets/periods/${draft.id}`, {
        entries: [{ projectId: prj.id, workCategory: null, comment: null, hours: { [weekday]: 20 } }],
      });
      // valid again (leave the good 8h in place)
      await api(alice, "PUT", `/api/timesheets/periods/${draft.id}`, {
        entries: [{ projectId: prj.id, workCategory: null, comment: null, hours: { [weekday]: 8 } }],
      });
      // submit → 200
      s = await api(alice, "POST", `/api/timesheets/periods/${draft.id}`, {});
      // save after submit → must be 409 LOCKED
      s = await api(alice, "PUT", `/api/timesheets/periods/${draft.id}`, {
        entries: [{ projectId: prj.id, workCategory: null, comment: null, hours: { [weekday]: 8 } }],
      });
      // withdraw (mandatory reason) → 200
      s = await api(alice, "POST", `/api/timesheets/periods/${draft.id}`, { action: "withdraw", reason: "forgot to add Tuesday" });
    }
  } else {
    console.log("\n  (no DRAFT period for Alice — did seed/assign-periods run?)");
  }

  console.log("\n== Morgan (manager) ==");
  const morgan = await login("manager@example.com", "Password123!");
  if (!morgan) return;
  // Morgan reviews Alice's draft: submit it again, then approve
  const mperiods = JSON.parse(await (await fetch(`${BASE}/api/timesheets/periods`, {
    headers: { Cookie: morgan },
  })).text()).periods;
  const alicePeriod = mperiods.find((p) => p.employeeNumber === "EMP-0002" && p.status === "DRAFT");
  if (alicePeriod) {
    const av = JSON.parse(await (await fetch(`${BASE}/api/timesheets/periods/${alicePeriod.id}`, {
      headers: { Cookie: morgan },
    })).text());
    const prj = av.projects[0];
    const weekday = av.days.find((d) => [1, 2, 3, 4, 5].includes(new Date(d + "T00:00:00Z").getUTCDay()));
    if (prj && weekday) {
      await api(morgan, "PUT", `/api/timesheets/periods/${alicePeriod.id}`, {
        entries: [{ projectId: prj.id, workCategory: null, comment: null, hours: { [weekday]: 8 } }],
      });
    }
    await api(morgan, "POST", `/api/timesheets/periods/${alicePeriod.id}`, {});
    // approve with no comment → 200
    s = await api(morgan, "POST", `/api/timesheets/periods/${alicePeriod.id}/review`, { decision: "APPROVED", comment: null });
    // save on the now-approved period → must be 409 IMMUTABLE
    if (prj && weekday) {
      s = await api(morgan, "PUT", `/api/timesheets/periods/${alicePeriod.id}`, {
        entries: [{ projectId: prj.id, workCategory: null, comment: null, hours: { [weekday]: 8 } }],
      });
    }
  } else {
    console.log("\n  (no DRAFT period for Alice visible to Morgan)");
  }

  console.log("\n== Cross-scope probe ==");
  // Bob asks for Alice's period id → must be 404, never 403
  const bob = await login("bob@example.com", "Password123!");
  if (bob && draft) {
    await api(bob, "GET", `/api/timesheets/periods/${draft.id}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });