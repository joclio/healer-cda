import fs from "fs";

const boss = JSON.parse(fs.readFileSync("data/bosses/ulatek.json", "utf8"));

// Primary casts from longest pull in WoWCombatLog-090326_210408.txt (547s wipe)
const logPrimary = [
  [15, "Mother’s Wrath #1"],
  [20, "Spectral Coils #1"],
  [39, "Mephitic Thrash #1"],
  [48, "Caustic Waves #1"],
  [64, "Submerge #1"],
  [76, "Call of the Serpent #1"],
  [82, "Mother’s Wrath #2"],
  [91, "Mephitic Thrash #2"],
  [100, "Caustic Waves #2"],
  [115, "Spectral Coils #2"],
  [119, "Mother’s Wrath #3"],
  [136, "Rage of the Shackled #1"],
  [164, "Hatching Doom (adds)"],
  [190, "Grasping Fangs"],
  [285, "Rage of the Shackled #2"],
  [313, "Call of the Serpent #2"],
  [326, "Spectral Coils #3"],
  [371, "Call of the Serpent #3"],
  [377, "Mother’s Wrath #4"],
  [392, "Serpent’s Bite #1"],
  [401, "Call of the Serpent #4"],
  [417, "Caustic Waves #3"],
  [430, "Circling Prey #1"],
  [433, "Submerge #2"],
  [446, "Call of the Serpent #5"],
  [452, "Mother’s Wrath #5"],
  [463, "Serpent’s Bite #2"],
  [472, "Caustic Waves #4"],
  [481, "Circling Prey #2"],
  [485, "Submerge #3"],
  [500, "Serpent’s Bite #3"],
  [506, "Call of the Serpent #6"],
  [522, "Caustic Waves #5"],
  [528, "Mother’s Wrath #6"],
  [542, "Circling Prey #3"],
];

function fmt(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

function baseName(name) {
  return name
    .replace(/ #\d+$/, "")
    .replace(/ \(adds\)$/, "")
    .normalize("NFKC");
}

console.log("=== Planner vs longest pull (547s wipe, 9/3 Heroic) ===\n");
console.log(
  "ability".padEnd(34) +
    "planner".padStart(8) +
    "log".padStart(8) +
    "delta".padStart(8) +
    "  status",
);

for (const w of boss.windows) {
  const base = baseName(w.ability);
  const num = (w.ability.match(/#(\d+)/) || [])[1];
  let candidates = logPrimary.filter(([_, name]) => baseName(name) === base);
  if (num) {
    const byNum = candidates.find(([, name]) => name.includes("#" + num));
    if (byNum) candidates = [byNum];
  }
  let best = null;
  for (const c of candidates) {
    const d = Math.abs(c[0] - w.timeSec);
    if (!best || d < best.d) best = { c, d };
  }
  if (!best) {
    console.log(
      w.ability.padEnd(34) +
        fmt(w.timeSec).padStart(8) +
        "—".padStart(8) +
        "".padStart(8) +
        "  NOT IN THIS PULL / NEW",
    );
    continue;
  }
  const delta = best.c[0] - w.timeSec;
  const status =
    Math.abs(delta) <= 2 ? "OK" : Math.abs(delta) <= 5 ? "CLOSE" : "MISMATCH";
  console.log(
    w.ability.padEnd(34) +
      fmt(w.timeSec).padStart(8) +
      fmt(best.c[0]).padStart(8) +
      ((delta >= 0 ? "+" : "") + delta + "s").padStart(8) +
      "  " +
      status,
  );
}

console.log("\n=== Casts after planner timeline (past Circling Prey #2 old wipe) ===");
for (const [t, name] of logPrimary.filter(([t]) => t >= 475)) {
  console.log(fmt(t), name);
}

console.log("\nPlanner enrage:", fmt(boss.enrageSec), boss.enrageName);
console.log(
  "Longest pull: 9:07 (547s) wipe — no Fury Unleashed cast seen; Circling Prey #3 at 9:02",
);
