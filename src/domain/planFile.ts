import { makeAssignmentId } from "@/domain/autoAssign";
import type {
  Assignment,
  Boss,
  Healer,
  Plan,
  Tank,
  UtilityCaster,
} from "@/domain/types";

export const PLAN_FILE_VERSION = 1;

export type PlanFileAssignment = {
  windowId: string;
  spellId: string;
  timeSec: number;
  healerId?: string;
  healerName?: string;
  utilityId?: string;
  utilityName?: string;
  tankId?: string;
  tankName?: string;
};

/** Portable fight plan. Assignee names let another browser remap onto its roster. */
export type PlanFile = {
  version: typeof PLAN_FILE_VERSION;
  bossId: string;
  assignments: PlanFileAssignment[];
  noteWindowIds: string[];
  personalWindowIds: string[];
  timeOverrides: Record<string, number>;
};

export type SavedPlanSlice = {
  assignments: Assignment[];
  noteWindowIds: string[];
  personalWindowIds: string[];
  timeOverrides: Record<string, number>;
};

function byName<T extends { id: string; name: string }>(
  list: T[],
  id: string | undefined,
  name: string | undefined,
): T | undefined {
  if (id) {
    const hit = list.find((item) => item.id === id);
    if (hit) return hit;
  }
  const key = name?.trim().toLowerCase();
  if (!key) return undefined;
  return list.find((item) => item.name.trim().toLowerCase() === key);
}

export function toPlanFile(
  plan: Plan,
  timeOverrides: Record<string, number>,
): PlanFile {
  return {
    version: PLAN_FILE_VERSION,
    bossId: plan.bossId,
    assignments: plan.assignments.map((a) => {
      const healer = a.healerId
        ? plan.roster.find((h) => h.id === a.healerId)
        : undefined;
      const utility = a.utilityId
        ? plan.utilities.find((u) => u.id === a.utilityId)
        : undefined;
      const tankCaster =
        a.utilityId && !utility
          ? plan.tanks.find((t) => t.id === a.utilityId)
          : undefined;
      const tank = a.tankId
        ? plan.tanks.find((t) => t.id === a.tankId)
        : undefined;
      return {
        windowId: a.windowId,
        spellId: a.spellId,
        timeSec: a.timeSec,
        healerId: a.healerId,
        healerName: healer?.name,
        utilityId: a.utilityId,
        utilityName: utility?.name ?? tankCaster?.name,
        tankId: a.tankId,
        tankName: tank?.name,
      };
    }),
    noteWindowIds: plan.noteWindowIds,
    personalWindowIds: plan.personalWindowIds,
    timeOverrides,
  };
}

export function parsePlanFile(raw: string): PlanFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const file = parsed as Partial<PlanFile>;
  if (file.version !== PLAN_FILE_VERSION || typeof file.bossId !== "string") {
    return null;
  }
  if (!Array.isArray(file.assignments)) return null;
  return {
    version: PLAN_FILE_VERSION,
    bossId: file.bossId,
    assignments: file.assignments.filter(
      (a) =>
        !!a &&
        typeof a === "object" &&
        typeof a.windowId === "string" &&
        typeof a.spellId === "string" &&
        typeof a.timeSec === "number" &&
        a.spellId !== "smoke-bomb",
    ),
    noteWindowIds: Array.isArray(file.noteWindowIds) ? file.noteWindowIds : [],
    personalWindowIds: Array.isArray(file.personalWindowIds)
      ? file.personalWindowIds
      : [],
    timeOverrides:
      file.timeOverrides && typeof file.timeOverrides === "object"
        ? file.timeOverrides
        : {},
  };
}

export function applyPlanFile(
  raw: string,
  boss: Boss,
  roster: Healer[],
  tanks: Tank[],
  utilities: UtilityCaster[],
): { ok: true; plan: SavedPlanSlice; skipped: number } | { ok: false; error: string } {
  const file = parsePlanFile(raw);
  if (!file) return { ok: false, error: "That is not a healer-cda plan file." };
  if (file.bossId !== boss.id) {
    return { ok: false, error: `That plan is for ${file.bossId}, not this fight.` };
  }

  const windows = new Set(boss.windows.map((w) => w.id));
  const sourceTime = new Map(boss.windows.map((w) => [w.id, w.timeSec]));
  const assignments: Assignment[] = [];
  let skipped = 0;

  for (const row of file.assignments) {
    if (!windows.has(row.windowId)) {
      skipped++;
      continue;
    }
    const healer = row.healerId || row.healerName
      ? byName(roster, row.healerId, row.healerName)
      : undefined;
    const utility = row.utilityId || row.utilityName
      ? byName(utilities, row.utilityId, row.utilityName) ??
        byName(tanks, row.utilityId, row.utilityName)
      : undefined;
    const assigneeId = healer?.id ?? utility?.id;
    if (!assigneeId) {
      skipped++;
      continue;
    }
    const tank = row.tankId || row.tankName
      ? byName(tanks, row.tankId, row.tankName)
      : undefined;
    const timeSec = sourceTime.get(row.windowId) ?? row.timeSec;
    assignments.push({
      id: makeAssignmentId(row.windowId, row.spellId, assigneeId),
      windowId: row.windowId,
      spellId: row.spellId,
      timeSec: file.timeOverrides[row.windowId] ?? timeSec,
      healerId: healer?.id,
      utilityId: utility?.id,
      tankId: tank?.id,
    });
  }

  return {
    ok: true,
    skipped,
    plan: {
      assignments,
      noteWindowIds: file.noteWindowIds.filter((id) => windows.has(id)),
      personalWindowIds: file.personalWindowIds.filter((id) => windows.has(id)),
      timeOverrides: Object.fromEntries(
        Object.entries(file.timeOverrides).filter(
          ([id, sec]) => windows.has(id) && typeof sec === "number",
        ),
      ),
    },
  };
}
