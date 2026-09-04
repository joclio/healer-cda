/**
 * Scan one or more combat logs for ENCOUNTER_START/END summary.
 * Usage: node scripts/scan-encounters.mjs [logPath...]
 */
import fs from "fs";
import readline from "readline";
import path from "path";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: node scripts/scan-encounters.mjs <log>...");
  process.exit(1);
}

function parseTs(line) {
  const m = line.match(/^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) return null;
  const [, mo, d, y, h, mi, s, ms] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

const byEncounter = new Map();

async function scan(logPath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(logPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let current = null;
  for await (const line of rl) {
    if (line.includes("ENCOUNTER_START")) {
      const parts = line.split("  ")[1]?.split(",") ?? [];
      current = {
        id: Number(parts[1]),
        name: parts[2]?.replaceAll('"', "") ?? "?",
        diff: Number(parts[3]),
        size: Number(parts[4]),
        startMs: parseTs(line),
        file: path.basename(logPath),
      };
    } else if (line.includes("ENCOUNTER_END") && current) {
      const parts = line.split("  ")[1]?.split(",") ?? [];
      const id = Number(parts[1]);
      if (id !== current.id) {
        current = null;
        continue;
      }
      const success = Number(parts[5]) === 1;
      const durationMs = Number(parts[6]);
      const key = `${current.id}|${current.diff}`;
      if (!byEncounter.has(key)) {
        byEncounter.set(key, {
          id: current.id,
          name: current.name,
          diff: current.diff,
          pulls: 0,
          kills: 0,
          bestDurationMs: 0,
          bestKillMs: null,
          files: new Set(),
        });
      }
      const e = byEncounter.get(key);
      e.pulls++;
      e.files.add(current.file);
      if (success) {
        e.kills++;
        if (e.bestKillMs == null || durationMs < e.bestKillMs) {
          e.bestKillMs = durationMs;
        }
      }
      if (durationMs > e.bestDurationMs) e.bestDurationMs = durationMs;
      current = null;
    }
  }
}

for (const p of paths) await scan(p);

function fmt(ms) {
  if (ms == null) return "—";
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, "0")}`;
}

const DIFF = { 14: "Normal", 15: "Heroic", 16: "Mythic", 17: "LFR" };

const rows = [...byEncounter.values()].sort((a, b) => a.id - b.id);
console.log(
  "encId".padStart(6),
  "diff".padEnd(8),
  "name".padEnd(28),
  "pulls".padStart(5),
  "kills".padStart(5),
  "longest".padStart(8),
  "fastKill".padStart(8),
  "files",
);
for (const e of rows) {
  console.log(
    String(e.id).padStart(6),
    (DIFF[e.diff] ?? String(e.diff)).padEnd(8),
    e.name.padEnd(28).slice(0, 28),
    String(e.pulls).padStart(5),
    String(e.kills).padStart(5),
    fmt(e.bestDurationMs).padStart(8),
    fmt(e.bestKillMs).padStart(8),
    [...e.files].join(","),
  );
}
