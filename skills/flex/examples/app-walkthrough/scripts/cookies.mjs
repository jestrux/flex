// A persona's login for Flex: print the browser cookies that sign this user in, as JSON ([{ name, value, domain, path }]).
// Port the e2e suite's own login here: its API login, its auth fixture, or its storageState file. Never hard-code a real
// person's password; use the suite's test users and its environment variables.
const who = process.argv[2] ?? "member";
const API = process.env.APP_API_URL ?? "http://localhost:8000";
const users = { member: { email: process.env.E2E_MEMBER_EMAIL ?? "member@example.test", password: process.env.E2E_MEMBER_PASSWORD ?? "" } };

const u = users[who];
if (!u) { console.error(`no persona "${who}"`); process.exit(1); }
const res = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(u) });
if (!res.ok) { console.error(`login failed for ${who}: ${res.status} (is the backend up on ${API}?)`); process.exit(1); }
const { token } = await res.json();
console.log(JSON.stringify([{ name: "session", value: token, domain: "localhost", path: "/" }]));
