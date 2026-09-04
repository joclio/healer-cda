import fs from "fs";
import readline from "readline";

const logPath = process.argv[2];
const encounterId = Number(process.argv[3] ?? 3429);

const NAME_HINTS = [
  "Sever",
  "Dreadmarch",
  "Nightfall",
  "Guillotine",
  "Defilement",
  "Fangs",
  "Deluge",
  "Axegrinder",
  "Venomfang",
  "Gloombomb",
  "Soulbinding",
  "Spiritcackle",
  "Circling",
  "Caustic Waves",
  "Rage of the Shackled",
  "Mother",
  "Serpent",
  "Fury Unleashed",
  "Submerge",
  "Gore Rattle",
  "Thrash",
  "Spectral",
  "Virulent",
  "Call of the",
];

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

let current = null;
const finished = [];

const rl = readline.createInterface({
  input: fs.createReadStream(logPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  if (line.includes("ENCOUNTER_START")) {
    const parts = line.split("  ")[1]?.split(",") ?? [];
    current = {
      id: Number(parts[1]),
      name: parts[2]?.replaceAll('"', ""),
      startMs: parseTs(line),
      events: [],
    };
  } else if (line.includes("ENCOUNTER_END") && current) {
    const parts = line.split("  ")[1]?.split(",") ?? [];
    current.success = Number(parts[5]) === 1;
    current.durationMs = Number(parts[6]);
    if (current.id === encounterId) finished.push(current);
    current = null;
  } else if (current && current.id === encounterId) {
    if (
      !line.includes("SPELL_CAST_SUCCESS") &&
      !line.includes("SPELL_CAST_START")
    )
      continue;
    const fields = splitFields(line.split("  ")[1] ?? "");
    const spellName = fields[10]?.replaceAll('"', "") ?? "";
    if (!NAME_HINTS.some((h) => spellName.includes(h))) continue;
    const t = parseTs(line);
    if (!t || !current.startMs) continue;
    current.events.push({
      sec: (t - current.startMs) / 1000,
      event: fields[0],
      spellId: Number(fields[9]),
      spellName,
      src: fields[2]?.replaceAll('"', "") ?? "",
    });
  }
}

const best =
  finished.find((e) => e.success) ??
  [...finished].sort((a, b) => b.durationMs - a.durationMs)[0];

if (!best) {
  console.error("No encounter found");
  process.exit(1);
}

console.log(
  `${best.name} ${best.success ? "KILL" : "wipe"} ${(best.durationMs / 1000).toFixed(1)}s`,
);
console.log("time | event | id | name | source");

const byKey = new Map();
for (const e of best.events) {
  if (e.event !== "SPELL_CAST_SUCCESS" && e.event !== "SPELL_CAST_START")
    continue;
  // prefer SUCCESS; still show START if no success for that cast window
  const key = `${e.spellId}|${e.spellName}|${e.event}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(e.sec);
}

for (const e of best.events
  .filter((x) => x.event === "SPELL_CAST_SUCCESS" || x.event === "SPELL_CAST_START")
  .sort((a, b) => a.sec - b.sec)) {
  // dedupe START if SUCCESS within 3s
  if (e.event === "SPELL_CAST_START") {
    const hasSuccess = best.events.some(
      (o) =>
        o.event === "SPELL_CAST_SUCCESS" &&
        o.spellId === e.spellId &&
        Math.abs(o.sec - e.sec) < 8,
    );
    if (hasSuccess) continue;
  }
  console.log(
    `${fmt(e.sec).padStart(5)}  ${e.event.replace("SPELL_CAST_", "").padEnd(8)}  ${String(e.spellId).padEnd(8)}  ${e.spellName}  [${e.src}]`,
  );
}
