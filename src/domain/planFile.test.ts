import { describe, expect, it } from "vitest";
import { applyPlanFile, parsePlanFile, planSkipNotice, toPlanFile } from "@/domain/planFile";
import type { Boss, Plan } from "@/domain/types";

const boss: Boss = {
  id: "demo",
  name: "Demo",
  shortName: "Demo",
  encounterId: 1,
  group: "raid",
  difficulty: "Heroic",
  order: 1,
  source: "test",
  windows: [
    {
      id: "w1",
      timeSec: 30,
      ability: "Hit",
      trigger: "cast",
      severity: "raid",
      category: "throughput",
    },
  ],
};

const plan: Plan = {
  bossId: "demo",
  roster: [{ id: "healer-old", name: "Nightmid", spec: "resto-shaman" }],
  tanks: [{ id: "tank-old", name: "Eglantina", class: "warrior" }],
  utilities: [],
  assignments: [
    {
      id: "w1-healing-tide-totem-healer-old",
      windowId: "w1",
      healerId: "healer-old",
      spellId: "healing-tide-totem",
      timeSec: 45,
      tankId: "tank-old",
    },
  ],
  noteWindowIds: ["w1", "gone"],
  personalWindowIds: ["w1"],
};

describe("plan file", () => {
  it("remaps assignees by name onto the current roster", () => {
    const file = toPlanFile(plan, { w1: 45, gone: 9 });
    const applied = applyPlanFile(
      JSON.stringify(file),
      boss,
      [{ id: "healer-new", name: "Nightmid", spec: "resto-shaman" }],
      [{ id: "tank-new", name: "Eglantina", class: "warrior" }],
      [],
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.plan.assignments).toEqual([
      {
        id: "w1-healing-tide-totem-healer-new",
        windowId: "w1",
        healerId: "healer-new",
        spellId: "healing-tide-totem",
        timeSec: 45,
        tankId: "tank-new",
      },
    ]);
    expect(applied.plan.noteWindowIds).toEqual(["w1"]);
    expect(applied.plan.timeOverrides).toEqual({ w1: 45 });
    expect(applied.skippedNames).toBe(0);
    expect(applied.skippedWindows).toBe(0);
  });

  it("counts assignments whose names are not on this roster", () => {
    const file = toPlanFile(plan, {});
    const applied = applyPlanFile(JSON.stringify(file), boss, [], [], []);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.plan.assignments).toEqual([]);
    expect(applied.skippedNames).toBe(1);
    expect(applied.skippedWindows).toBe(0);
    expect(planSkipNotice(applied.skippedNames, applied.skippedWindows)).toBe(
      "1 assignment skipped — 1 name not on this roster.",
    );
  });

  it("counts a removed window separately from a missing name", () => {
    const file = toPlanFile(plan, {});
    file.assignments.push({
      windowId: "gone",
      spellId: "healing-tide-totem",
      timeSec: 10,
      healerName: "Nightmid",
    });
    const applied = applyPlanFile(
      JSON.stringify(file),
      boss,
      [{ id: "healer-new", name: "Nightmid", spec: "resto-shaman" }],
      [],
      [],
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.skippedNames).toBe(0);
    expect(applied.skippedWindows).toBe(1);
    expect(planSkipNotice(applied.skippedNames, applied.skippedWindows)).toBe(
      "1 assignment skipped — 1 unknown window.",
    );
  });

  it("rejects a plan for a different boss", () => {
    const file = toPlanFile(plan, {});
    const applied = applyPlanFile(JSON.stringify(file), {
      ...boss,
      id: "other",
    }, [], [], []);
    expect(applied).toEqual({
      ok: false,
      error: "That plan is for demo, not this fight.",
    });
  });

  it("rejects junk", () => {
    expect(parsePlanFile("{")).toBeNull();
    expect(applyPlanFile("nope", boss, [], [], []).ok).toBe(false);
  });
});
