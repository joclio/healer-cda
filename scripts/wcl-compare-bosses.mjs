/**
 * Compare planner boss windows vs WCL Heroic kill cast consensus.
 * Usage: node scripts/wcl-compare-bosses.mjs [killsPerBoss=4]
 */
import fs from "fs";
import path from "path";

const KILLS = Number(process.argv[2] || 4);
const DIFFICULTY = 4;

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = path.resolve(file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      if (!process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    }
  }
}
loadEnv();

const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Missing WCL credentials");
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
  if (!j.access_token) throw new Error(JSON.stringify(j));
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

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

async function rankingKills(token, encounterID) {
  const rank = await gql(
    token,
    `query($id:Int!,$d:Int!){
      worldData {
        encounter(id:$id) {
          name
          fightRankings(difficulty:$d, page:1, metric:speed)
        }
      }
    }`,
    { id: encounterID, d: DIFFICULTY },
  );
  const fr = rank.worldData.encounter.fightRankings;
  return {
    name: rank.worldData.encounter.name,
    rows: (fr?.rankings || []).slice(0, KILLS),
  };
}

async function fightCasts(token, code, fightId, encounterID) {
  const meta = await gql(
    token,
    `query($code:String!){
      reportData {
        report(code:$code) {
          title
          masterData { abilities { gameID name } actors { id name type } }
          fights { id encounterID kill startTime endTime difficulty name }
        }
      }
    }`,
    { code },
  );
  const report = meta.reportData.report;
  const fight = report.fights.find((f) => f.id === fightId);
  if (!fight?.kill || fight.encounterID !== encounterID) return null;

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

  const casts = [];
  for (const e of events) {
    if (e.type !== "cast") continue;
    const src = actors.get(e.sourceID);
    if (!src || src.type !== "NPC") continue;
    const name = abilities.get(e.abilityGameID) || String(e.abilityGameID);
    if (/Attack|Melee|Auto/i.test(name)) continue;
    casts.push({
      sec: (e.timestamp - fight.startTime) / 1000,
      spellId: e.abilityGameID,
      name,
      src: src.name,
    });
  }
  casts.sort((a, b) => a.sec - b.sec);

  // Dedupe same spell within 2s
  const deduped = [];
  for (const c of casts) {
    const near = deduped.find(
      (d) => d.spellId === c.spellId && Math.abs(d.sec - c.sec) < 2,
    );
    if (near) continue;
    deduped.push(c);
  }

  return {
    code,
    fightId,
    title: report.title,
    durationSec: Math.round((fight.endTime - fight.startTime) / 1000),
    url: `https://www.warcraftlogs.com/reports/${code}?fight=${fightId}`,
    casts: deduped,
  };
}

function timesForSpell(kills, spellId) {
  // For each kill, list cast times of this spellId
  return kills.map((k) =>
    k.casts.filter((c) => c.spellId === spellId).map((c) => Math.round(c.sec)),
  );
}

function consensusNth(killLists, n) {
  const vals = [];
  for (const list of killLists) {
    if (list[n] != null) vals.push(list[n]);
  }
  if (!vals.length) return null;
  return { median: median(vals), min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
}

const bosses = fs
  .readdirSync("data/bosses")
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(`data/bosses/${f}`, "utf8")) }))
  .filter((b) => b.id !== "ulatek") // already done
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

const token = await getToken();
const out = {};

