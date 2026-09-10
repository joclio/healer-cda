/**
 * Rebuild Nek'zali + Lost Explorers Mythic JSON from current WCL Mythic kills.
 * Prefers prog-length kills that include key mid/late abilities (not only race parses).
 *
 * Usage: node scripts/wcl-rebuild-guild-mythic.mjs
 * Needs WCL_CLIENT_ID + WCL_CLIENT_SECRET in .env.local
 */
import fs from "fs";
import path from "path";

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

async function rankingRows(encounterID, pages = 5) {
  const rows = [];
  for (let page = 1; page <= pages; page++) {
    const rank = await gql(
      `query($id:Int!,$d:Int!,$page:Int!){
        worldData {
          encounter(id:$id) {
            fightRankings(difficulty:$d, page:$page, metric:speed)
          }
        }
      }`,
      { id: encounterID, d: 5, page },
    );
    const batch = rank.worldData.encounter.fightRankings?.rankings || [];
    if (!batch.length) break;
    rows.push(...batch);
  }
  return rows;
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

function clusterOcc(kills, spellIds, minFrac = 0.5) {
  const times = [];
  for (const k of kills) {
    for (const c of k.casts) {
      if (spellIds.includes(c.spellId)) times.push(Math.round(c.sec));
    }
  }
  times.sort((a, b) => a - b);
  const clusters = [];
  for (const t of times) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(median(last) - t) < 12) last.push(t);
    else clusters.push([t]);
  }
  return clusters
    .filter((c) => c.length >= Math.ceil(kills.length * minFrac))
    .map((c) => ({
      timeSec: median(c),
      n: c.length,
      spellId: spellIds[0],
    }));
}

function hasSpell(k, spellIds) {
  return k.casts.some((c) => spellIds.includes(c.spellId));
}

async function pickKills(encounterID, opts) {
  const {
    want = 4,
    minDur = 0,
    maxDur = 900,
    requireSpellIds = [],
    preferLonger = false,
  } = opts;
  const rows = await rankingRows(encounterID, 8);
  console.log(`  rankings scanned: ${rows.length}`);

  const candidates = [];
  for (const row of rows) {
    const code = row.report?.code;
    const fightID = row.report?.fightID;
    if (!code || !fightID) continue;
    process.stdout.write(`  ${code}#${fightID}… `);
    try {
      const k = await fightCasts(code, fightID, encounterID);
      if (!k) {
        console.log("skip");
        continue;
      }
      const okDur = k.durationSec >= minDur && k.durationSec <= maxDur;
      const okSpell =
        !requireSpellIds.length || hasSpell(k, requireSpellIds);
      console.log(
        `${fmt(k.durationSec)}${okDur && okSpell ? "" : " (reject)"}`,
      );
      if (okDur && okSpell) candidates.push(k);
      if (candidates.length >= want * 3) break;
    } catch (e) {
      console.log("err", String(e.message).slice(0, 80));
    }
  }

  candidates.sort((a, b) =>
    preferLonger ? b.durationSec - a.durationSec : a.durationSec - b.durationSec,
  );
  // Prefer middle of the band for prog: sort by distance from mid target.
  const mid = (minDur + maxDur) / 2;
  candidates.sort(
    (a, b) =>
      Math.abs(a.durationSec - mid) - Math.abs(b.durationSec - mid),
  );
  return candidates.slice(0, want);
}

function preserveMeta(oldWin, timeSec, ability, spellId, extra = {}) {
  return {
    id: oldWin?.id,
    timeSec,
    ability,
    abilitySpellId: spellId,
    trigger: `WCL ${fmt(timeSec)}`,
    severity: oldWin?.severity ?? "raid",
    category: oldWin?.category ?? "throughput",
    phase: oldWin?.phase ?? 1,
    assignCd: oldWin?.assignCd !== false,
    ...(oldWin?.suggestPersonals ? { suggestPersonals: true } : {}),
    ...(oldWin?.note ? { note: oldWin.note } : {}),
    ...extra,
  };
}

