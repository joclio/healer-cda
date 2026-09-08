import { describe, expect, it } from "vitest";
import { migrateStoredPlans, PLANS_VERSION } from "@/components/plannerStorage";
import { getBoss } from "@/data/catalog";
import { defaultNoteWindowIds } from "@/domain/types";

describe("migrateStoredPlans", () => {
  it("lifts a v0 boss map and drops smoke-bomb", () => {
    const plans = migrateStoredPlans({
      demo: {
        assignments: [
          { id: "a", windowId: "w", spellId: "healing-tide-totem", timeSec: 10 },
          { id: "b", windowId: "w", spellId: "smoke-bomb", timeSec: 20 },
        ],
      },
    });
    expect(plans.demo.assignments.map((a) => a.spellId)).toEqual([
      "healing-tide-totem",
    ]);
    expect(plans.demo.noteWindowIds).toEqual([]);
    expect(plans.demo.timeOverrides).toEqual({});
  });

  it("fills default note windows when a known boss omits them", () => {
    const boss = getBoss("lost-explorers");
    expect(boss).toBeTruthy();
    const plans = migrateStoredPlans({
      "lost-explorers": { assignments: [] },
    });
    expect(plans["lost-explorers"].noteWindowIds).toEqual(
      defaultNoteWindowIds(boss!),
    );
  });

  it("reads a v1 envelope and ignores a future version", () => {
    const current = migrateStoredPlans({
      version: PLANS_VERSION,
      plans: {
        demo: {
          assignments: [],
          noteWindowIds: ["w"],
          personalWindowIds: [],
          timeOverrides: {},
        },
      },
    });
    expect(current.demo.noteWindowIds).toEqual(["w"]);
    expect(migrateStoredPlans({ version: PLANS_VERSION + 1, plans: { demo: {} } })).toEqual(
      {},
    );
  });
});