for (const boss of bosses) {
  console.log(`\n######## ${boss.name} (${boss.encounterId}) ########`);
  let ranking;
  try {
    ranking = await rankingKills(token, boss.encounterId);
  } catch (e) {
    console.log("  rankings failed:", e.message.slice(0, 200));
    continue;
  }
  console.log(`  WCL name: ${ranking.name} — fetching ${ranking.rows.length} speed kills…`);

  const kills = [];
  for (const row of ranking.rows) {
    const code = row.report?.code;
    const fightID = row.report?.fightID;
    if (!code || !fightID) continue;
    process.stdout.write(`  ${code}#${fightID}… `);
    try {
      const k = await fightCasts(token, code, fightID, boss.encounterId);
      if (!k) {
        console.log("skip");
        continue;
      }
      console.log(fmt(k.durationSec));
      kills.push(k);
    } catch (e) {
      console.log("err", e.message.slice(0, 80));
    }
  }

  if (!kills.length) {
    console.log("  No kills fetched");
    continue;
  }

  // Spell IDs from planner windows
  const spellIds = [
    ...new Set(
      boss.windows.map((w) => w.abilitySpellId).filter(Boolean),
    ),
  ];

  console.log("\n  --- Planner vs WCL median ---");
  const diffs = [];
  for (const w of boss.windows) {
    if (!w.abilitySpellId) {
      console.log(
        `  ${fmt(w.timeSec).padStart(5)}  ${w.ability.padEnd(40)}  (no spellId)`,
      );
      continue;
    }
    const lists = timesForSpell(kills, w.abilitySpellId);
    // Match planner time to nearest cast of same spell within ±45s across kills, using occurrence index
    // Find which occurrence index is closest to planner timeSec
    const allOcc = [];
    for (const list of lists) {
      list.forEach((t, i) => allOcc.push({ i, t }));
    }
    // Prefer occurrence whose median is closest to planner
    const byIndex = new Map();
    for (const list of lists) {
      list.forEach((t, i) => {
        if (!byIndex.has(i)) byIndex.set(i, []);
        byIndex.get(i).push(t);
      });
    }
    let best = null;
    for (const [i, vals] of byIndex) {
      const med = median(vals);
      const delta = Math.abs(med - w.timeSec);
      if (!best || delta < best.delta) best = { i, med, delta, vals };
    }

    if (!best) {
      // try name match fuzzy from first kill casts
      console.log(
        `  ${fmt(w.timeSec).padStart(5)}  ${w.ability.padEnd(40)}  NO WCL casts for ${w.abilitySpellId}`,
      );
      diffs.push({ window: w, status: "missing" });
      continue;
    }

    const spread = Math.max(...best.vals) - Math.min(...best.vals);
    const flag =
      best.delta > 8 ? "DIFF" : best.delta > 3 ? "~" : "ok";
    console.log(
      `  ${fmt(w.timeSec).padStart(5)}→${fmt(best.med).padStart(5)}  Δ${String(best.delta).padStart(3)}s  [${flag}]  ${w.ability}  (occ#${best.i + 1}, spread ${spread}s, n=${best.vals.length})`,
    );
    diffs.push({
      window: w,
      status: flag,
      wclMedian: best.med,
      delta: best.delta,
      occ: best.i,
      spread,
    });
  }

  // Also dump top recurring ability cast sequences for discovery (nymrissa etc)
  const freq = new Map();
  for (const k of kills) {
    for (const c of k.casts) {
      if (c.sec > (boss.enrageSec ?? 600) + 30) continue;
      const key = `${c.spellId}|${c.name}`;
      if (!freq.has(key)) freq.set(key, []);
      freq.get(key).push(Math.round(c.sec));
    }
  }
  // Group by spell into occurrence medians
  const sequences = [];
  for (const [key, times] of freq) {
    const [spellId, name] = key.split("|");
    // Cluster times within 8s across kills into occurrences
    const sorted = [...times].sort((a, b) => a - b);
    const clusters = [];
    for (const t of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(median(last) - t) < 12) last.push(t);
      else clusters.push([t]);
    }
    // Only keep clusters with enough kills
    const occ = clusters
      .filter((c) => c.length >= Math.ceil(kills.length * 0.5))
      .map((c) => median(c));
    if (occ.length >= 1 && !/Attack|Melee/i.test(name)) {
      sequences.push({ spellId: Number(spellId), name, occ });
    }
  }
  sequences.sort((a, b) => (a.occ[0] ?? 0) - (b.occ[0] ?? 0));

  console.log("\n  --- WCL recurring casts (median per occurrence) ---");
  for (const s of sequences.slice(0, 35)) {
    console.log(
      `  ${String(s.spellId).padStart(8)}  ${s.name.padEnd(32)}  ${s.occ.map(fmt).join(", ")}`,
    );
  }

  out[boss.id] = {
    file: boss.file,
    encounterId: boss.encounterId,
    kills: kills.map((k) => ({
      code: k.code,
      fightId: k.fightId,
      duration: k.durationSec,
      url: k.url,
      title: k.title,
    })),
    diffs,
    sequences,
  };
}

fs.writeFileSync(
  "scripts/wcl-boss-compare.json",
  JSON.stringify(out, null, 2),
);
console.log("\nWrote scripts/wcl-boss-compare.json");
