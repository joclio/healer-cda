/**
 * Extract pull-relative SPELL_CAST_SUCCESS timelines for each encounter
 * from local combat logs. Prefers kill; else longest wipe.
 *
 * Usage: node scripts/extract-all-boss-timers.mjs <log...>
 */
import fs from "fs";
import readline from "readline";
import path from "path";

const logPaths = process.argv.slice(2);
if (logPaths.length === 0) {
  console.error("Usage: node scripts/extract-all-boss-timers.mjs <log>...");
  process.exit(1);
}

/** Known boss / add source name patterns per encounter. */
const SRC_BY_ENC = {
  3379: /Nymrissa/i,
  3420: /Sszorak/i,
  3421: /Twin Fang|Stonejaw|Venomjaw|Fang/i,
  3429: /Coiled Altar|Warlord|Spirit|Gloom/i,
  3445: /Sentinel|Entomb|Miasma|Stasis/i,
  3455: /Vashnik/i,
  3470: /Nek.?zali|Soulcoil/i,
  3492: /Ula.?tek|Gore Rattle|Spectral Coil|Doomscale|Malacrass/i,
  3497: /Explorer|Lost|Shell|Ascension/i,
};

const SKIP_SPELL =
  /Attack|Melee|Auto|Wild Thrash|Desperate Thrash|Coiled Fangstone/i;

function parseTs(line) {
  const m = line.match(/^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) return null;
  const [, mo, d, y, h, mi, s, ms] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

function splitFields(eventPart) {
  const fields = [];
  let cur = "";
  let inQ = false;
  for (const ch of eventPart) {
    if (ch === '"') {
      inQ = !inQ;
      cur += ch;
    } else if (ch === "," && !inQ) {
      fields.push(cur);
      cur = "";
    } else cur += ch;
  }
  fields.push(cur);
  return fields;
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** @type {Map<number, object[]>} */
const pullsByEnc = new Map();

async function scan(logPath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let current = null;
  for await (const line of rl) {
    if (line.includes("ENCOUNTER_START")) {
      const parts = line.split("  ")[1]?.split(",") ?? [];
      const id = Number(parts[1]);
      current = {
        id,
        name: parts[2]?.replaceAll('"', "") ?? "?",
        diff: Number(parts[3]),
        startMs: parseTs(line),
        file: path.basename(logPath),
        casts: [],
      };
    } else if (line.includes("ENCOUNTER_END") && current) {
      const parts = line.split("  ")[1]?.split(",") ?? [];
      if (Number(parts[1]) !== current.id) {
        current = null;
        continue;
      }
      current.success = Number(parts[5]) === 1;
      current.durationMs = Number(parts[6]);
      if (!pullsByEnc.has(current.id)) pullsByEnc.set(current.id, []);
      pullsByEnc.get(current.id).push(current);
      current = null;
    } else if (current && line.includes("SPELL_CAST_SUCCESS")) {
      const fields = splitFields(line.split("  ")[1] ?? "");
      const src = fields[2]?.replaceAll('"', "") ?? "";
      const pat = SRC_BY_ENC[current.id];
      if (pat && !pat.test(src)) continue;
      if (!pat && !/boss|npc/i.test(src)) {
        /* keep broad if unknown */
      }
      const spellId = Number(fields[9]);
      const spellName = fields[10]?.replaceAll('"', "") ?? "";
      if (!spellName || SKIP_SPELL.test(spellName)) continue;
      const t = parseTs(line);
      if (!t || !current.startMs) continue;
      current.casts.push({
        sec: (t - current.startMs) / 1000,
        spellId,
        spellName,
        src,
      });
    }
  }
}

for (const p of logPaths) await scan(p);

/** Deduplicate casts: same spellId within 3s → keep first. */
function dedupe(casts) {
  const out = [];
  for (const c of casts) {
    const prev = out.find(
      (x) => x.spellId === c.spellId && Math.abs(x.sec - c.sec) < 3,
    );
    if (!prev) out.push(c);
  }
  return out;
}

/** Cluster by name for a cleaner planner-style list (first of each wave). */
function summarize(casts) {
  return dedupe(casts).map((c) => ({
    time: fmt(c.sec),
    sec: Math.round(c.sec),
    spellId: c.spellId,
    spellName: c.spellName,
    src: c.src,
  }));
}

const report = {};
for (const [id, pulls] of [...pullsByEnc.entries()].sort((a, b) => a[0] - b[0])) {
  const kill = pulls
    .filter((p) => p.success)
    .sort((a, b) => a.durationMs - b.durationMs)[0];
  const best =
    kill ??
    [...pulls].sort((a, b) => b.durationMs - a.durationMs)[0];
  report[id] = {
    name: best.name,
    diff: best.diff,
    pulls: pulls.length,
    kills: pulls.filter((p) => p.success).length,
    used: best.success ? "kill" : "longest-wipe",
    durationSec: Math.round(best.durationMs / 1000),
    file: best.file,
    timeline: summarize(best.casts),
  };
}

const outPath = "scripts/extracted-timers.json";
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log("Wrote", outPath);

for (const [id, r] of Object.entries(report)) {
  console.log(
    `\n=== ${r.name} (${id}) · ${r.used} ${fmt(r.durationSec)} · ${r.file} ===`,
  );
  // Print unique ability first-casts only (collapse spam by name+~15s)
  const shown = [];
  for (const c of r.timeline) {
    const recent = shown.find(
      (s) =>
        s.spellName === c.spellName && Math.abs(s.sec - c.sec) < 12,
    );
    if (recent) continue;
    shown.push(c);
    console.log(`  ${c.time.padStart(5)}  ${c.spellName} (${c.spellId})`);
  }
}
