/**
 * Sample cast-to-cast gaps for planner CDs from current WCL speed kills.
 * Compares observed gaps (p10/p50/p90) against data/spells catalog CDs.
 *
 * Usage:
 *   node scripts/wcl-cd-gaps.mjs [kills=8] [encounterId=3492] [difficulty=4]
 *   Defaults: Ula'tek Heroic (long enough for 2+ casts of 3min CDs)
 *   difficulty: 4=Heroic, 5=Mythic
 *   Writes scripts/wcl-cd-gaps.json + prints a flag table (catalog vs gap p50).
 *
 * Needs WCL_CLIENT_ID + WCL_CLIENT_SECRET in .env.local
 */
import fs from "fs";
import path from "path";

const KILLS = Number(process.argv[2] || 8);
const ENCOUNTER_ID = Number(process.argv[3] || 3492); // Ula'tek
const DIFFICULTY = Number(process.argv[4] || 4);

const SPELLS = {
  740: "Tranquility",
  102342: "Ironbark",
  64843: "Divine Hymn",
  47788: "Guardian Spirit",
  62618: "Power Word: Barrier",
  33206: "Pain Suppression",
  47536: "Rapture",
  98008: "Spirit Link Totem",
  108280: "Healing Tide Totem",
  114052: "Ascendance",
  115310: "Revival",
  116849: "Life Cocoon",
  31821: "Aura Mastery",
  6940: "Blessing of Sacrifice",
  633: "Lay on Hands",
  363534: "Rewind",
  357170: "Time Dilation",
  370537: "Stasis",
  97462: "Rallying Cry",
  51052: "Anti-Magic Zone",
  196718: "Darkness",
};

const SPELL_ID_SET = new Set(Object.keys(SPELLS).map(Number));

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = path.resolve(file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()])
        process.env[m[1].trim()] = m[2].trim();
    }
  }
}

loadEnv();
const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Missing WCL_CLIENT_ID / WCL_CLIENT_SECRET");
  process.exit(1);
}

