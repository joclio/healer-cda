import { describe, expect, it } from "vitest";
import { toNsrtNote, toTextNote, toViserioNote } from "@/export/notes";
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
  it("emits NSRT import header + reminder lines NSRT accepts", () => {
    const plan: Plan = {
      ...basePlan,
      personalWindowIds: ["w1"],
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
    const lines = nsrt.split("\n");
    expect(lines[0]).toBe(
      "EncounterID:42;Difficulty:Heroic;Name:Test Boss;",
    );
    expect(nsrt).toContain("tag:everyone");
    expect(nsrt).toContain("tag:MainTank");
    expect(nsrt).not.toContain("tag:{");
    expect(nsrt).toContain("spellid:97462");
    expect(nsrt).toContain("MainTank Rallying Cry (Raid) @ Raid Hit");
    // Reminder rows must not repeat EncounterID or NSRT skips them
    expect(lines.slice(1).every((l) => !l.includes("EncounterID:"))).toBe(
      true,
    );
  });

  it("always uses ph:1 (pull-relative times, not guide phases)", () => {
    const phased: Boss = {
      ...boss,
      windows: [
        { ...boss.windows[0], phase: 2 },
        { ...boss.windows[1], phase: 3 },
      ],
    };
    const plan: Plan = {
      ...basePlan,
      noteWindowIds: ["w1", "w2"],
      assignments: [
        {
          id: "a1",
          windowId: "w1",
          healerId: "h1",
          spellId: "spirit-link",
          timeSec: 30,
        },
      ],
    };
    const nsrt = toNsrtNote(plan, phased);
    expect(nsrt).toContain("ph:1");
    expect(nsrt).not.toContain("ph:2");
    expect(nsrt).not.toContain("ph:3");
  });
});

describe("toViserioNote", () => {
  it("emits spellid lines without text so Viserio shows spell icons", () => {
    const plan: Plan = {
      ...basePlan,
      personalWindowIds: ["w1"],
      noteWindowIds: ["w1", "w2"],
      assignments: [
        {
          id: "a1",
          windowId: "w1",
          healerId: "h1",
          spellId: "spirit-link",
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
    const note = toViserioNote(plan, boss);
    expect(note).toContain("spellid:98008");
    expect(note).toContain("spellid:102342");
    expect(note).toContain("tag:Shammy");
    expect(note).toContain("glowunit:MainTank");
    expect(note).toContain("tag:everyone");
    expect(note).toContain("text:Raid personals");
    // Spell CD lines must not carry a text: field (Viserio treats those as notes)
    const spellLines = note
      .split("\n")
      .filter((l) => l.includes("spellid:"));
    expect(spellLines.length).toBe(2);
    expect(spellLines.every((l) => !l.includes("text:"))).toBe(true);
    expect(note).not.toContain("Spirit Link Totem @");
  });

  it("skips bare ability rows with no assignment", () => {
    const plan: Plan = {
      ...basePlan,
      noteWindowIds: ["w1", "w2"],
      assignments: [],
      personalWindowIds: [],
    };
    const note = toViserioNote(plan, boss);
    expect(note.split("\n")).toEqual([
      "EncounterID:42;Difficulty:Heroic;Name:Test Boss;",
    ]);
  });
});
