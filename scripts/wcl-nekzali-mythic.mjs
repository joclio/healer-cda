/**
 * Fetch Mythic Nek'zali cast consensus from WCL speed rankings.
 * Usage: node scripts/wcl-nekzali-mythic.mjs
 */
import fs from "fs";
import path from "path";

const ENCOUNTER_ID = 3470;
const DIFFICULTY = 5; // Mythic
const KILLS = 4;

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = path.resolve(file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    }
  }
}
loadEnv();

const basic = Buffer.from(
  `${process.env.WCL_CLIENT_ID}:${process.env.WCL_CLIENT_SECRET}`,
).toString("base64");
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

function fmt(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}
function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

const KEY = {
  1285681: "Soulcoil Ignition",
  1293664: "Soulcoil Ignition",
  1297624: "Ritual Burn",
  1284103: "Possession Barrage",
  1294742: "Hungering Pyre",
  1289855: "Hungering Pyre",
  1299673: "Invoke",
  1287533: "Gravebound Advance",
  1295124: "Ritual of Awakening",
};

const rank = await gql(
  `query($id:Int!,$d:Int!){
    worldData { encounter(id:$id) { name fightRankings(difficulty:$d, page:1, metric:speed) } }
  }`,
  { id: ENCOUNTER_ID, d: DIFFICULTY },
);
const rows = (rank.worldData.encounter.fightRankings?.rankings || []).slice(0, KILLS);
console.log(`${rank.worldData.encounter.name} Mythic — ${rows.length} kills\n`);

const kills = [];
for (const row of rows) {
  const code = row.report?.code;
  const fightID = row.report?.fightID;
  if (!code || !fightID) continue;
  process.stdout.write(`${code}#${fightID}… `);

  const meta = await gql(
    `query($code:String!){
      reportData {
        report(code:$code) {
          title
          masterData { abilities { gameID name } actors { id name type } }
          fights { id encounterID kill startTime endTime difficulty }
        }
      }
    }`,
    { code },
  );
  const report = meta.reportData.report;
  const fight = report.fights.find((f) => f.id === fightID);
  if (!fight?.kill || fight.encounterID !== ENCOUNTER_ID) {
    console.log("skip");
    continue;
  }
  const abilities = new Map(
    (report.masterData?.abilities || []).map((a) => [a.gameID, a.name]),
  );
  const actors = new Map(
    (report.masterData?.actors || []).map((a) => [a.id, a]),
  );

  const events = [];
  let startTime = fight.startTime;
  let pages = 0;
  while (startTime != null && pages < 40) {
    pages++;
    const page = await gql(
      `query($code:String!,$start:Float!,$end:Float!){
        reportData {
          report(code:$code) {
            events(dataType:Casts, hostilityType:Enemies, startTime:$start, endTime:$end, limit:10000) {
              nextPageTimestamp data
            }
          }
        }
      }`,
      { code, start: startTime, end: fight.endTime },
    );
    const ev = page.reportData.report.events;
    const data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
    events.push(...(data || []));
    startTime = ev.nextPageTimestamp;
  }

  const casts = [];
  for (const e of events) {
    if (e.type !== "cast") continue;
    const src = actors.get(e.sourceID);
    if (!src || src.type !== "NPC") continue;
    const name = KEY[e.abilityGameID] || abilities.get(e.abilityGameID);
    if (!name || /Attack|Melee|Auto/i.test(name)) continue;
    const sec = (e.timestamp - fight.startTime) / 1000;
    casts.push({ sec, spellId: e.abilityGameID, name });
  }
  casts.sort((a, b) => a.sec - b.sec);
  const deduped = [];
  for (const c of casts) {
    if (deduped.some((d) => d.spellId === c.spellId && Math.abs(d.sec - c.sec) < 2))
      continue;
    deduped.push(c);
  }

  const dur = Math.round((fight.endTime - fight.startTime) / 1000);
  console.log(fmt(dur), report.title);
  kills.push({
    code,
    fightID,
    duration: dur,
    title: report.title,
    url: `https://www.warcraftlogs.com/reports/${code}?fight=${fightID}`,
    casts: deduped,
  });
}

// Build sequences for KEY abilities + frequent others
const focusNames = [
  "Soulcoil Ignition",
  "Ritual Burn",
  "Possession Barrage",
  "Hungering Pyre",
  "Invoke",
  "Gravebound Advance",
  "Ritual of Awakening",
];

console.log("\n=== Key ability times per kill ===\n");
for (const name of focusNames) {
  console.log(`--- ${name} ---`);
  for (const k of kills) {
    const times = k.casts
      .filter((c) => c.name === name)
      .map((c) => fmt(Math.round(c.sec)));
    console.log(`  ${fmt(k.duration).padStart(5)}  ${times.join(", ") || "(none)"}`);
  }
}

// Consensus medians by occurrence for KEY spells
console.log("\n=== Consensus (median per occurrence) ===\n");
const byLabel = new Map();
for (const k of kills) {
  for (const c of k.casts) {
    if (!focusNames.includes(c.name)) continue;
    if (!byLabel.has(c.name)) byLabel.set(c.name, []);
    byLabel.get(c.name).push(Math.round(c.sec));
  }
}
const consensus = {};
for (const [name, times] of byLabel) {
  const sorted = [...times].sort((a, b) => a - b);
  const clusters = [];
  for (const t of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(median(last) - t) < 15) last.push(t);
    else clusters.push([t]);
  }
  const occ = clusters
    .filter((c) => c.length >= Math.ceil(kills.length * 0.5))
    .map((c) => median(c));
  consensus[name] = occ;
  console.log(
    `${name.padEnd(22)}  ${occ.map(fmt).join(", ")}`,
  );
}

fs.writeFileSync(
  "scripts/wcl-nekzali-mythic.json",
  JSON.stringify({ kills, consensus }, null, 2),
);
console.log("\nWrote scripts/wcl-nekzali-mythic.json");