const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
const tok = await (
  await fetch("https://www.warcraftlogs.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })
).json();
if (!tok.access_token) {
  console.error("Token failed", tok);
  process.exit(1);
}

async function gql(query, variables = {}) {
  const j = await (
    await fetch("https://www.warcraftlogs.com/api/v2/client", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    })
  ).json();
  if (j.errors) throw new Error(JSON.stringify(j.errors, null, 2));
  return j.data;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

function parseEvents(raw) {
  if (!raw) return [];
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

const spellIds = [...SPELL_ID_SET];

const rank = await gql(
  `query($id:Int!,$d:Int!){
    worldData {
      encounter(id:$id) {
        name
        fightRankings(difficulty:$d, page:1, metric:speed)
      }
    }
  }`,
  { id: ENCOUNTER_ID, d: DIFFICULTY },
);

const encounterName = rank.worldData.encounter.name;
const rows = (rank.worldData.encounter.fightRankings?.rankings || []).slice(
  0,
  KILLS,
);

console.error(
  `${encounterName} d${DIFFICULTY} — sampling ${rows.length} speed kills`,
);

/** @type {Record<number, number[]>} */
const gaps = Object.fromEntries(spellIds.map((id) => [id, []]));
/** @type {Record<number, number>} */
const casts = Object.fromEntries(spellIds.map((id) => [id, 0]));
let killsUsed = 0;

for (const row of rows) {
  const code = row.report?.code;
  const fightID = row.report?.fightID;
  if (!code || !fightID) continue;
  process.stderr.write(`  ${code}#${fightID}… `);

  try {
    const meta = await gql(
      `query($code:String!){
        reportData {
          report(code:$code) {
            fights { id encounterID kill startTime endTime difficulty }
          }
        }
      }`,
      { code },
    );
    const fight = meta.reportData.report.fights.find((f) => f.id === fightID);
    if (!fight?.kill || fight.encounterID !== ENCOUNTER_ID) {
      console.error("skip");
      continue;
    }

    const events = [];
    let startTime = fight.startTime;
    let pages = 0;
    while (startTime != null && pages < 60) {
      pages++;
      const page = await gql(
        `query($code:String!,$start:Float!,$end:Float!){
          reportData {
            report(code:$code) {
              events(
                dataType:Casts
                hostilityType:Friendlies
                startTime:$start
                endTime:$end
                limit:10000
              ) { nextPageTimestamp data }
            }
          }
        }`,
        { code, start: startTime, end: fight.endTime },
      );
      const ev = page.reportData.report.events;
      events.push(...parseEvents(ev.data));
      startTime = ev.nextPageTimestamp;
    }

    /** @type {Record<string, number[]>} */
    const byKey = {};
    for (const ev of events) {
      if (ev.type !== "cast") continue;
      const sid = ev.abilityGameID;
      if (!SPELL_ID_SET.has(sid)) continue;
      casts[sid]++;
      const key = `${ev.sourceID}:${sid}`;
      const t = (ev.timestamp - fight.startTime) / 1000;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(t);
    }

    for (const [key, times] of Object.entries(byKey)) {
      const sid = Number(key.split(":")[1]);
      times.sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) {
        const gap = times[i] - times[i - 1];
        // Ignore accidental double-casts and fight-length outliers.
        if (gap >= 20 && gap <= 900) gaps[sid].push(gap);
      }
    }

    killsUsed++;
    console.error(`${pages}p ${Math.round((fight.endTime - fight.startTime) / 1000)}s`);
  } catch (e) {
    console.error("err", String(e.message).slice(0, 100));
  }
}

const catalog = JSON.parse(
  fs.readFileSync(path.resolve("data/spells/healers.json"), "utf8"),
).concat(
  JSON.parse(
    fs.readFileSync(path.resolve("data/spells/raid-utilities.json"), "utf8"),
  ),
);
const bySpellId = Object.fromEntries(catalog.map((s) => [s.spellId, s]));

const resultRows = spellIds.map((id) => {
  const g = [...gaps[id]].sort((a, b) => a - b);
  const cat = bySpellId[id];
  const p50 = g.length ? Math.round(percentile(g, 0.5)) : null;
  const catalogCd = cat?.cooldownSec ?? null;
  let flag = null;
  if (p50 != null && catalogCd != null) {
    const delta = p50 - catalogCd;
    if (delta <= -45) flag = "catalog_high";
    else if (delta >= 45) flag = "catalog_low";
  }
  return {
    spellId: id,
    name: SPELLS[id],
    catalogCd,
    catalogDur: cat?.durationSec ?? null,
    casts: casts[id],
    gapSamples: g.length,
    gapP10: g.length ? Math.round(percentile(g, 0.1)) : null,
    gapP50: p50,
    gapP90: g.length ? Math.round(percentile(g, 0.9)) : null,
    flag,
  };
});

const out = {
  encounterID: ENCOUNTER_ID,
  encounterName,
  difficulty: DIFFICULTY,
  killsRequested: KILLS,
  killsUsed,
  rows: resultRows,
};

const outPath = path.resolve("scripts/wcl-cd-gaps.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.error(`Wrote ${outPath}`);

// Compact table to stderr for quick scan.
console.error("\nspell                     cat   p10  p50  p90  n  flag");
for (const r of resultRows) {
  if (!r.casts) continue;
  console.error(
    `${r.name.padEnd(24)} ${String(r.catalogCd).padStart(4)} ${String(r.gapP10 ?? "-").padStart(4)} ${String(r.gapP50 ?? "-").padStart(4)} ${String(r.gapP90 ?? "-").padStart(4)} ${String(r.gapSamples).padStart(3)}  ${r.flag ?? ""}`,
  );
}

console.log(JSON.stringify(out, null, 2));
