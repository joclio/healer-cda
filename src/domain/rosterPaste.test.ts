import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseRosterPaste } from "@/domain/rosterPaste";

describe("parseRosterPaste", () => {
  it("parses WowAudit-style TSV with role + spec", () => {
    const raw = [
      "Name\tRole\tClass\tSpec",
      "Nightmid\tHealer\tShaman\tRestoration",
      "Changpriesto\tHealer\tPriest\tDiscipline",
      "Eglantina\tTank\tWarrior\tProtection",
      "Boomkin\tDps\tDruid\tBalance",
    ].join("\n");
    const r = parseRosterPaste(raw);
    expect(r.healers).toEqual([
      { name: "Nightmid", spec: "resto-shaman" },
      { name: "Changpriesto", spec: "disc-priest" },
    ]);
    expect(r.tanks).toEqual([{ name: "Eglantina", class: "warrior" }]);
    expect(r.skipped).toBe(1);
  });

  it("parses headerless name + spec lines", () => {
    const r = parseRosterPaste("Alice\tHoly Paladin\nBob\tMistweaver");
    expect(r.healers.map((h) => h.spec)).toEqual([
      "holy-paladin",
      "mistweaver",
    ]);
  });

  it("parses CSV and dedupes names", () => {
    const r = parseRosterPaste(
      "character,role,spec\nFoo,Healer,Preservation\nFoo,Healer,Preservation",
    );
    expect(r.healers).toEqual([{ name: "Foo", spec: "preservation" }]);
  });

  it("parses Titan Inc WowAudit Main Roster CSV", () => {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "scripts/titan-roster-sample.csv"),
      "utf8",
    );
    const r = parseRosterPaste(raw);
    expect(r.healers.map((h) => h.name)).toEqual([
      "Sekungfu",
      "Laks",
      "Drickie",
      "Cebøla",
      "Elding",
      "Dramarys",
    ]);
    expect(r.healers.find((h) => h.name === "Sekungfu")?.spec).toBe(
      "mistweaver",
    );
    expect(r.healers.find((h) => h.name === "Dramarys")?.spec).toBe(
      "preservation",
    );
    // Shadow priest under Ranged must not import as healer.
    expect(r.healers.some((h) => h.name === "Unfo")).toBe(false);
    expect(r.tanks).toEqual([
      { name: "Poseïdom", class: "paladin" },
      { name: "Jocí", class: "paladin" },
      { name: "Gnomeghust", class: "death-knight" },
    ]);
  });
});
