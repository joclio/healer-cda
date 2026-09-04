import type { Boss, DamageWindow } from "@/domain/types";

/** Apply per-window time overrides (seconds from pull). */
export function withTimeOverrides(
  boss: Boss,
  overrides: Record<string, number>,
): Boss {
  if (Object.keys(overrides).length === 0) return boss;
  return {
    ...boss,
    windows: boss.windows.map((w) =>
      overrides[w.id] !== undefined
        ? { ...w, timeSec: overrides[w.id] }
        : w,
    ),
  };
}

export function sortedWindows(windows: DamageWindow[]): DamageWindow[] {
  return [...windows].sort((a, b) => a.timeSec - b.timeSec);
}

/** Parse mm:ss or plain seconds. */
export function parseTimeInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, Math.round(sec % 60));
  return `${m}:${s.toString().padStart(2, "0")}`;
}
