import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { BOSSES } from "@/data/catalog";

const WINDOW_FIELDS = ["id", "timeSec", "ability", "trigger", "severity", "category"] as const;
const SEVERITY = new Set(["tank", "raid", "critical"]);
const CATEGORY = new Set(["throughput", "defensive", "external"]);

describe("boss catalog", () => {
  it("registers every boss file with required window fields and unique ids", () => {
    const dir = path.join(process.cwd(), "data", "bosses");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const fileIds: string[] = [];

    for (const file of files) {
      const boss = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
        id?: unknown;
        name?: unknown;
        shortName?: unknown;
        source?: unknown;
        windows?: unknown;
      };
      const id = boss.id;
      expect(typeof id, file).toBe("string");
      expect(id, file).toBe(file.replace(/\.json$/, ""));
      expect(typeof boss.name, String(id)).toBe("string");
      expect(typeof boss.shortName, String(id)).toBe("string");
      expect(typeof boss.source, String(id)).toBe("string");
      expect(Array.isArray(boss.windows), String(id)).toBe(true);

      const seen = new Set<string>();
      for (const window of boss.windows as Record<string, unknown>[]) {
        for (const field of WINDOW_FIELDS) {
          if (field === "timeSec") continue;
          expect(window[field], `${id} ${String(window.id)} ${field}`).toBeTruthy();
        }
        expect(SEVERITY.has(String(window.severity)), `${id} ${window.id}`).toBe(true);
        expect(CATEGORY.has(String(window.category)), `${id} ${window.id}`).toBe(true);
        expect(typeof window.timeSec, `${id} ${window.id}`).toBe("number");
        expect(seen.has(String(window.id)), `${id} duplicate ${window.id}`).toBe(false);
        seen.add(String(window.id));
      }
      fileIds.push(String(id));
    }

    expect([...fileIds].sort()).toEqual(BOSSES.map((b) => b.id).sort());
  });
});