// ---------- Nek'zali ----------
console.log("\n######## Nek'zali Mythic ########");
const nekOld = JSON.parse(
  fs.readFileSync("data/bosses/nekzali-mythic.json", "utf8"),
);
const PYRE = [1294742, 1289855];
const INVOKE = [1299673];
const AWAKEN = [1295124];
const IGN = [1285681, 1293664, 1293660];
const BURN = [1297624];
const BARRAGE = [1284103];

const nekKills = await pickKills(3470, {
  want: 4,
  minDur: 330, // ~5:30+ so Pyre/Invoke exist
  maxDur: 480, // ~8:00 prog ceiling
  requireSpellIds: PYRE,
  preferLonger: true,
});
if (nekKills.length < 2) {
  console.log(
    "Not enough prog-length Nek'zali kills with Pyre; widening to 300–540s…",
  );
  nekKills.push(
    ...(await pickKills(3470, {
      want: 4 - nekKills.length,
      minDur: 300,
      maxDur: 540,
      requireSpellIds: PYRE,
    })),
  );
}
console.log(
  `Using ${nekKills.length} kills: ${nekKills.map((k) => fmt(k.durationSec)).join(", ")}`,
);

function takeTemplate(preds) {
  return nekOld.windows.find(preds) || null;
}

const nekWindows = [];
function pushOccs(spellIds, name, templatePred, mapOcc) {
  const occs = clusterOcc(nekKills, spellIds);
  occs.forEach((o, i) => {
    const tpl =
      (mapOcc && mapOcc(i, o)) ||
      takeTemplate((w) => templatePred(w, i, o)) ||
      takeTemplate((w) => w.abilitySpellId && spellIds.includes(w.abilitySpellId));
    const ability = `${name} #${i + 1}`;
    const id =
      tpl?.id &&
      nekOld.windows.filter((w) => spellIds.includes(w.abilitySpellId)).length >=
        i + 1
        ? nekOld.windows.filter((w) => spellIds.includes(w.abilitySpellId))[i]?.id
        : `nkm-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${i + 1}`;
    nekWindows.push({
      ...preserveMeta(tpl, o.timeSec, ability, o.spellId),
      id: id || `nkm-${slug(name)}${i + 1}`,
      ability:
        name === "Invoke"
          ? `Invoke #${i + 1} (+ Ritual Burn)`
          : name === "Ritual of Awakening"
            ? "Ritual of Awakening"
            : ability,
    });
  });
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 14);
}

// Build in fight order from clustered times
{
  const parts = [
    ...clusterOcc(nekKills, IGN).map((o, i) => ({
      ...o,
      kind: "ign",
      i,
      name: "Soulcoil Ignition",
      ids: IGN,
    })),
    ...clusterOcc(nekKills, BURN).map((o, i) => ({
      ...o,
      kind: "burn",
      i,
      name: "Ritual Burn",
      ids: BURN,
    })),
    ...clusterOcc(nekKills, BARRAGE).map((o, i) => ({
      ...o,
      kind: "barrage",
      i,
      name: "Possession Barrage",
      ids: BARRAGE,
    })),
    ...clusterOcc(nekKills, AWAKEN).map((o, i) => ({
      ...o,
      kind: "awaken",
      i,
      name: "Ritual of Awakening",
      ids: AWAKEN,
    })),
    ...clusterOcc(nekKills, PYRE).map((o, i) => ({
      ...o,
      kind: "pyre",
      i,
      name: "Hungering Pyre",
      ids: PYRE,
    })),
    ...clusterOcc(nekKills, INVOKE).map((o, i) => ({
      ...o,
      kind: "invoke",
      i,
      name: "Invoke",
      ids: INVOKE,
    })),
  ].sort((a, b) => a.timeSec - b.timeSec);

  // Skip Ritual Burn when it overlaps Ignition within 8s (same CD window)
  const filtered = [];
  for (const p of parts) {
    if (p.kind === "burn") {
      const nearIgn = parts.some(
        (x) => x.kind === "ign" && Math.abs(x.timeSec - p.timeSec) <= 8,
      );
      if (nearIgn && p.i === 0) {
        // keep opener burn as assignCd:false companion — handled below
      }
    }
    filtered.push(p);
  }

  const byKindCount = {};
  for (const p of filtered) {
    byKindCount[p.kind] = (byKindCount[p.kind] || 0) + 1;
    const n = byKindCount[p.kind];
    const oldSame = nekOld.windows.filter((w) => {
      if (p.kind === "ign") return /Ignition/i.test(w.ability);
      if (p.kind === "burn") return /Ritual Burn/i.test(w.ability);
      if (p.kind === "barrage") return /Barrage/i.test(w.ability);
      if (p.kind === "awaken") return /Awakening/i.test(w.ability);
      if (p.kind === "pyre") return /Pyre/i.test(w.ability);
      if (p.kind === "invoke") return /Invoke/i.test(w.ability);
      return false;
    });
    const tpl = oldSame[n - 1] || oldSame[0] || null;

    // Drop redundant mid-fight Ritual Burn if Ignition is the CD call
    if (p.kind === "burn" && n > 1) {
      const nearIgn = filtered.some(
        (x) => x.kind === "ign" && Math.abs(x.timeSec - p.timeSec) <= 10,
      );
      if (nearIgn) continue;
    }

    let ability =
      p.kind === "awaken"
        ? "Ritual of Awakening"
        : p.kind === "invoke"
          ? `Invoke #${n} (+ Ritual Burn)`
          : `${p.name} #${n}`;
    let assignCd = tpl?.assignCd !== false;
    if (p.kind === "burn" && n === 1) assignCd = false;

    const id =
      tpl?.id ||
      `nkm-${p.kind}${n}`;

    const win = preserveMeta(tpl, p.timeSec, ability, p.spellId, {
      id,
      assignCd,
    });
    if (p.kind === "pyre" && n === 1) win.suggestPersonals = true;
    if (p.kind === "burn" && n === 1) {
      win.note = "Paired with opener Ignition.";
      win.severity = "raid";
      win.category = "defensive";
    }
    nekWindows.push(win);
  }
}

