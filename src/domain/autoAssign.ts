import type {
  Assignment,
  Boss,
  DamageWindow,
  Healer,
  Spell,
  SpellKind,
  Tank,
  UtilityCaster,
  UtilityClass,
  WindowCategory,
} from "@/domain/types";
import {
  assignmentAssigneeId,
  isUtilityClass,
} from "@/domain/types";

const SEVERITY_RANK = { critical: 3, raid: 2, tank: 1 } as const;

function findSpell(spells: Spell[], id: string): Spell | undefined {
  return spells.find((s) => s.id === id);
}

function kindsForCategory(category: WindowCategory): SpellKind[] {
  switch (category) {
    case "external":
      return ["tankExternal"];
    case "defensive":
      return ["raidDefensive", "raidThroughput", "raidUtility"];
    case "throughput":
      return ["raidThroughput", "raidDefensive"];
  }
}

function healerSpellsForSpec(spells: Spell[], spec: Healer["spec"]): Spell[] {
  return spells.filter((s) => s.specs?.includes(spec));
}

function utilitySpellsForClass(spells: Spell[], cls: UtilityClass): Spell[] {
  return spells.filter(
    (s) => s.kind === "raidUtility" && s.classes?.includes(cls),
  );
}

/** Utility roster plus tanks whose class can cast raid utilities. */
export function utilityCastersForAssign(
  utilities: UtilityCaster[],
  tanks: Tank[],
): UtilityCaster[] {
  const seen = new Set(utilities.map((u) => u.id));
  const out = [...utilities];
  for (const t of tanks) {
    if (!t.class || !isUtilityClass(t.class) || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ id: t.id, name: t.name, class: t.class });
  }
  return out;
}

/** Ids that may appear as Assignment.utilityId (DPS utilities + matching tanks). */
export function utilityAssigneeIds(
  utilities: UtilityCaster[],
  tanks: Tank[],
): Set<string> {
  return new Set(utilityCastersForAssign(utilities, tanks).map((c) => c.id));
}

/** Two uses of the same CD conflict if closer than the cooldown. */
export function cooldownConflict(
  timeA: number,
  timeB: number,
  cooldownSec: number,
): boolean {
  const earlier = Math.min(timeA, timeB);
  const later = Math.max(timeA, timeB);
  return later < earlier + cooldownSec;
}

export function conflictingAssignments(
  assigneeId: string,
  spellId: string,
  timeSec: number,
  cooldownSec: number,
  assignments: Assignment[],
  excludeWindowId?: string,
): Assignment[] {
  return assignments.filter(
    (a) =>
      assignmentAssigneeId(a) === assigneeId &&
      a.spellId === spellId &&
      a.windowId !== excludeWindowId &&
      cooldownConflict(a.timeSec, timeSec, cooldownSec),
  );
}

export function isReady(
  spell: Spell,
  assigneeId: string,
  timeSec: number,
  assignments: Assignment[],
  excludeWindowId?: string,
): boolean {
  return (
    conflictingAssignments(
      assigneeId,
      spell.id,
      timeSec,
      spell.cooldownSec,
      assignments,
      excludeWindowId,
    ).length === 0
  );
}

function lastAssignedTime(
  assigneeId: string,
  assignments: Assignment[],
): number {
  let max = -1;
  for (const a of assignments) {
    if (assignmentAssigneeId(a) === assigneeId && a.timeSec > max) {
      max = a.timeSec;
    }
  }
  return max;
}

function candidatesForWindow(
  window: DamageWindow,
  roster: Healer[],
  assignments: Assignment[],
  spells: Spell[],
): { healer: Healer; spell: Spell }[] {
  const kinds: SpellKind[] = kindsForCategory(window.category).filter(
    (k) => k !== "raidUtility",
  );
  const out: { healer: Healer; spell: Spell }[] = [];

  for (const healer of roster) {
    const forHealer = healerSpellsForSpec(spells, healer.spec).filter((s) =>
      kinds.includes(s.kind),
    );
    for (const spell of forHealer) {
      if (!isReady(spell, healer.id, window.timeSec, assignments)) continue;
      out.push({ healer, spell });
    }
  }

  out.sort((a, b) => {
    const kindDiff = kinds.indexOf(a.spell.kind) - kinds.indexOf(b.spell.kind);
    if (kindDiff !== 0) return kindDiff;
    const la = lastAssignedTime(a.healer.id, assignments);
    const lb = lastAssignedTime(b.healer.id, assignments);
    if (la !== lb) return la - lb;
    return a.spell.cooldownSec - b.spell.cooldownSec;
  });

  return out;
}

function nextTankId(
  tanks: Tank[],
  assignments: Assignment[],
): string | undefined {
  if (tanks.length === 0) return undefined;
  const externalCount = assignments.filter((a) => a.tankId).length;
  return tanks[externalCount % tanks.length]?.id;
}

export function makeAssignmentId(
  windowId: string,
  spellId: string,
  assigneeId: string,
): string {
  return `${windowId}-${spellId}-${assigneeId}`;
}

