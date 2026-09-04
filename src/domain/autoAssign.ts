import type {
  Assignment,
  Boss,
  DamageWindow,
  Healer,
  Spell,
  SpellKind,
  Tank,
  WindowCategory,
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
      return ["raidDefensive", "raidThroughput"];
    case "throughput":
      return ["raidThroughput", "raidDefensive"];
  }
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
  healerId: string,
  spellId: string,
  timeSec: number,
  cooldownSec: number,
  assignments: Assignment[],
  excludeWindowId?: string,
): Assignment[] {
  return assignments.filter(
    (a) =>
      a.healerId === healerId &&
      a.spellId === spellId &&
      a.windowId !== excludeWindowId &&
      cooldownConflict(a.timeSec, timeSec, cooldownSec),
  );
}

export function isReady(
  spell: Spell,
  healerId: string,
  timeSec: number,
  assignments: Assignment[],
  excludeWindowId?: string,
): boolean {
  return (
    conflictingAssignments(
      healerId,
      spell.id,
      timeSec,
      spell.cooldownSec,
      assignments,
      excludeWindowId,
    ).length === 0
  );
}

function lastAssignedTime(healerId: string, assignments: Assignment[]): number {
  let max = -1;
  for (const a of assignments) {
    if (a.healerId === healerId && a.timeSec > max) max = a.timeSec;
  }
  return max;
}

function candidatesForWindow(
  window: DamageWindow,
  roster: Healer[],
  assignments: Assignment[],
  spells: Spell[],
): { healer: Healer; spell: Spell }[] {
  const kinds = kindsForCategory(window.category);
  const out: { healer: Healer; spell: Spell }[] = [];

  for (const healer of roster) {
    const forHealer = spells.filter(
      (s) => s.specs.includes(healer.spec) && kinds.includes(s.kind),
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
  healerId: string,
): string {
  return `${windowId}-${spellId}-${healerId}`;
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
    for (const spell of spells.filter((s) => s.specs.includes(healer.spec))) {
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
      let readyAtSec: number | null = null;
      if (!ready) {
        const fromPriors = Math.max(
          ...conflicts
            .filter((a) => a.timeSec <= timeSec)
            .map((a) => a.timeSec + spell.cooldownSec),
          0,
        );
        readyAtSec = fromPriors > timeSec ? fromPriors : null;
      }
      out.push({
        healer,
        spell,
        onThisWindow,
        ready,
        conflicts,
        readyAtSec,
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
  if (!spell) return assignments;

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

export function autoAssign(
  boss: Boss,
  roster: Healer[],
  spells: Spell[],
  tanks: Tank[] = [],
  cdWindowIds?: string[],
): Assignment[] {
  if (roster.length === 0) return [];

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

/** Explicit flag, or soak / soft-CD wording in the window note. */
export function windowSuggestsPersonals(w: DamageWindow): boolean {
  if (w.suggestPersonals) return true;
  return /soak|soft\s*cd|personals?/i.test(`${w.note ?? ""} ${w.ability}`);
}

/** Windows where boss data recommends a raid personals call. */
export function autoAssignPersonals(boss: Boss): string[] {
  return boss.windows.filter(windowSuggestsPersonals).map((w) => w.id);
}
