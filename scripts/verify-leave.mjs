// scripts/verify-leave.mjs — M3 done-when verification.
// Run against the dev server:  node scripts\verify-leave.mjs
// It creates real test requests — safe on a dev DB (re-seed wipes nothing, so run it last before M4).

const BASE = "http://localhost:3000";

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? "  →  " + extra : ""}`); }
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  const cookie = res.headers.getSetCookie()[0].split(";")[0];
  return { cookie };
}

async function api(s, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", cookie: s.cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* some errors are empty */ }
  return { status: res.status, json };
}

function day(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

const alice = await login("alice@example.com");
const morgan = await login("manager@example.com");
const bob = await login("bob@example.com");
const hr = await login("hr@example.com");

console.log("\n[1] View + balances");
const v1 = await api(alice, "GET", "/api/leave");
const annual = v1.json.types.find((t) => t.code === "ANNUAL");
const sick = v1.json.types.find((t) => t.code === "SICK");
const unpaid = v1.json.types.find((t) => t.code === "UNPAID");
check("alice GET /api/leave → 200", v1.status === 200, `got ${v1.status}`);
check("ANNUAL entitlement is 14", annual?.entitlement === 14, JSON.stringify(annual));
check("SICK entitlement is 20", sick?.entitlement === 20, JSON.stringify(sick));
check("UNPAID has no entitlement (unlimited)", unpaid?.entitlement === null, JSON.stringify(unpaid));
check("available never exceeds entitlement", annual.available <= 14 && sick.available <= 20);
const balanceBefore = annual.available;

console.log("\n[2] Create a valid request (1 day, 30 days out)");
const c1 = await api(alice, "POST", "/api/leave", {
  typeCode: "ANNUAL", from: day(30), to: day(30), days: 1, reason: "verify-leave valid",
});
check("valid request → 200 {ok}", c1.status === 200 && c1.json.ok === true, JSON.stringify(c1.json));

console.log("\n[3] Overlap rejected");
const c2 = await api(alice, "POST", "/api/leave", {
  typeCode: "SICK", from: day(30), to: day(30), days: 1, reason: "overlap any-type",
});
check("overlapping date, different type → 400", c2.status === 400, `got ${c2.status}`);
check("problem names the overlap", JSON.stringify(c2.json).toLowerCase().includes("overlap"), JSON.stringify(c2.json));

console.log("\n[4] Negative balance rejected");
const c3 = await api(alice, "POST", "/api/leave", {
  typeCode: "ANNUAL", from: day(60), to: day(79), days: 20, reason: "more than 14",
});
check("20-day ANNUAL request → 400", c3.status === 400, `got ${c3.status}`);
check("problem mentions balance", JSON.stringify(c3.json).toLowerCase().includes("balance"), JSON.stringify(c3.json));

console.log("\n[5] Approval decrements balance");
// find the id of our pending request in alice's view
const v2 = await api(alice, "GET", "/api/leave");
const reqId = v2.json.requests.find((r) => r.reason === "verify-leave valid")?.id;
check("our request is listed PENDING", reqId !== undefined && v2.json.requests.find((r) => r.id === reqId).status === "PENDING");
const a1 = await api(morgan, "POST", `/api/leave/${reqId}/decide`, { decision: "APPROVED" });
check("manager approve → 200", a1.status === 200, JSON.stringify(a1.json));
const v3 = await api(alice, "GET", "/api/leave");
check("balance dropped by exactly 1", v3.json.types.find((t) => t.code === "ANNUAL").available === balanceBefore - 1,
  `before=${balanceBefore} after=${v3.json.types.find((t) => t.code === "ANNUAL").available}`);

console.log("\n[6] Reject needs a comment");
const c4 = await api(alice, "POST", "/api/leave", {
  typeCode: "SICK", from: day(40), to: day(40), days: 1, reason: "verify-leave reject",
});
const reqId2 = (await api(alice, "GET", "/api/leave")).json.requests.find((r) => r.reason === "verify-leave reject")?.id;
const r1 = await api(morgan, "POST", `/api/leave/${reqId2}/decide`, { decision: "REJECTED" });
check("reject without comment → 400", r1.status === 400, `got ${r1.status}`);
const r2 = await api(morgan, "POST", `/api/leave/${reqId2}/decide`, { decision: "REJECTED", comment: "no, not that date" });
check("reject with comment → 200", r2.status === 200, JSON.stringify(r2.json));
const v4 = await api(alice, "GET", "/api/leave");
check("rejected request does not consume SICK balance", v4.json.types.find((t) => t.code === "SICK").available === sick.available,
  `expected ${sick.available}`);

console.log("\n[7] Cancel restores balance");
const cn = await api(alice, "POST", `/api/leave/${reqId}`, { reason: "plan changed" });
check("cancel own future APPROVED → 200", cn.status === 200, JSON.stringify(cn.json));
const v5 = await api(alice, "GET", "/api/leave");
check("ANNUAL balance restored", v5.json.types.find((t) => t.code === "ANNUAL").available === balanceBefore,
  `expected ${balanceBefore}`);

console.log("\n[8] Bob sees only his own (404, never 403)");
const vb = await api(bob, "GET", "/api/leave");
const seesAlice = vb.json.requests.some((r) => r.id === reqId || r.id === reqId2);
check("bob's list has no alice request", vb.status === 200 && !seesAlice);
const cross = await api(bob, "POST", `/api/leave/${reqId2}`, { reason: "sneaky cancel" });
check("bob cancels alice's request → 404 (not 403)", cross.status === 404, `got ${cross.status}`);

console.log("\n[9] UNPAID requires HR (MANAGER_THEN_HR chain)");
const c5 = await api(alice, "POST", "/api/leave", {
  typeCode: "UNPAID", from: day(50), to: day(51), days: 2, reason: "verify-leave unpaid",
});
check("UNPAID always creatable (no balance check)", c5.status === 200, JSON.stringify(c5.json));
const reqId3 = (await api(alice, "GET", "/api/leave")).json.requests.find((r) => r.reason === "verify-leave unpaid")?.id;
const m1 = await api(morgan, "POST", `/api/leave/${reqId3}/decide`, { decision: "APPROVED" });
check("manager approves UNPAID → 403", m1.status === 403, `got ${m1.status}`);
const h1 = await api(hr, "POST", `/api/leave/${reqId3}/decide`, { decision: "APPROVED" });
check("HR approves UNPAID → 200", h1.status === 200, JSON.stringify(h1.json));

console.log("\n[10] Short notice warns but does not block");
const c6 = await api(alice, "POST", "/api/leave", {
  typeCode: "ANNUAL", from: day(3), to: day(3), days: 1, reason: "verify-leave notice",
});
check("request 3 days out → 200 (not blocked)", c6.status === 200, `got ${c6.status}`);
check("response carries a notice warning", typeof c6.json.notice === "string" && c6.json.notice.length > 0, JSON.stringify(c6.json));

console.log(`\nResult: ${passed} passed, ${failed} failed`);
console.log("\nOne check remains MANUAL (the script can't click):");
console.log("  Open /timesheets/<a period covering an approved-leave day> as alice");
console.log("  → the day header should be light blue with an LV tag, cell still editable.");
process.exit(failed === 0 ? 0 : 1);