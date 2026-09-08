import { defaultNoteWindowIds, isHealerSpec, isTankClass, isUtilityClass } from "@/domain/types";
import type { Assignment, Boss, Healer, Tank, UtilityCaster } from "@/domain/types";

export const ROSTER_KEY = "healer-cda-roster";
export const TANKS_KEY = "healer-cda-tanks";
export const UTILITIES_KEY = "healer-cda-utilities";
export const FIGHT_PICKS_KEY = "healer-cda-fight-picks";
export const PLANS_KEY = "healer-cda-plans";
export const LAST_BOSS_KEY = "healer-cda-last-boss";

/** localStorage envelope for `PLANS_KEY`. v0 was a bare bossId → plan map. */
export const PLANS_VERSION = 1;

export type FightPicks = Record<
  string,
  { healerIds: string[]; tankIds: string[]; utilityIds?: string[] }
>;

export type SavedPlan = {
  assignments: Assignment[];
  noteWindowIds: string[];
  personalWindowIds: string[];
  timeOverrides: Record<string, number>;
};

type SavedPlans = Record<string, SavedPlan>;

export function pruneIds(ids: string[], valid: Set<string>): string[] {
  return ids.filter((id) => valid.has(id));
}

export function defaultTankIds(pool: Tank[], saved: string[] | undefined): string[] {
  if (pool.length > 0 && pool.length < 3) return pool.map((t) => t.id);
  if (saved === undefined) return pool.map((t) => t.id);
  const valid = new Set(pool.map((t) => t.id));
  const pruned = pruneIds(saved, valid);
  if (pruned.length === 0 && saved.length > 0 && pool.length > 0) {
    return pool.map((t) => t.id);
  }
  return pruned;
}

function emptyPlan(boss: Boss): SavedPlan {
  return {
    assignments: [],
    noteWindowIds: defaultNoteWindowIds(boss),
    personalWindowIds: [],
    timeOverrides: {},
  };
}

export function loadPlanSlice(
  plans: SavedPlans,
  id: string,
  boss: Boss,
  validUtilityIds?: Set<string>,
): SavedPlan {
  const saved = plans[id];
  if (!saved) return emptyPlan(boss);
  const validWindows = new Set(boss.windows.map((w) => w.id));
  return {
    assignments: (saved.assignments ?? []).filter((a) => {
      if (!validWindows.has(a.windowId)) return false;
      if (a.spellId === "smoke-bomb") return false;
      if (a.utilityId && validUtilityIds && !validUtilityIds.has(a.utilityId)) {
        return false;
      }
      return true;
    }),
    noteWindowIds:
      saved.noteWindowIds !== undefined
        ? pruneIds(saved.noteWindowIds, validWindows)
        : defaultNoteWindowIds(boss),
    personalWindowIds: pruneIds(saved.personalWindowIds ?? [], validWindows),
    timeOverrides: Object.fromEntries(
      Object.entries(saved.timeOverrides ?? {}).filter(([wid]) =>
        validWindows.has(wid),
      ),
    ),
  };
}

export function sanitizeHealers(raw: unknown): Healer[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (h): h is Healer =>
      !!h &&
      typeof h === "object" &&
      typeof (h as Healer).id === "string" &&
      typeof (h as Healer).name === "string" &&
      isHealerSpec((h as Healer).spec),
  );
}

export function sanitizeTanks(raw: unknown): Tank[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is Tank => {
    if (!t || typeof t !== "object") return false;
    const tank = t as Tank;
    if (typeof tank.id !== "string" || typeof tank.name !== "string") return false;
    return tank.class === undefined || isTankClass(tank.class);
  });
}

export function sanitizeUtilities(raw: unknown): UtilityCaster[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (u): u is UtilityCaster =>
      !!u &&
      typeof u === "object" &&
      typeof (u as UtilityCaster).id === "string" &&
      typeof (u as UtilityCaster).name === "string" &&
      isUtilityClass((u as UtilityCaster).class),
  );
}

function migratePlanSlice(raw: unknown): SavedPlan | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as SavedPlan).assignments)) {
    return null;
  }
  const slice = raw as Partial<SavedPlan>;
  return {
    assignments: (slice.assignments ?? []).filter(
      (a) => a && typeof a === "object" && a.spellId !== "smoke-bomb",
    ),
    noteWindowIds: Array.isArray(slice.noteWindowIds) ? slice.noteWindowIds : [],
    personalWindowIds: Array.isArray(slice.personalWindowIds)
      ? slice.personalWindowIds
      : [],
    timeOverrides:
      slice.timeOverrides && typeof slice.timeOverrides === "object"
        ? slice.timeOverrides
        : {},
  };
}

function migratePlanMap(raw: object): SavedPlans {
  const out: SavedPlans = {};
  for (const [id, slice] of Object.entries(raw)) {
    if (id === "version" || id === "plans") continue;
    const next = migratePlanSlice(slice);
    if (next) out[id] = next;
  }
  return out;
}

/** v0 boss map or v1 envelope → current plans. Unknown future versions yield {}. */
export function migrateStoredPlans(raw: unknown): SavedPlans {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as { version?: unknown; plans?: unknown };
  if (typeof obj.version === "number" && obj.version > PLANS_VERSION) return {};
  if (obj.version === PLANS_VERSION && obj.plans && typeof obj.plans === "object") {
    return migratePlanMap(obj.plans);
  }
  return migratePlanMap(obj);
}

function isCurrentPlansEnvelope(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as { version?: unknown; plans?: unknown };
  return obj.version === PLANS_VERSION && !!obj.plans && typeof obj.plans === "object";
}

function writePlans(plans: SavedPlans) {
  localStorage.setItem(
    PLANS_KEY,
    JSON.stringify({ version: PLANS_VERSION, plans }),
  );
}

/** Drop removed classes (e.g. rogue) and smoke-bomb rows from persisted plans.
 *  validUtilityIds must include tank casters (tank.id as utilityId). */
export function prunePersistedPlans(validUtilityIds: Set<string>) {
  const plans = readSavedPlans();
  let dirty = false;
  for (const [bossKey, plan] of Object.entries(plans)) {
    const next = (plan.assignments ?? []).filter((a) => {
      if (a.spellId === "smoke-bomb") return false;
      if (a.utilityId && !validUtilityIds.has(a.utilityId)) return false;
      return true;
    });
    if (next.length !== (plan.assignments ?? []).length) {
      plans[bossKey] = { ...plan, assignments: next };
      dirty = true;
    }
  }
  if (dirty) writePlans(plans);
}

export function readSavedPlans(): SavedPlans {
  try {
    const raw = localStorage.getItem(PLANS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    const plans = migrateStoredPlans(parsed);
    if (!isCurrentPlansEnvelope(parsed)) writePlans(plans);
    return plans;
  } catch {
    return {};
  }
}

export function writePlanForBoss(bossId: string, slice: SavedPlan) {
  const plans = readSavedPlans();
  plans[bossId] = slice;
  writePlans(plans);
}
