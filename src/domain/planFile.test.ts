import { describe, expect, it } from "vitest";
import { applyPlanFile, parsePlanFile, toPlanFile } from "@/domain/planFile";
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
    expect(applied.skipped).toBe(0);
  });

  it("counts assignments whose names are not on this roster", () => {
    const file = toPlanFile(plan, {});
    const applied = applyPlanFile(JSON.stringify(file), boss, [], [], []);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.plan.assignments).toEqual([]);
    expect(applied.skipped).toBe(1);
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
