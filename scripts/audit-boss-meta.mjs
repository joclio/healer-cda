/**
 * Offline audit of boss JSON metadata (no WCL).
 * Flags soak-worded windows that won't auto-suggest personals.
 * Usage: node scripts/audit-boss-meta.mjs
 */
import fs from "fs";
import path from "path";

const soft = /soft\s*cd|raid\s*personals?/i;
const soak = /\bsoak/i;
const dir = "data/bosses";
const rows = [];

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const b = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const w of b.windows || []) {
    const text = `${w.note ?? ""} ${w.ability}`;
    if (soak.test(text) && !w.suggestPersonals && !soft.test(text)) {
      rows.push({
        file: f,
        id: w.id,
        timeSec: w.timeSec,
        severity: w.severity,
        category: w.category,
        ability: w.ability,
        note: (w.note ?? "").slice(0, 90),
      });
    }
  }
}

console.log("Soak notes without suggestPersonals / soft-CD wording:\n");
for (const r of rows) {
  console.log(
    `${r.file.padEnd(32)} ${r.id.padEnd(18)} ${String(r.severity).padEnd(9)} ${r.ability}`,
  );
  if (r.note) console.log(`  ${r.note}`);
}
console.log(`\ncount ${rows.length}`);

const comparePath = "scripts/wcl-boss-compare.json";
if (fs.existsSync(comparePath)) {
  const j = JSON.parse(fs.readFileSync(comparePath, "utf8"));
  console.log("\nTimer compare soft/DIFF (from last wcl-compare-bosses run):\n");
  let n = 0;
  for (const [id, b] of Object.entries(j)) {
    const diffs = (b.diffs || []).filter(
      (x) => x.status === "DIFF" || x.status === "~",
    );
    if (!diffs.length) continue;
    console.log(id);
    for (const d of diffs) {
      n++;
      console.log(
        `  [${d.status}] ${d.window.ability}  plan ${d.window.timeSec}s → WCL ${d.wclMedian}s (Δ${d.delta}s)`,
      );
    }
  }
  if (!n) console.log("(none)");
}
