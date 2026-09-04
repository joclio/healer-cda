import { describe, expect, it } from "vitest";
import { formatTime, parseTimeInput, withTimeOverrides } from "@/domain/time";
import type { Boss } from "@/domain/types";

const boss: Boss = {
  id: "t",
  name: "Test",
  shortName: "Test",
  encounterId: 1,
  group: "raid",
  difficulty: "Heroic",
  order: 1,
  source: "test",
  windows: [
    {
      id: "w1",
      timeSec: 90,
      ability: "Hit",
      trigger: "t",
      severity: "raid",
      category: "throughput",
    },
  ],
};

describe("parseTimeInput", () => {
  it("parses mm:ss and plain seconds", () => {
    expect(parseTimeInput("1:30")).toBe(90);
    expect(parseTimeInput("90")).toBe(90);
    expect(parseTimeInput("0:05")).toBe(5);
  });

  it("rejects empty / invalid", () => {
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("1:2:3")).toBeNull();
    expect(parseTimeInput("abc")).toBeNull();
  });
});

describe("formatTime", () => {
  it("formats seconds as m:ss", () => {
    expect(formatTime(90)).toBe("1:30");
    expect(formatTime(5)).toBe("0:05");
  });
});

describe("withTimeOverrides", () => {
  it("overrides matching window times", () => {
    const next = withTimeOverrides(boss, { w1: 100 });
    expect(next.windows[0].timeSec).toBe(100);
    expect(boss.windows[0].timeSec).toBe(90);
  });
});