nekWindows.sort((a, b) => a.timeSec - b.timeSec || a.ability.localeCompare(b.ability));
const nekDurations = nekKills.map((k) => k.durationSec);
const nekBest = [...nekKills].sort((a, b) => a.durationSec - b.durationSec)[0];
const nekOut = {
  ...nekOld,
  source: `WCL Mythic prog consensus — ${nekKills.length} kills (~${fmt(Math.min(...nekDurations))}–${fmt(Math.max(...nekDurations))}) with Hungering Pyre. Rebuilt for guild prog (not race-only speed).`,
  sourceUrl: nekBest.url,
  enrageSec: Math.ceil(median(nekDurations) / 30) * 30 + 60,
  enrageName: `Kill target (~${fmt(Math.ceil(median(nekDurations) / 30) * 30 + 60)} speed)`,
  windows: nekWindows,
};
fs.writeFileSync(
  "data/bosses/nekzali-mythic.json",
  JSON.stringify(nekOut, null, 2) + "\n",
);
console.log(
  `Wrote nekzali-mythic.json — ${nekWindows.length} windows, enrage ${fmt(nekOut.enrageSec)}`,
);
for (const w of nekWindows) {
  console.log(`  ${fmt(w.timeSec)}  ${w.ability}`);
}

// ---------- Lost Explorers ----------
console.log("\n######## Lost Explorers Mythic ########");
const expOld = JSON.parse(
  fs.readFileSync("data/bosses/lost-explorers-mythic.json", "utf8"),
);
const expKills = await pickKills(3497, {
  want: 4,
  minDur: 280,
  maxDur: 420,
});
console.log(
  `Using ${expKills.length} kills: ${expKills.map((k) => fmt(k.durationSec)).join(", ")}`,
);

const THUD = [1296094, 1296133, 1296135, 1296095];
const SPIN = [1296062];
const SHARDS = [1295854, 1310616];
const COMMAND = [1297022, 1297024, 1296975];
const WHISPERS = [1301667];

// Remap each existing window to nearest WCL cast of compatible spell ids
function nearestTime(kills, spellIds, target) {
  const occs = clusterOcc(kills, spellIds, 0.4);
  if (!occs.length) return null;
  let best = null;
  for (const o of occs) {
    const d = Math.abs(o.timeSec - target);
    if (!best || d < best.d) best = { ...o, d };
  }
  return best && best.d <= 40 ? best : null;
}