export interface AssignOption {
  healer: Healer;
  spell: Spell;
  /** Already on this window. */
  onThisWindow: boolean;
  /** Ready at this time with no move. */
  ready: boolean;
  /** Assignments that conflict (would be moved if selected). */
  conflicts: Assignment[];
  /** Earliest ready time if not ready (for display). */
  readyAtSec: number | null;
}

export interface UtilityAssignOption {
  caster: UtilityCaster;
  spell: Spell;
  onThisWindow: boolean;
  ready: boolean;
  conflicts: Assignment[];
  readyAtSec: number | null;
}

function readyAtFromConflicts(
  conflicts: Assignment[],
  timeSec: number,
  cooldownSec: number,
): number | null {
  if (conflicts.length === 0) return null;
  const fromPriors = Math.max(
    ...conflicts
      .filter((a) => a.timeSec <= timeSec)
      .map((a) => a.timeSec + cooldownSec),
    0,
  );
  return fromPriors > timeSec ? fromPriors : null;
}

/** All healer CD options for a window time, with ready / move state. */
export function listAssignOptions(
  roster: Healer[],
  assignments: Assignment[],
  windowId: string,
  timeSec: number,
  spells: Spell[],
): AssignOption[] {
  const out: AssignOption[] = [];

  for (const healer of roster) {
    for (const spell of healerSpellsForSpec(spells, healer.spec)) {
      const onThisWindow = assignments.some(
        (a) =>
          a.windowId === windowId &&
          a.healerId === healer.id &&
          a.spellId === spell.id,
      );
      const conflicts = conflictingAssignments(
        healer.id,
        spell.id,
        timeSec,
        spell.cooldownSec,
        assignments,
        windowId,
      );
      const ready = conflicts.length === 0;
      out.push({
        healer,
        spell,
        onThisWindow,
        ready,
        conflicts,
        readyAtSec: ready
          ? null
          : readyAtFromConflicts(conflicts, timeSec, spell.cooldownSec),
      });
    }
  }

  out.sort((a, b) => {
    if (a.onThisWindow !== b.onThisWindow) return a.onThisWindow ? 1 : -1;
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return a.healer.name.localeCompare(b.healer.name);
  });

  return out;
}

/** Raid utility CD options (utility roster ∪ matching tanks). */
export function listUtilityAssignOptions(
  utilities: UtilityCaster[],
  tanks: Tank[],
  assignments: Assignment[],
  windowId: string,
  timeSec: number,
  spells: Spell[],
): UtilityAssignOption[] {
  const out: UtilityAssignOption[] = [];
  const casters = utilityCastersForAssign(utilities, tanks);

  for (const caster of casters) {
    for (const spell of utilitySpellsForClass(spells, caster.class)) {
      const onThisWindow = assignments.some(
        (a) =>
          a.windowId === windowId &&
          a.utilityId === caster.id &&
          a.spellId === spell.id,
      );
      const conflicts = conflictingAssignments(
        caster.id,
        spell.id,
        timeSec,
        spell.cooldownSec,
        assignments,
        windowId,
      );
      const ready = conflicts.length === 0;
      out.push({
        caster,
        spell,
        onThisWindow,
        ready,
        conflicts,
        readyAtSec: ready
          ? null
          : readyAtFromConflicts(conflicts, timeSec, spell.cooldownSec),
      });
    }
  }

  out.sort((a, b) => {
    if (a.onThisWindow !== b.onThisWindow) return a.onThisWindow ? 1 : -1;
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return a.caster.name.localeCompare(b.caster.name);
  });

  return out;
}

/**
 * Add a CD to a window (multi-assign). If the same healer+spell is still on
 * cooldown from another window, move those conflicting assignments here.
 */
export function assignOrMoveSpell(
  assignments: Assignment[],
  window: DamageWindow,
  healerId: string,
  spellId: string,
  tanks: Tank[],
  spells: Spell[],
): Assignment[] {
  const spell = findSpell(spells, spellId);
  if (!spell || spell.kind === "raidUtility") return assignments;

  const alreadyHere = assignments.some(
    (a) =>
      a.windowId === window.id &&
      a.healerId === healerId &&
      a.spellId === spellId,
  );
  if (alreadyHere) return assignments;

  const conflicts = conflictingAssignments(
    healerId,
    spellId,
    window.timeSec,
    spell.cooldownSec,
    assignments,
    window.id,
  );
  const conflictIds = new Set(conflicts.map((a) => a.id));

  let next = assignments.filter((a) => !conflictIds.has(a.id));

  const tankId =
    spell.kind === "tankExternal"
      ? (conflicts.find((a) => a.tankId)?.tankId ??
        nextTankId(tanks, next))
      : undefined;

  next = [
    ...next,
    {
      id: makeAssignmentId(window.id, spellId, healerId),
      windowId: window.id,
      healerId,
      spellId,
      timeSec: window.timeSec,
      ...(tankId ? { tankId } : {}),
    },
  ];

  return next;
}

