// Collect every "!" warning a run prints and repeat them at the end — they scroll past (or get
// grepped away) in long capture/render logs, and each one names a visible flaw.
const seen: string[] = [];
const warn = console.warn.bind(console);
console.warn = (...a: unknown[]) => { const s = a.map(String).join(" "); if (/^\s*!/.test(s) && !seen.includes(s.trim())) seen.push(s.trim()); warn(...a); };
export function recap(what: string) {
  if (!seen.length) { console.log(`\n✓ ${what}: no warnings`); return; }
  console.log(`\n── ${seen.length} warning(s) from this ${what} (each is a visible flaw or a timing miss — fix or knowingly accept) ──`);
  for (const s of seen) console.log(`  ${s}`);
}