const usedOcc = new Map(); // spellKey -> Set of times used
function claimNearest(spellIds, target) {
  const key = spellIds.slice().sort().join(",");
  const occs = clusterOcc(expKills, spellIds, 0.4);
  const used = usedOcc.get(key) || new Set();
  let best = null;
  for (const o of occs) {
    if ([...used].some((t) => Math.abs(t - o.timeSec) < 8)) continue;
    const d = Math.abs(o.timeSec - target);
    if (!best || d < best.d) best = { ...o, d };
  }
  if (!best || best.d > 45) return null;
  used.add(best.timeSec);
  usedOcc.set(key, used);
  return best;
}

const expWindows = [];
for (const w of expOld.windows) {
  let ids = w.abilitySpellId ? [w.abilitySpellId] : [];
  if (/Shell Spin/i.test(w.ability)) ids = SPIN;
  else if (/Shredding Shards/i.test(w.ability)) ids = SHARDS;
  else if (/Command/i.test(w.ability)) ids = COMMAND;
  else if (/Mighty Thud/i.test(w.ability)) ids = THUD;
  else if (/Dark Whispers/i.test(w.ability)) ids = WHISPERS;

  const hit = claimNearest(ids, w.timeSec);
  if (!hit) {
    console.log(`  drop ${w.ability} @ ${fmt(w.timeSec)} — no WCL cast`);
    continue;
  }
  expWindows.push({
    ...w,
    timeSec: hit.timeSec,
    abilitySpellId: hit.spellId,
    trigger: `WCL ${fmt(hit.timeSec)}`,
  });
}

// Add extra mythic spins present in logs but missing from planner
const spinOccs = clusterOcc(expKills, SPIN, 0.5);
const plannedSpins = new Set(
  expWindows.filter((w) => /Shell Spin/i.test(w.ability)).map((w) => w.timeSec),
);
let spinN =
  expWindows.filter((w) => /Shell Spin/i.test(w.ability)).length + 1;
for (const o of spinOccs) {
  if ([...plannedSpins].some((t) => Math.abs(t - o.timeSec) < 10)) continue;
  // only add if in mid/late fight and assignCd-worthy spacing
  if (o.timeSec < 60) continue;
  const tpl = expOld.windows.find((w) => /Shell Spin/i.test(w.ability));
  expWindows.push({
    ...preserveMeta(tpl, o.timeSec, `Shell Spin #${spinN}`, o.spellId, {
      id: `lem-shell-spin${spinN}`,
      severity: "raid",
      category: "throughput",
      assignCd: true,
      note: "Extra Mythic spin from current WCL consensus.",
    }),
  });
  spinN++;
}

expWindows.sort((a, b) => a.timeSec - b.timeSec || a.ability.localeCompare(b.ability));
const expDurations = expKills.map((k) => k.durationSec);
const expBest = [...expKills].sort((a, b) => a.durationSec - b.durationSec)[0];
const expOut = {
  ...expOld,
  source: `WCL Mythic consensus — ${expKills.length} kills (~${fmt(Math.min(...expDurations))}–${fmt(Math.max(...expDurations))}). Windows remapped to current cast times; Mighty Thud / Command spell ids refreshed.`,
  sourceUrl: expBest.url,
  enrageSec: Math.ceil(median(expDurations) / 30) * 30 + 60,
  enrageName: `Kill target (~${fmt(Math.ceil(median(expDurations) / 30) * 30 + 60)} speed)`,
  windows: expWindows,
};
fs.writeFileSync(
  "data/bosses/lost-explorers-mythic.json",
  JSON.stringify(expOut, null, 2) + "\n",
);
console.log(
  `Wrote lost-explorers-mythic.json — ${expWindows.length} windows, enrage ${fmt(expOut.enrageSec)}`,
);
for (const w of expWindows) {
  console.log(`  ${fmt(w.timeSec)}  ${w.ability}  (${w.abilitySpellId})`);
}

fs.writeFileSync(
  "scripts/wcl-guild-mythic-rebuild.json",
  JSON.stringify(
    {
      nekzali: nekKills.map((k) => ({
        url: k.url,
        duration: k.durationSec,
      })),
      explorers: expKills.map((k) => ({
        url: k.url,
        duration: k.durationSec,
      })),
    },
    null,
    2,
  ),
);
console.log("\nDone.");