/** Assign or move a raid utility CD onto a window. */
export function assignOrMoveUtility(
  assignments: Assignment[],
  window: DamageWindow,
  utilityId: string,
  spellId: string,
  spells: Spell[],
): Assignment[] {
  const spell = findSpell(spells, spellId);
  if (!spell || spell.kind !== "raidUtility") return assignments;

  const alreadyHere = assignments.some(
    (a) =>
      a.windowId === window.id &&
      a.utilityId === utilityId &&
      a.spellId === spellId,
  );
  if (alreadyHere) return assignments;

  const conflicts = conflictingAssignments(
    utilityId,
    spellId,
    window.timeSec,
    spell.cooldownSec,
    assignments,
    window.id,
  );
  const conflictIds = new Set(conflicts.map((a) => a.id));
  const next = assignments.filter((a) => !conflictIds.has(a.id));

  return [
    ...next,
    {
      id: makeAssignmentId(window.id, spellId, utilityId),
      windowId: window.id,
      utilityId,
      spellId,
      timeSec: window.timeSec,
    },
  ];
}

export function autoAssign(
  boss: Boss,
  roster: Healer[],
  spells: Spell[],
  tanks: Tank[] = [],
  utilities: UtilityCaster[] = [],
  cdWindowIds?: string[],
): Assignment[] {
  const cdSet =
    cdWindowIds !== undefined
      ? new Set(cdWindowIds)
      : new Set(
          boss.windows.filter((w) => w.assignCd !== false).map((w) => w.id),
        );

  const windows = [...boss.windows]
    .filter((w) => cdSet.has(w.id))
    .sort((a, b) => {
      if (a.timeSec !== b.timeSec) return a.timeSec - b.timeSec;
      return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    });

  const assignments: Assignment[] = [];

  if (roster.length > 0) {
    for (const window of windows) {
      const candidates = candidatesForWindow(
        window,
        roster,
        assignments,
        spells,
      );
      if (candidates.length === 0) continue;

      const first = candidates[0];
      const tankId =
        first.spell.kind === "tankExternal"
          ? nextTankId(tanks, assignments)
          : undefined;

      assignments.push({
        id: makeAssignmentId(window.id, first.spell.id, first.healer.id),
        windowId: window.id,
        healerId: first.healer.id,
        spellId: first.spell.id,
        timeSec: window.timeSec,
        ...(tankId ? { tankId } : {}),
      });

      if (window.severity === "critical") {
        const usedHealer = first.healer.id;
        const usedSpell = first.spell.id;
        const second = candidates.find(
          (c) =>
            c.healer.id !== usedHealer &&
            c.spell.id !== usedSpell &&
            c.spell.kind !== first.spell.kind &&
            isReady(c.spell, c.healer.id, window.timeSec, assignments),
        );
        if (second) {
          const secondTank =
            second.spell.kind === "tankExternal"
              ? nextTankId(tanks, assignments)
              : undefined;
          assignments.push({
            id: makeAssignmentId(window.id, second.spell.id, second.healer.id),
            windowId: window.id,
            healerId: second.healer.id,
            spellId: second.spell.id,
            timeSec: window.timeSec,
            ...(secondTank ? { tankId: secondTank } : {}),
          });
        }
      }
    }
  }

  // Place unused raid utilities on uncovered defensive windows.
  const casters = utilityCastersForAssign(utilities, tanks);
  if (casters.length === 0) return assignments;

  const defensiveWindows = windows.filter((w) => w.category === "defensive");
  for (const window of defensiveWindows) {
    const hasUtility = assignments.some(
      (a) => a.windowId === window.id && a.utilityId,
    );
    if (hasUtility) continue;

    const options = listUtilityAssignOptions(
      utilities,
      tanks,
      assignments,
      window.id,
      window.timeSec,
      spells,
    ).filter((o) => o.ready && !o.onThisWindow);
    if (options.length === 0) continue;

    const pick = options[0];
    assignments.push({
      id: makeAssignmentId(window.id, pick.spell.id, pick.caster.id),
      windowId: window.id,
      utilityId: pick.caster.id,
      spellId: pick.spell.id,
      timeSec: window.timeSec,
    });
  }

  return assignments;
}

export function uncoveredWindows(
  boss: Boss,
  assignments: Assignment[],
  cdWindowIds?: string[],
  personalWindowIds?: string[],
): DamageWindow[] {
  const covered = new Set(assignments.map((a) => a.windowId));
  for (const id of personalWindowIds ?? []) covered.add(id);
  const cdSet =
    cdWindowIds !== undefined
      ? new Set(cdWindowIds)
      : new Set(
          boss.windows.filter((w) => w.assignCd !== false).map((w) => w.id),
        );
  return boss.windows.filter((w) => cdSet.has(w.id) && !covered.has(w.id));
}

/** Explicit flag, or soft-CD / personals wording (not bare “soak”). */
export function windowSuggestsPersonals(w: DamageWindow): boolean {
  if (w.suggestPersonals) return true;
  return /soft\s*cd|raid\s*personals?/i.test(`${w.note ?? ""} ${w.ability}`);
}

/** Windows where boss data recommends a raid personals call. */
export function autoAssignPersonals(boss: Boss): string[] {
  return boss.windows.filter(windowSuggestsPersonals).map((w) => w.id);
}
