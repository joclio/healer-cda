/**
 * Build Mythic boss JSON from Heroic templates + WCL Mythic speed-kill casts.
 * Skips bosses with no Mythic rankings and bosses that already have *-mythic.json.
 * Usage: node scripts/wcl-build-mythic.mjs [kills=4]
 */
import fs from "fs";
import path from "path";

const KILLS = Number(process.argv[2] || 4);
const DIFFICULTY = 5; // Mythic

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
if (!tok.access_token) throw new Error(JSON.stringify(tok));

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

function slugAbility(name) {
  return name
    .replace(/#\d+.*/, "")
    .replace(/\([^)]*\)/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 18);
}

async function fightCasts(code, fightId, encounterID) {
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
  while (startTime != null && pages < 50) {
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
    const name = abilities.get(e.abilityGameID) || String(e.abilityGameID);
    if (/Attack|Melee|Auto/i.test(name)) continue;
    casts.push({
      sec: (e.timestamp - fight.startTime) / 1000,
      spellId: e.abilityGameID,
      name,
    });
  }
  casts.sort((a, b) => a.sec - b.sec);
  const deduped = [];
  for (const c of casts) {
    if (
      deduped.some(
        (d) => d.spellId === c.spellId && Math.abs(d.sec - c.sec) < 2,
      )
    )
      continue;
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

/** Median times per occurrence index for a spell across kills. */
function occurrenceMedians(kills, spellId, clusterSec = 14) {
  const all = [];
  for (const k of kills) {
    for (const c of k.casts) {
      if (c.spellId === spellId) all.push(Math.round(c.sec));
    }
  }
  if (!all.length) return [];
  const sorted = [...all].sort((a, b) => a - b);
  const clusters = [];
  for (const t of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(median(last) - t) < clusterSec) last.push(t);
    else clusters.push([t]);
  }
  const minKills = Math.ceil(kills.length * 0.5);
  return clusters
    .filter((c) => c.length >= minKills)
    .map((c) => median(c));
}

function baseAbilityName(ability) {
  return ability.replace(/\s*#\d+.*$/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function buildMythicBoss(heroic, kills) {
  const spellIds = [
    ...new Set(heroic.windows.map((w) => w.abilitySpellId).filter(Boolean)),
  ];

  const occBySpell = new Map();
  for (const id of spellIds) {
    occBySpell.set(id, occurrenceMedians(kills, id));
  }

  const mythicDur = median(kills.map((k) => k.durationSec));
  // Heroic kill length ≈ enrage buffer target less a bit; fall back to last window.
  const lastHeroic = Math.max(0, ...heroic.windows.map((w) => w.timeSec));
  const heroicDur = Math.max(
    lastHeroic,
    (heroic.enrageSec ?? lastHeroic) - 30,
  );
  const scale = mythicDur / Math.max(heroicDur, 60);

  const prefix = heroic.id
    .split("-")
    .map((p) => p[0])
    .join("")
    .slice(0, 4);

  const windows = [];
  const usedOcc = new Map(); // spellId -> Set of occ indices

  function takeNearestOcc(spellId, targetSec) {
    const times = occBySpell.get(spellId) || [];
    if (!times.length) return null;
    const used = usedOcc.get(spellId) || new Set();
    let best = null;
    for (let i = 0; i < times.length; i++) {
      if (used.has(i)) continue;
      const delta = Math.abs(times[i] - targetSec);
      if (!best || delta < best.delta) best = { i, timeSec: times[i], delta };
    }
    if (!best) return null;
    if (!usedOcc.has(spellId)) usedOcc.set(spellId, new Set());
    usedOcc.get(spellId).add(best.i);
    return best;
  }

  for (const w of heroic.windows) {
    if (!w.abilitySpellId) {
      const timeSec = Math.round(w.timeSec * Math.min(Math.max(scale, 1), 2.5));
      windows.push({
        ...w,
        id: `${prefix}m-${w.id.replace(/^[a-z]+-/, "")}`,
        timeSec,
        trigger: `WCL ${fmt(timeSec)} (scaled)`,
        note: w.note
          ? `${w.note} (Mythic time scaled — no spellId)`
          : "Mythic time scaled — no spellId",
      });
      continue;
    }

    const target = Math.round(w.timeSec * scale);
    const hit = takeNearestOcc(w.abilitySpellId, target);
    if (!hit) {
      console.log(
        `  skip ${w.ability} — no free Mythic cast near ${fmt(target)}`,
      );
      continue;
    }

    const base = baseAbilityName(w.ability);
    const n = hit.i + 1;
    windows.push({
      id: `${prefix}m-${slugAbility(base)}${n}`,
      timeSec: hit.timeSec,
      ability: `${base} #${n}`,
      abilitySpellId: w.abilitySpellId,
      trigger: `WCL ${fmt(hit.timeSec)}`,
      severity: w.severity,
      category: w.category,
      phase: w.phase,
      assignCd: w.assignCd,
      note: w.note || undefined,
    });
  }

  // Extra mythic occurrences for critical/raid (not tank spam)
  for (const id of spellIds) {
    const times = occBySpell.get(id) || [];
    const used = usedOcc.get(id) || new Set();
    const template = heroic.windows.find((w) => w.abilitySpellId === id);
    if (!template) continue;
    const isTank =
      template.severity === "tank" || template.category === "external";
    if (isTank) continue;
    if (
      template.severity !== "critical" &&
      template.severity !== "raid" &&
      template.assignCd === false
    ) {
      continue;
    }

    for (let i = 0; i < times.length; i++) {
      if (used.has(i)) continue;
      const base = baseAbilityName(template.ability);
      const timeSec = times[i];
      windows.push({
        id: `${prefix}m-${slugAbility(base)}${i + 1}`,
        timeSec,
        ability: `${base} #${i + 1}`,
        abilitySpellId: id,
        trigger: `WCL ${fmt(timeSec)}`,
        severity: template.severity,
        category: template.category,
        phase: template.phase,
        assignCd: template.assignCd !== false,
        note: "Extra Mythic occurrence vs Heroic timeline.",
      });
      used.add(i);
    }
  }

  windows.sort(
    (a, b) => a.timeSec - b.timeSec || a.ability.localeCompare(b.ability),
  );

  const seen = new Map();
  for (const w of windows) {
    const n = (seen.get(w.id) || 0) + 1;
    seen.set(w.id, n);
    if (n > 1) w.id = `${w.id}x${n}`;
  }

  const durations = kills.map((k) => k.durationSec);
  const medDur = median(durations);
  const enrageSec = Math.ceil(medDur / 30) * 30 + 30;
  const best = [...kills].sort((a, b) => a.durationSec - b.durationSec)[0];

  return {
    id: `${heroic.id}-mythic`,
    name: heroic.name,
    shortName: heroic.shortName,
    encounterId: heroic.encounterId,
    group: heroic.group,
    difficulty: "Mythic",
    order: heroic.order,
    source: `WCL Mythic consensus — ${kills.length} speed kills (~${fmt(Math.min(...durations))}–${fmt(Math.max(...durations))}). Heroic windows remapped by scaled time to nearest Mythic cast; extra critical/raid casts added.`,
    sourceUrl: best.url,
    enrageSec,
    enrageName: `Kill target (~${fmt(enrageSec)} speed)`,
    windows,
  };
}

const existingMythic = new Set(
  fs
    .readdirSync("data/bosses")
    .filter((f) => f.includes("mythic"))
    .map((f) => f.replace(/-mythic\.json$/, "").replace(/\.json$/, "")),
);

const heroicBosses = fs
  .readdirSync("data/bosses")
  .filter((f) => f.endsWith(".json") && !f.includes("mythic"))
  .map((f) => ({
    file: f,
    ...JSON.parse(fs.readFileSync(`data/bosses/${f}`, "utf8")),
  }))
  .filter((b) => b.group === "raid")
  .filter((b) => !existingMythic.has(b.id))
  .sort((a, b) => a.order - b.order);

const written = [];

for (const boss of heroicBosses) {
  console.log(`\n######## ${boss.name} ########`);
  const rank = await gql(
    `query($id:Int!,$d:Int!){
      worldData {
        encounter(id:$id) {
          name
          fightRankings(difficulty:$d, page:1, metric:speed)
        }
      }
    }`,
    { id: boss.encounterId, d: DIFFICULTY },
  );
  const rows = (rank.worldData.encounter.fightRankings?.rankings || []).slice(
    0,
    KILLS,
  );
  if (!rows.length) {
    console.log("  No Mythic rankings — skip");
    continue;
  }
  console.log(`  ${rows.length} Mythic speed kills…`);

  const kills = [];
  for (const row of rows) {
    const code = row.report?.code;
    const fightID = row.report?.fightID;
    if (!code || !fightID) continue;
    process.stdout.write(`  ${code}#${fightID}… `);
    try {
      const k = await fightCasts(code, fightID, boss.encounterId);
      if (!k) {
        console.log("skip");
        continue;
      }
      console.log(fmt(k.durationSec));
      kills.push(k);
    } catch (e) {
      console.log("err", String(e.message).slice(0, 80));
    }
  }

  if (!kills.length) {
    console.log("  No kills fetched — skip");
    continue;
  }

  const mythic = buildMythicBoss(boss, kills);
  const outPath = path.join("data", "bosses", `${boss.id}-mythic.json`);
  fs.writeFileSync(outPath, JSON.stringify(mythic, null, 2) + "\n");
  console.log(
    `  Wrote ${outPath} — ${mythic.windows.length} windows, enrage ${fmt(mythic.enrageSec)}`,
  );
  written.push(mythic.id);

  // also dump raw for debugging
  fs.writeFileSync(
    path.join("scripts", `wcl-${boss.id}-mythic.json`),
    JSON.stringify(
      {
        kills: kills.map((k) => ({
          code: k.code,
          fightId: k.fightId,
          duration: k.durationSec,
          url: k.url,
          title: k.title,
        })),
        windowCount: mythic.windows.length,
      },
      null,
      2,
    ),
  );
}

console.log("\nDone:", written.join(", ") || "(none)");
