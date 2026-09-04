import { unpack } from "msgpackr";
import { readFileSync } from "node:fs";

const transcript = process.argv[2];
const line = readFileSync(transcript, "utf8")
  .split("\n")
  .find((l) => l.includes("g6ZhY3RvcnPcACG"));
if (!line) {
  console.error("export not found in transcript");
  process.exit(1);
}
const text = JSON.parse(line).message.content[0].text;
const m = text.match(/g6ZhY3RvcnP[A-Za-z0-9+/=]+/);
if (!m) {
  console.error("base64 not found");
  process.exit(1);
}
const data = unpack(Buffer.from(m[0], "base64"));

function fmt(sec) {
  const s = Math.round(Number(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const actors = data.actors ?? [];
console.log("=== Actors ===");
for (const a of actors) {
  console.log(
    String(a.name ?? "").padEnd(28),
    String(a.playerSpec ?? "").padEnd(24),
    `${(a.spells ?? []).length} casts`,
  );
}
console.log("\n=== Phases ===", JSON.stringify(data.phases));
console.log("\n=== Notes ===");
for (const n of data.notes ?? []) {
  console.log(fmt(n.startTime), n.noteText, n.actor ?? "");
}

const casts = [];
for (const a of actors) {
  for (const s of a.spells ?? []) {
    casts.push({
      t: s.startTime,
      spell: s.spell?.spellName,
      type: s.playerSpellType,
      actor: a.name,
      spec: a.playerSpec,
    });
  }
}
casts.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

const majorTypes =
  /Heal CD|Defensive|External|Raid DR|DPS CD|Raid Mobility|Immunit|Minor Heal|Potions|Healthpot/;
console.log("\n=== Timeline (major types) ===");
for (const c of casts) {
  if (c.t == null || !majorTypes.test(c.type ?? "")) continue;
  console.log(
    fmt(c.t).padStart(5),
    String(c.spell ?? "").padEnd(28),
    `[${c.type}]`,
    c.actor,
  );
}

// Healer major CDs only (cleaner view)
const healerSpecs =
  /Holy Priest|Holy Paladin|Restoration Druid|Preservation Evoker|Restoration Shaman|Mistweaver|Discipline/;
console.log("\n=== Healer CDs only ===");
for (const c of casts) {
  if (c.t == null) continue;
  if (!healerSpecs.test(c.spec ?? "")) continue;
  if (!/Heal CD|Defensive|External|Raid DR|Minor Heal/.test(c.type ?? "")) continue;
  console.log(
    fmt(c.t).padStart(5),
    String(c.spell ?? "").padEnd(28),
    `[${c.type}]`,
    c.actor,
  );
}

console.log(`\nTotal casts: ${casts.length}`);
console.log("Last cast:", fmt(casts.at(-1)?.t), casts.at(-1)?.spell);
