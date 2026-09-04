/**
 * Fetch boss cast timeline from a Warcraft Logs report fight.
 * Usage: node scripts/wcl-fight-casts.mjs <reportCode> <fightId>
 * Needs WCL_CLIENT_ID + WCL_CLIENT_SECRET in .env.local
 */
import fs from "fs";
import path from "path";

const reportCode = process.argv[2];
const fightId = Number(process.argv[3]);
if (!reportCode || !fightId) {
  console.error("Usage: node scripts/wcl-fight-casts.mjs <code> <fightId>");
  process.exit(1);
}

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = path.resolve(file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const k = m[1].trim();
      const v = m[2].trim();
      if (!process.env[k]) process.env[k] = v;
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

async function getToken() {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await fetch("https://www.warcraftlogs.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j = await r.json();
  if (!j.access_token) {
    console.error("Token failed", j);
    process.exit(1);
  }
  return j.access_token;
}

async function gql(token, query, variables = {}) {
  const r = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) {
    console.error(JSON.stringify(j.errors, null, 2));
    process.exit(1);
  }
  return j.data;
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const token = await getToken();

const meta = await gql(
  token,
  `query($code:String!){
    reportData {
      report(code:$code) {
        title
        fights {
          id name encounterID kill startTime endTime difficulty
          friendlyPlayers
        }
      }
    }
  }`,
  { code: reportCode },
);

const report = meta.reportData.report;
const fight = report.fights.find((f) => f.id === fightId);
if (!fight) {
  console.error(
    "Fight not found. Available:",
    report.fights.map((f) => `${f.id}:${f.name}`).join(", "),
  );
  process.exit(1);
}

const durationSec = (fight.endTime - fight.startTime) / 1000;
console.log(
  JSON.stringify(
    {
      title: report.title,
      fight: {
        id: fight.id,
        name: fight.name,
        encounterID: fight.encounterID,
        kill: fight.kill,
        difficulty: fight.difficulty,
        durationSec: Math.round(durationSec),
        duration: fmt(durationSec),
      },
    },
    null,
    2,
  ),
);

// Enemy cast events (filterType Casts, hostility Enemies)
const casts = [];
let startTime = fight.startTime;
const endTime = fight.endTime;
let pages = 0;

while (startTime != null && pages < 40) {
  pages++;
  const page = await gql(
    token,
    `query($code:String!,$start:Float!,$end:Float!){
      reportData {
        report(code:$code) {
          events(
            dataType: Casts
            hostilityType: Enemies
            startTime: $start
            endTime: $end
            limit: 10000
          ) {
            nextPageTimestamp
            data
          }
        }
      }
    }`,
    { code: reportCode, start: startTime, end: endTime },
  );

  const ev = page.reportData.report.events;
  const data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
  for (const e of data || []) {
    if (e.type !== "cast" && e.type !== "begincast") continue;
    casts.push({
      t: (e.timestamp - fight.startTime) / 1000,
      type: e.type,
      abilityGameID: e.abilityGameID,
      sourceID: e.sourceID,
    });
  }
  startTime = ev.nextPageTimestamp;
}

// Resolve ability names via masterData if possible
const master = await gql(
  token,
  `query($code:String!){
    reportData {
      report(code:$code) {
        masterData {
          actors { id name type subType }
          abilities { gameID name type }
        }
      }
    }
  }`,
  { code: reportCode },
);

const abilities = new Map(
  (master.reportData.report.masterData?.abilities || []).map((a) => [
    a.gameID,
    a.name,
  ]),
);
const actors = new Map(
  (master.reportData.report.masterData?.actors || []).map((a) => [
    a.id,
    { name: a.name, type: a.type, subType: a.subType },
  ]),
);

const rows = [];
const seen = new Set();
for (const c of casts.sort((a, b) => a.t - b.t)) {
  if (c.type !== "cast") continue; // success only
  const name = abilities.get(c.abilityGameID) || String(c.abilityGameID);
  const src = actors.get(c.sourceID);
  if (!src || src.type !== "NPC") continue;
  // skip trivial
  if (/Attack|Melee|Auto/i.test(name)) continue;
  const key = `${Math.round(c.t)}|${c.abilityGameID}`;
  if (seen.has(key)) continue;
  // dedupe within 2s same spell
  const near = rows.find(
    (r) =>
      r.spellId === c.abilityGameID && Math.abs(r.sec - c.t) < 2,
  );
  if (near) continue;
  seen.add(key);
  rows.push({
    time: fmt(c.t),
    sec: Math.round(c.t),
    spellId: c.abilityGameID,
    spellName: name,
    src: src.name,
  });
}

const out = {
  report: report.title,
  fight,
  duration: fmt(durationSec),
  casts: rows,
};
fs.writeFileSync(
  "scripts/wcl-fight-casts.json",
  JSON.stringify(out, null, 2),
);
console.log(`\nWrote ${rows.length} casts → scripts/wcl-fight-casts.json\n`);
for (const r of rows) {
  console.log(`${r.time.padStart(5)}  ${r.spellName} (${r.spellId})  [${r.src}]`);
}
