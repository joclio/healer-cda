/**
 * Extract Ula'tek boss ability casts from a combat log.
 * Aggregates across pulls; prefers longest / kill.
 */
import fs from "fs";
import readline from "readline";

const logPath = process.argv[2];
const ENCOUNTER_ID = 3492;

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

const BOSS_SRC = /Ula'?tek|Gore Rattle|Spectral Coil|Doomscale|Malacrass/i;

let current = null;
const finished = [];

const rl = readline.createInterface({
  input: fs.createReadStream(logPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  if (line.includes("ENCOUNTER_START")) {
    const parts = line.split("  ")[1]?.split(",") ?? [];
    if (Number(parts[1]) !== ENCOUNTER_ID) {
      current = null;
      continue;
    }
    current = {
      startMs: parseTs(line),
      casts: [],
      starts: [],
    };
  } else if (line.includes("ENCOUNTER_END") && current) {
    const parts = line.split("  ")[1]?.split(",") ?? [];
    current.success = Number(parts[5]) === 1;
    current.durationMs = Number(parts[6]);
    finished.push(current);
    current = null;
  } else if (current) {
    const isSuccess = line.includes("SPELL_CAST_SUCCESS");
    const isStart = line.includes("SPELL_CAST_START");
    if (!isSuccess && !isStart) continue;

    const fields = splitFields(line.split("  ")[1] ?? "");
    const src = fields[2]?.replaceAll('"', "") ?? "";
    if (!BOSS_SRC.test(src)) continue;

    const spellId = Number(fields[9]);
    const spellName = fields[10]?.replaceAll('"', "") ?? "";
    // skip junk / player-looking
    if (/Wild Thrash|Coiled Fangstone|Desperate Thrash/i.test(spellName))
      continue;

    const t = parseTs(line);
    if (!t || !current.startMs) continue;
    const sec = (t - current.startMs) / 1000;
    const row = { sec, spellId, spellName, src };
    if (isSuccess) current.casts.push(row);
    else current.starts.push(row);
  }
}

const best =
  finished.find((e) => e.success) ??
  [...finished].sort((a, b) => b.durationMs - a.durationMs)[0];

console.log(
  JSON.stringify(
    {
      pulls: finished.length,
      best: {
        success: best.success,
        durationSec: +(best.durationMs / 1000).toFixed(1),
      },
      casts: best.casts.map((c) => ({
        time: fmt(c.sec),
        sec: +c.sec.toFixed(1),
        spellId: c.spellId,
        spellName: c.spellName,
        src: c.src,
      })),
      startsOnly: best.starts
        .filter(
          (s) =>
            !best.casts.some(
              (c) => c.spellId === s.spellId && Math.abs(c.sec - s.sec) < 10,
            ),
        )
        .map((c) => ({
          time: fmt(c.sec),
          sec: +c.sec.toFixed(1),
          spellId: c.spellId,
          spellName: c.spellName,
          src: c.src,
        })),
    },
    null,
    2,
  ),
);
