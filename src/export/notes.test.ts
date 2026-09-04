import { describe, expect, it } from "vitest";
import { toNsrtNote, toTextNote } from "@/export/notes";
import type { Boss, Plan } from "@/domain/types";

const boss: Boss = {
  id: "t",
  name: "Test Boss",
  shortName: "Test",
  encounterId: 42,
  group: "raid",
  difficulty: "Heroic",
  order: 1,
  source: "test",
  enrageSec: 300,
  enrageName: "Enrage",
  windows: [
    {
      id: "w1",
      timeSec: 30,
      ability: "Raid Hit",
      trigger: "t",
      severity: "raid",
      category: "defensive",
      phase: 1,
    },
    {
      id: "w2",
      timeSec: 60,
      ability: "Tank Hit",
      trigger: "t",
      severity: "tank",
      category: "external",
      phase: 1,
    },
  ],
};

const basePlan: Plan = {
  bossId: boss.id,
  roster: [
    { id: "h1", name: "Shammy", spec: "resto-shaman" },
    { id: "h2", name: "Tree", spec: "resto-druid" },
  ],
  tanks: [{ id: "t1", name: "MainTank", class: "warrior" }],
  utilities: [{ id: "u1", name: "BloodDK", class: "death-knight" }],
  assignments: [],
  noteWindowIds: ["w1", "w2"],
  personalWindowIds: [],
};

describe("toTextNote", () => {
  it("lists personals, healer CD, utility, and tank external", () => {
    const plan: Plan = {
      ...basePlan,
      personalWindowIds: ["w1"],
      assignments: [
        {
          id: "a1",
          windowId: "w1",
          utilityId: "u1",
          spellId: "anti-magic-zone",
          timeSec: 30,
        },
        {
          id: "a2",
          windowId: "w2",
          healerId: "h2",
          spellId: "ironbark",
          timeSec: 60,
          tankId: "t1",
        },
      ],
    };
    const text = toTextNote(plan, boss);
    expect(text).toContain("Raid personals");
    expect(text).toContain("Anti-Magic Zone (Raid) — BloodDK");
    expect(text).toContain("Ironbark (Tank) — Tree → MainTank");
    expect(text).toContain("5:00  Enrage");
  });

  it("shows empty note selection message", () => {
    const plan: Plan = { ...basePlan, noteWindowIds: [] };
    expect(toTextNote(plan, boss)).toContain("(no abilities selected for note)");
  });
});

describe("toNsrtNote", () => {
  it("emits NSRT lines with spell ids and tags", () => {
    const plan: Plan = {
      ...basePlan,
      assignments: [
        {
          id: "a1",
          windowId: "w1",
          utilityId: "t1",
          spellId: "rallying-cry",
          timeSec: 30,
        },
      ],
      noteWindowIds: ["w1"],
    };
    const nsrt = toNsrtNote(plan, boss);
    expect(nsrt).toContain("EncounterID:42");
    expect(nsrt).toContain("spellid:97462");
    expect(nsrt).toContain("tag:{MainTank}");
    expect(nsrt).toContain("MainTank Rallying Cry @ Raid Hit");
  });
});
