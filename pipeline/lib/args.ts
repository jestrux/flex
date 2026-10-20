// CLI flags that survive `npm run`. Without a `--` separator npm swallows flags: `--dry` becomes
// npm_config_dry=true and a flag's value becomes a stray positional. On/off flags are honoured
// either way; a swallowed value flag stops with the exact command to type instead.
export function flags(script: string, valueFlags: string[] = [], boolFlags: string[] = []) {
  const a = process.argv.slice(2);
  for (const f of valueFlags) if (process.env[`npm_config_${f.replace(/-/g, "_")}`] && !a.includes(`--${f}`))
    throw new Error(`npm swallowed --${f} (write a -- before your flags): npm run ${script} -- ${a.join(" ")} --${f} <value>`);
  const get = (f: string) => { const i = a.indexOf(`--${f}`); return i >= 0 ? a[i + 1] : undefined; };
  const has = (f: string) => a.includes(`--${f}`) || process.env[`npm_config_${f.replace(/-/g, "_")}`] === "true";
  const taken = new Set<number>();
  a.forEach((x, i) => { if (x.startsWith("--")) { taken.add(i); if (valueFlags.includes(x.slice(2))) taken.add(i + 1); } });
  const positional = a.filter((_, i) => !taken.has(i));
  void boolFlags;
  return { get, has, positional };
}
