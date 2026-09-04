import { describe, expect, it } from "vitest";
import { SPELLS } from "@/data/catalog";
import {
  assignOrMoveSpell,
  autoAssign,
  autoAssignPersonals,
  cooldownConflict,
  uncoveredWindows,
} from "@/domain/autoAssign";
import type { Boss, Healer, Tank } from "@/domain/types";

const boss: Boss = {
  id: "test-boss",
  name: "Test Boss",
  shortName: "Test",
  encounterId: 1,
  group: "raid",
  difficulty: "Heroic",
  order: 1,
  source: "unit test",
  enrageSec: 300,
  enrageName: "Enrage",
  windows: [
    {
      id: "w1",
      timeSec: 30,
      ability: "Raid Hit",
      trigger: "pull +30s",
      severity: "raid",
      category: "throughput",
    },
    {
      id: "w2",
      timeSec: 50,
      ability: "Tank Hit",
      trigger: "pull +50s",
      severity: "tank",
      category: "external",
    },
    {
      id: "w3",
      timeSec: 40,
      ability: "Critical Hit",
      trigger: "pull +40s",
      severity: "critical",
      category: "defensive",
    },
    {
      id: "w4",
      timeSec: 50,
      ability: "Too Soon",
      trigger: "pull +50s",
      severity: "raid",
      category: "throughput",
    },
  ],
};

const roster: Healer[] = [
  { id: "h1", name: "Shammy", spec: "resto-shaman" },
  { id: "h2", name: "Disco", spec: "disc-priest" },
  { id: "h3", name: "Tree", spec: "resto-druid" },
];

const tanks: Tank[] = [
  { id: "t1", name: "MainTank" },
  { id: "t2", name: "OffTank" },
];

describe("autoAssign", () => {
  it("assigns coverage across windows", () => {
    const plan = autoAssign(boss, roster, SPELLS, tanks);
    expect(plan.length).toBeGreaterThanOrEqual(3);
    expect(plan.every((a) => roster.some((h) => h.id === a.healerId))).toBe(
      true,
    );
  });

  it("respects cooldowns on the same spell", () => {
    const plan = autoAssign(
      boss,
      [{ id: "h1", name: "OnlySham", spec: "resto-shaman" }],
      SPELLS,
      tanks,
    );
    const spiritLinks = plan.filter((a) => a.spellId === "spirit-link");
    if (spiritLinks.length >= 2) {
      const [a, b] = spiritLinks.sort((x, y) => x.timeSec - y.timeSec);
      expect(b.timeSec - a.timeSec).toBeGreaterThanOrEqual(180);
    }
  });

  it("returns empty for empty roster", () => {
    expect(autoAssign(boss, [], SPELLS, tanks)).toEqual([]);
  });

  it("treats raid personals as covering a CD window", () => {
    const uncovered = uncoveredWindows(boss, [], undefined, ["w1"]);
    expect(uncovered.map((w) => w.id)).not.toContain("w1");
  });

  it("autoAssignPersonals uses soak / suggestPersonals windows", () => {
    const withSoak: Boss = {
      ...boss,
      windows: [
        {
          ...boss.windows[0],
          id: "soak1",
          note: "Group soak — soft CD if the raid is low.",
        },
        {
          ...boss.windows[1],
          id: "tank1",
          note: "Tank hit — external.",
        },
      ],
    };
    expect(autoAssignPersonals(withSoak)).toEqual(["soak1"]);
  });

  it("reports uncovered windows", () => {
    const uncovered = uncoveredWindows(boss, []);
    expect(uncovered).toHaveLength(boss.windows.length);
  });

  it("skips info-only windows (assignCd: false)", () => {
    const withInfo: Boss = {
      ...boss,
      windows: [
        ...boss.windows,
        {
          id: "info",
          timeSec: 10,
          ability: "Dodge This",
          trigger: "pull +10s",
          severity: "raid",
          category: "defensive",
          assignCd: false,
        },
      ],
    };
    const plan = autoAssign(withInfo, roster, SPELLS, tanks);
    expect(plan.some((a) => a.windowId === "info")).toBe(false);
    expect(uncoveredWindows(withInfo, []).some((w) => w.id === "info")).toBe(
      false,
    );
  });

  it("respects explicit cdWindowIds over boss defaults", () => {
    const plan = autoAssign(boss, roster, SPELLS, tanks, ["w2"]);
    expect(plan.every((a) => a.windowId === "w2")).toBe(true);
    expect(uncoveredWindows(boss, [], ["w1"]).map((w) => w.id)).toEqual([
      "w1",
    ]);
  });

  it("assigns tank targets on externals and rotates them", () => {
    const plan = autoAssign(boss, roster, SPELLS, tanks);
    const externals = plan.filter((a) => a.tankId);
    expect(externals.length).toBeGreaterThanOrEqual(1);
    expect(externals.every((a) => tanks.some((t) => t.id === a.tankId))).toBe(
      true,
    );
    if (externals.length >= 2) {
      expect(new Set(externals.map((a) => a.tankId)).size).toBeGreaterThan(1);
    }
  });
});

describe("assignOrMoveSpell", () => {
  const wEarly = boss.windows[0]; // 30s
  const wLate = {
    ...boss.windows[0],
    id: "w-late",
    timeSec: 100,
    ability: "Later Hit",
  };

  it("adds multiple CDs on the same window", () => {
    let plan = assignOrMoveSpell(
      [],
      wEarly,
      "h1",
      "spirit-link",
      tanks,
      SPELLS,
    );
    plan = assignOrMoveSpell(
      plan,
      wEarly,
      "h2",
      "power-word-barrier",
      tanks,
      SPELLS,
    );
    expect(plan.filter((a) => a.windowId === wEarly.id)).toHaveLength(2);
  });

  it("moves a conflicting CD to the new window", () => {
    let plan = assignOrMoveSpell(
      [],
      wEarly,
      "h1",
      "spirit-link",
      tanks,
      SPELLS,
    );
    expect(plan[0].windowId).toBe(wEarly.id);
    plan = assignOrMoveSpell(plan, wLate, "h1", "spirit-link", tanks, SPELLS);
    expect(plan.filter((a) => a.spellId === "spirit-link")).toHaveLength(1);
    expect(plan[0].windowId).toBe(wLate.id);
    expect(plan[0].timeSec).toBe(100);
  });

  it("allows the same CD after cooldown returns", () => {
    const wFar = { ...wEarly, id: "w-far", timeSec: 220, ability: "Far" };
    let plan = assignOrMoveSpell(
      [],
      wEarly,
      "h1",
      "spirit-link",
      tanks,
      SPELLS,
    );
    plan = assignOrMoveSpell(plan, wFar, "h1", "spirit-link", tanks, SPELLS);
    expect(plan.filter((a) => a.spellId === "spirit-link")).toHaveLength(2);
  });
});

describe("cooldownConflict", () => {
  it("detects uses closer than cooldown", () => {
    expect(cooldownConflict(30, 100, 180)).toBe(true);
    expect(cooldownConflict(30, 210, 180)).toBe(false);
  });
});
