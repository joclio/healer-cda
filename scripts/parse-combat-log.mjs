/**
 * Stream a WoW combat log and print pull-relative cast times for key boss spells.
 * Usage: node scripts/parse-combat-log.mjs <logPath>
 */
import fs from "fs";
import readline from "readline";

const logPath = process.argv[2];
if (!logPath) {
  console.error("Usage: node scripts/parse-combat-log.mjs <logPath>");
  process.exit(1);
}

const TRACK = new Map([
  // Coiled Altar
  [1282487, "Fangs of the Coiled Altar"],
  [1299960, "Toxic Deluge"],
  [1283489, "Guillotine"],
  [1299680, "Sever"],
  [1282281, "Venomfang"],
  [1283832, "Axegrinder"],
  [1289900, "Dreadmarch"],
  [1286918, "Eternal Nightfall"],
  [1286895, "Gloombomb"],
  [1286573, "Soul Sever"],
  [1286441, "Spiritcackle"],
  [1298381, "Defilement of the Coiled Altar"],
  [1299266, "Grim Guillotine"],
  [1307279, "Blighted Sever"],
  // Ula'tek
  [1292188, "Caustic Waves"],
  [1300751, "Call of the Serpent"],
  [1298367, "Mother's Wrath"],
  [1298559, "Gore Rattle"],
  [1296301, "Mephitic Thrash"],
  [1300530, "Spectral Coils"],
  [1286860, "Rage of the Shackled"],
  [1302982, "Virulent Spit"],
  [1301510, "Circling Prey"],
  [1292999, "Submerge"],
  [1295905, "Serpent's Bite"],
  [1286905, "Fury Unleashed"],
]);

const HEALER_CDS = new Map([
  [740, "Tranquility"],
  [64843, "Divine Hymn"],
  [115310, "Revival"],
  [98008, "Spirit Link Totem"],
  [108280, "Healing Tide Totem"],
  [114052, "Ascendance"],
  [31821, "Aura Mastery"],
  [62618, "Power Word: Barrier"],
  [363534, "Rewind"],
  [33206, "Pain Suppression"],
  [102342, "Ironbark"],
  [116849, "Life Cocoon"],
  [47788, "Guardian Spirit"],
  [6940, "Blessing of Sacrifice"],
]);

function parseTs(line) {
  // 9/2/2026 21:58:57.549-3  EVENT,...
  const m = line.match(/^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) return null;
  const [, mo, d, y, h, mi, s, ms] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")} (${sec.toFixed(1)}s)`;
}

const encounters = [];
let current = null;

const rl = readline.createInterface({
  input: fs.createReadStream(logPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  if (line.includes("ENCOUNTER_START")) {
    const parts = line.split("  ")[1]?.split(",") ?? [];
    // ENCOUNTER_START,id,name,diff,size,zone
    const id = Number(parts[1]);
    const name = parts[2]?.replaceAll('"', "");
    const diff = Number(parts[3]);
    const startMs = parseTs(line);
    current = {
      id,
      name,
      diff,
      startMs,
      startLine: line,
      casts: [],
      healerCds: [],
    };
  } else if (line.includes("ENCOUNTER_END") && current) {
    const parts = line.split("  ")[1]?.split(",") ?? [];
    current.success = Number(parts[5]) === 1;
    current.durationMs = Number(parts[6]);
    current.endLine = line;
    encounters.push(current);
    current = null;
  } else if (current) {
    // SPELL_CAST_SUCCESS / SPELL_CAST_START — spell id is after flags
    // Format: EVENT,sourceGUID,sourceName,...,spellId,"spellName",...
    if (
      line.includes("SPELL_CAST_SUCCESS") ||
      line.includes("SPELL_CAST_START")
    ) {
      const eventPart = line.split("  ")[1] ?? "";
      const fields = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < eventPart.length; i++) {
        const ch = eventPart[i];
        if (ch === '"') {
          inQ = !inQ;
          cur += ch;
        } else if (ch === "," && !inQ) {
          fields.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      fields.push(cur);
      // fields[0]=EVENT, then 8 combatant fields, then spellId, spellName
      const spellId = Number(fields[9]);
      const spellName = fields[10]?.replaceAll('"', "");
      const t = parseTs(line);
      if (!t || !current.startMs) continue;
      const sec = (t - current.startMs) / 1000;
      const src = fields[2]?.replaceAll('"', "") ?? "";
      const event = fields[0];

      if (TRACK.has(spellId) && event === "SPELL_CAST_SUCCESS") {
        current.casts.push({ sec, spellId, spellName, src });
      }
      if (HEALER_CDS.has(spellId) && event === "SPELL_CAST_SUCCESS") {
        current.healerCds.push({
          sec,
          spellId,
          spellName: HEALER_CDS.get(spellId),
          src,
        });
      }
    }
  }
}

function printEncounter(enc) {
  console.log("\n" + "=".repeat(72));
  console.log(
    `${enc.name} | encounter ${enc.id} | diff ${enc.diff} | ${enc.success ? "KILL" : "WIPE"} | ${(enc.durationMs / 1000).toFixed(1)}s`,
  );
  console.log("=".repeat(72));

  const bySpell = new Map();
  for (const c of enc.casts) {
    const key = `${c.spellId}|${c.spellName}`;
    if (!bySpell.has(key)) bySpell.set(key, []);
    bySpell.get(key).push(c.sec);
  }

  console.log("\nBoss casts (SPELL_CAST_SUCCESS):");
  for (const [key, times] of [...bySpell.entries()].sort((a, b) => a[1][0] - b[1][0])) {
    const [id, name] = key.split("|");
    const list = times.map((t) => fmt(t)).join(", ");
    console.log(`  ${name} (${id}): ${list}`);
  }

  console.log("\nHealer CDs used:");
  for (const h of enc.healerCds.sort((a, b) => a.sec - b.sec)) {
    console.log(`  ${fmt(h.sec)}  ${h.spellName} — ${h.src}`);
  }
}

// Prefer kills; else longest wipe per boss
const byBoss = new Map();
for (const e of encounters) {
  const arr = byBoss.get(e.id) ?? [];
  arr.push(e);
  byBoss.set(e.id, arr);
}

for (const [, list] of byBoss) {
  const kill = list.find((e) => e.success);
  const best =
    kill ??
    [...list].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0];
  printEncounter(best);
}

console.log("\n\nAll encounters summary:");
for (const e of encounters) {
  console.log(
    `  ${e.name}: ${e.success ? "KILL" : "wipe"} ${(e.durationMs / 1000).toFixed(0)}s`,
  );
}
