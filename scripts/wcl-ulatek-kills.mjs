/**
 * Compare key Ula'tek cast times across Heroic kills from WCL rankings.
 * Usage: node scripts/wcl-ulatek-kills.mjs [count=8]
 */
import fs from "fs";
import path from "path";

const COUNT = Number(process.argv[2] || 8);
const ENCOUNTER_ID = 3492; // Ula'tek
const DIFFICULTY = 4; // Heroic

const KEY = {
  1298367: "Mother’s Wrath",
  1308927: "Spectral Coils",
  1299010: "Spectral Coils",
  1319282: "Caustic Waves",
  1292211: "Caustic Waves",
  1311807: "Caustic Waves",
  1304012: "Call of the Serpent",
  1300751: "Call of the Serpent",
  1286860: "Rage of the Shackled",
  1315341: "Circling Prey",
  1295905: "Serpent’s Bite",
  1292521: "Submerge",
  1301512: "Submerge",
};

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
  if (j.errors) throw new Error(JSON.stringify(j.errors, null, 2));
  return j.data;
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pickKeyCasts(events, fightStart) {
  const byName = new Map();
  for (const e of events) {
    if (e.type !== "cast") continue;
    const label = KEY[e.abilityGameID];
    if (!label) continue;
    const t = (e.timestamp - fightStart) / 1000;
    const list = byName.get(label) || [];
    // dedupe within 3s (multi-source same cast)
    if (list.some((x) => Math.abs(x - t) < 3)) continue;
    list.push(t);
    byName.set(label, list);
  }
  return byName;
}

async function fightKeyCasts(token, code, fightId) {
  const meta = await gql(
    token,
    `query($code:String!){
      reportData {
        report(code:$code) {
          title
          fights { id name encounterID kill startTime endTime difficulty }
        }
      }
    }`,
    { code },
  );
  const report = meta.reportData.report;
  const fight = report.fights.find((f) => f.id === fightId);
  if (!fight || !fight.kill || fight.encounterID !== ENCOUNTER_ID) {
    return null;
  }

  const events = [];
  let startTime = fight.startTime;
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
            ) { nextPageTimestamp data }
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

  const keys = pickKeyCasts(events, fight.startTime);
  const durationSec = (fight.endTime - fight.startTime) / 1000;
  return {
    code,
    fightId,
    title: report.title,
    durationSec: Math.round(durationSec),
    duration: fmt(durationSec),
    url: `https://www.warcraftlogs.com/reports/${code}?fight=${fightId}`,
    casts: Object.fromEntries(
      [...keys.entries()].map(([k, times]) => [
        k,
        times.map((t) => ({ sec: Math.round(t), time: fmt(t) })),
      ]),
    ),
  };
}

const token = await getToken();

// Prefer rankings; also always include the known ASDTGSG kill.
const known = [{ report: { code: "CYcDQFnv91bfBxwr" }, fightID: 49, duration: 588000 }];

let rankingRows = [];
try {
  const rank = await gql(
    token,
    `query($encounterID:Int!,$difficulty:Int!,$page:Int!){
      worldData {
        encounter(id:$encounterID) {
          name
          fightRankings(difficulty:$difficulty, page:$page, metric:speed)
        }
      }
    }`,
    { encounterID: ENCOUNTER_ID, difficulty: DIFFICULTY, page: 1 },
  );
  const fr = rank.worldData.encounter.fightRankings;
  rankingRows = (fr?.rankings || []).slice(0, Math.max(COUNT - 1, COUNT));
  console.log(
    `Rankings: ${rank.worldData.encounter.name} Heroic speed — using ${rankingRows.length} + known kill\n`,
  );
} catch (e) {
  console.error("Rankings query failed, falling back to known report only:\n", e.message);
}

const targets = [];
const seen = new Set();
for (const row of [...known, ...rankingRows]) {
  const code = row.report?.code || row.reportCode;
  const fightID =
    row.report?.fightID || row.fightID || row.fightId || row.fight?.id;
  if (!code || !fightID) continue;
  const key = `${code}:${fightID}`;
  if (seen.has(key)) continue;
  seen.add(key);
  targets.push({
    code,
    fightID,
    duration: row.duration,
    guild: row.guild?.name,
  });
  if (targets.length >= COUNT) break;
}

const results = [];
for (const t of targets) {
  process.stdout.write(`Fetching ${t.code} fight ${t.fightID}… `);
  try {
    const r = await fightKeyCasts(token, t.code, t.fightID);
    if (!r) {
      console.log("skip (not kill/ulatek)");
      continue;
    }
    console.log(`${r.duration}`);
    results.push(r);
  } catch (e) {
    console.log("error:", e.message.slice(0, 120));
  }
}

// Compare Circling Prey + Rage + early anchors
const focus = [
  "Mother’s Wrath",
  "Spectral Coils",
  "Caustic Waves",
  "Call of the Serpent",
  "Rage of the Shackled",
  "Circling Prey",
  "Serpent’s Bite",
];

console.log("\n========== Kill summary ==========\n");
for (const r of results) {
  console.log(`${r.duration.padStart(5)}  ${r.title}`);
  console.log(`       ${r.url}`);
}

console.log("\n========== Key ability times ==========\n");
for (const name of focus) {
  console.log(`--- ${name} ---`);
  for (const r of results) {
    const times = (r.casts[name] || []).map((x) => x.time).join(", ") || "(none)";
    console.log(`  ${r.duration.padStart(5)}  ${times}`);
  }
  console.log();
}

// Variance on Circling Prey #1/#2/#3 and Rage
function nth(r, name, i) {
  return r.casts[name]?.[i]?.sec ?? null;
}

console.log("========== Circling Prey / Rage variance ==========\n");
console.log("kill   CP1   CP2   CP3   Rage1 Rage2 Rage3");
for (const r of results) {
  const cells = [0, 1, 2]
    .map((i) => nth(r, "Circling Prey", i))
    .concat([0, 1, 2].map((i) => nth(r, "Rage of the Shackled", i)))
    .map((s) => (s == null ? "  -  " : fmt(s).padStart(5)));
  console.log(`${r.duration.padStart(5)} ${cells.join(" ")}`);
}

fs.writeFileSync(
  "scripts/wcl-ulatek-kills.json",
  JSON.stringify({ encounterID: ENCOUNTER_ID, difficulty: DIFFICULTY, results }, null, 2),
);
console.log(`\nWrote scripts/wcl-ulatek-kills.json (${results.length} kills)`);
