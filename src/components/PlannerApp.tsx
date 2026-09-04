"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { BossPicker } from "@/components/BossPicker";
import { CopyNsrtButton, CopyViserioButton, ExportPanel } from "@/components/ExportPanel";
import { RosterEditor } from "@/components/RosterEditor";
import { Timeline } from "@/components/Timeline";
import { getBoss, getSpell, SPELLS } from "@/data/catalog";
import { autoAssign, autoAssignPersonals, utilityAssigneeIds } from "@/domain/autoAssign";
import { withTimeOverrides } from "@/domain/time";
import {
  defaultNoteWindowIds,
  isUtilityClass,
  type Assignment,
  type Boss,
  type Healer,
  type Tank,
  type UtilityCaster,
} from "@/domain/types";

const ROSTER_KEY = "healer-cda-roster";
const TANKS_KEY = "healer-cda-tanks";
const UTILITIES_KEY = "healer-cda-utilities";
const FIGHT_PICKS_KEY = "healer-cda-fight-picks";
const PLANS_KEY = "healer-cda-plans";
const LAST_BOSS_KEY = "healer-cda-last-boss";

type Step = "boss" | "roster" | "plan";

type FightPicks = Record<
  string,
  { healerIds: string[]; tankIds: string[]; utilityIds?: string[] }
>;

type SavedPlan = {
  assignments: Assignment[];
  noteWindowIds: string[];
  personalWindowIds: string[];
  timeOverrides: Record<string, number>;
};

type SavedPlans = Record<string, SavedPlan>;

function pruneIds(ids: string[], valid: Set<string>): string[] {
  return ids.filter((id) => valid.has(id));
}

function defaultTankIds(pool: Tank[], saved: string[] | undefined): string[] {
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

function loadPlanSlice(
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

function sanitizeUtilities(raw: unknown): UtilityCaster[] {
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

/** Drop removed classes (e.g. rogue) and smoke-bomb rows from persisted plans.
 *  validUtilityIds must include tank casters (tank.id as utilityId). */
function prunePersistedPlans(validUtilityIds: Set<string>) {
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
  if (dirty) localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

function readSavedPlans(): SavedPlans {
  try {
    const raw = localStorage.getItem(PLANS_KEY);
    return raw ? (JSON.parse(raw) as SavedPlans) : {};
  } catch {
    return {};
  }
}

function writePlanForBoss(bossId: string, slice: SavedPlan) {
  const plans = readSavedPlans();
  plans[bossId] = slice;
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

export function PlannerApp() {
  const [step, setStep] = useState<Step>("boss");
  const [bossId, setBossId] = useState<string | null>(null);
  const [poolHealers, setPoolHealers] = useState<Healer[]>([]);
  const [poolTanks, setPoolTanks] = useState<Tank[]>([]);
  const [poolUtilities, setPoolUtilities] = useState<UtilityCaster[]>([]);
  const [fightPicks, setFightPicks] = useState<FightPicks>({});
  const [lastBossId, setLastBossId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [noteWindowIds, setNoteWindowIds] = useState<string[]>([]);
  const [personalWindowIds, setPersonalWindowIds] = useState<string[]>([]);
  const [timeOverrides, setTimeOverrides] = useState<Record<string, number>>(
    {},
  );
  const [hydrated, setHydrated] = useState(false);
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (isClient && !hydrated) {
    try {
      const rawRoster = localStorage.getItem(ROSTER_KEY);
      if (rawRoster) setPoolHealers(JSON.parse(rawRoster) as Healer[]);
      const rawTanks = localStorage.getItem(TANKS_KEY);
      const tanks = rawTanks ? (JSON.parse(rawTanks) as Tank[]) : [];
      if (rawTanks) setPoolTanks(tanks);
      const rawUtilities = localStorage.getItem(UTILITIES_KEY);
      const utilities = sanitizeUtilities(
        rawUtilities ? JSON.parse(rawUtilities) : [],
      );
      setPoolUtilities(utilities);
      // Tank casters use tank.id as Assignment.utilityId — keep those assignees.
      const assigneeIds = utilityAssigneeIds(utilities, tanks);
      prunePersistedPlans(assigneeIds);

      const rawPicks = localStorage.getItem(FIGHT_PICKS_KEY);
      if (rawPicks) {
        const picks = JSON.parse(rawPicks) as FightPicks;
        const utilityPoolIds = new Set(utilities.map((u) => u.id));
        const next: FightPicks = {};
        for (const [id, pick] of Object.entries(picks)) {
          next[id] = {
            ...pick,
            utilityIds: pick.utilityIds?.filter((uid) =>
              utilityPoolIds.has(uid),
            ),
          };
        }
        setFightPicks(next);
      }
      setLastBossId(localStorage.getItem(LAST_BOSS_KEY));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(ROSTER_KEY, JSON.stringify(poolHealers));
  }, [poolHealers, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(TANKS_KEY, JSON.stringify(poolTanks));
  }, [poolTanks, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(UTILITIES_KEY, JSON.stringify(poolUtilities));
  }, [poolUtilities, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(FIGHT_PICKS_KEY, JSON.stringify(fightPicks));
  }, [fightPicks, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (lastBossId) localStorage.setItem(LAST_BOSS_KEY, lastBossId);
    else localStorage.removeItem(LAST_BOSS_KEY);
  }, [lastBossId, hydrated]);

  /** Persist live plan editors for the current boss (no React state echo). */
  useEffect(() => {
    if (!hydrated || !bossId) return;
    writePlanForBoss(bossId, {
      assignments,
      noteWindowIds,
      personalWindowIds,
      timeOverrides,
    });
  }, [
    assignments,
    noteWindowIds,
    personalWindowIds,
    timeOverrides,
    bossId,
    hydrated,
  ]);

  const healerIdSet = useMemo(
    () => new Set(poolHealers.map((h) => h.id)),
    [poolHealers],
  );

  const activeHealerIds = useMemo(() => {
    if (!bossId) return [] as string[];
    const saved = fightPicks[bossId]?.healerIds;
    if (saved !== undefined) {
      const pruned = pruneIds(saved, healerIdSet);
      if (pruned.length === 0 && saved.length > 0 && poolHealers.length > 0) {
        return poolHealers.map((h) => h.id);
      }
      return pruned;
    }
    if (lastBossId && lastBossId !== bossId) {
      const fromLast = fightPicks[lastBossId]?.healerIds;
      if (fromLast) {
        const pruned = pruneIds(fromLast, healerIdSet);
        if (pruned.length > 0) return pruned;
      }
    }
    return poolHealers.map((h) => h.id);
  }, [bossId, fightPicks, healerIdSet, poolHealers, lastBossId]);

  const activeTankIds = useMemo(() => {
    if (!bossId) return [] as string[];
    const saved = fightPicks[bossId]?.tankIds;
    if (saved !== undefined) return defaultTankIds(poolTanks, saved);
    if (lastBossId && lastBossId !== bossId) {
      return defaultTankIds(poolTanks, fightPicks[lastBossId]?.tankIds);
    }
    return defaultTankIds(poolTanks, undefined);
  }, [bossId, fightPicks, poolTanks, lastBossId]);

  const roster = useMemo(
    () => poolHealers.filter((h) => activeHealerIds.includes(h.id)),
    [poolHealers, activeHealerIds],
  );
  const tanks = useMemo(() => {
    if (poolTanks.length > 0 && poolTanks.length < 3) return poolTanks;
    return poolTanks.filter((t) => activeTankIds.includes(t.id));
  }, [poolTanks, activeTankIds]);

  const utilityIdSet = useMemo(
    () => new Set(poolUtilities.map((u) => u.id)),
    [poolUtilities],
  );

  const activeUtilityIds = useMemo(() => {
    if (!bossId) return [] as string[];
    const saved = fightPicks[bossId]?.utilityIds;
    if (saved !== undefined) {
      const pruned = pruneIds(saved, utilityIdSet);
      if (
        pruned.length === 0 &&
        saved.length > 0 &&
        poolUtilities.length > 0
      ) {
        return poolUtilities.map((u) => u.id);
      }
      return pruned;
    }
    if (lastBossId && lastBossId !== bossId) {
      const fromLast = fightPicks[lastBossId]?.utilityIds;
      if (fromLast) {
        const pruned = pruneIds(fromLast, utilityIdSet);
        if (pruned.length > 0) return pruned;
      }
    }
    return poolUtilities.map((u) => u.id);
  }, [bossId, fightPicks, utilityIdSet, poolUtilities, lastBossId]);

  const utilities = useMemo(
    () => poolUtilities.filter((u) => activeUtilityIds.includes(u.id)),
    [poolUtilities, activeUtilityIds],
  );

  function fightPickPatch(
    patch: Partial<{
      healerIds: string[];
      tankIds: string[];
      utilityIds: string[];
    }>,
  ) {
    if (!bossId) return;
    setFightPicks((prev) => ({
      ...prev,
      [bossId]: {
        healerIds: prev[bossId]?.healerIds ?? activeHealerIds,
        tankIds: prev[bossId]?.tankIds ?? activeTankIds,
        utilityIds: prev[bossId]?.utilityIds ?? activeUtilityIds,
        ...patch,
      },
    }));
  }

  function setActiveHealerIds(ids: string[]) {
    fightPickPatch({ healerIds: ids });
  }

  function setActiveTankIds(ids: string[]) {
    fightPickPatch({ tankIds: ids });
  }

  function setActiveUtilityIds(ids: string[]) {
    fightPickPatch({ utilityIds: ids });
  }

  const baseBoss: Boss | undefined = useMemo(
    () => (bossId ? getBoss(bossId) : undefined),
    [bossId],
  );

  const boss: Boss | undefined = useMemo(
    () => (baseBoss ? withTimeOverrides(baseBoss, timeOverrides) : undefined),
    [baseBoss, timeOverrides],
  );

  function applyPlanSlice(slice: SavedPlan) {
    setAssignments(slice.assignments);
    setNoteWindowIds(slice.noteWindowIds);
    setPersonalWindowIds(slice.personalWindowIds);
    setTimeOverrides(slice.timeOverrides);
  }

  function selectBoss(b: Boss, goRoster = false) {
    const switching = bossId != null && b.id !== bossId;
    if (switching || bossId == null) {
      if (bossId) {
        writePlanForBoss(bossId, {
          assignments,
          noteWindowIds,
          personalWindowIds,
          timeOverrides,
        });
      }
      setBossId(b.id);
      applyPlanSlice(
        loadPlanSlice(
          readSavedPlans(),
          b.id,
          b,
          utilityAssigneeIds(poolUtilities, poolTanks),
        ),
      );
    }
    setLastBossId(b.id);
    if (goRoster) setStep("roster");
  }

  function applyAutoAssign() {
    if (!boss) return;
    const next = autoAssign(boss, roster, SPELLS, tanks, utilities);
    setAssignments(next);
    const personals = autoAssignPersonals(boss);
    setPersonalWindowIds(personals);
    if (personals.length > 0) {
      setNoteWindowIds((prev) => {
        const base = prev.length > 0 ? prev : defaultNoteWindowIds(boss);
        return [...new Set([...base, ...personals])];
      });
    } else if (noteWindowIds.length === 0) {
      setNoteWindowIds(defaultNoteWindowIds(boss));
    }
  }

  function goPlan() {
    if (!boss || !bossId) return;
    setFightPicks((prev) => ({
      ...prev,
      [bossId]: {
        healerIds: activeHealerIds,
        tankIds: activeTankIds,
        utilityIds: activeUtilityIds,
      },
    }));
    setLastBossId(bossId);
    if (assignments.length === 0) {
      applyAutoAssign();
    } else if (noteWindowIds.length === 0) {
      setNoteWindowIds(defaultNoteWindowIds(boss));
    }
    setStep("plan");
  }

  function runAutoAssign() {
    if (
      assignments.length > 0 &&
      !window.confirm(
        "Replace current assignments and suggested personals with a fresh auto-assign?",
      )
    ) {
      return;
    }
    applyAutoAssign();
  }

  function setWindowTime(windowId: string, timeSec: number) {
    setTimeOverrides((prev) => ({ ...prev, [windowId]: timeSec }));
    setAssignments((prev) =>
      prev.map((a) =>
        a.windowId === windowId ? { ...a, timeSec } : a,
      ),
    );
  }

  const plan = boss
    ? {
        bossId: boss.id,
        roster,
        tanks,
        utilities,
        assignments,
        noteWindowIds,
        personalWindowIds,
      }
    : null;

  const missingTankAssignments = assignments.filter((a) => {
    const spell = getSpell(a.spellId);
    return spell?.kind === "tankExternal" && !a.tankId;
  });
  const timersDirty = Object.keys(timeOverrides).length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-teal-300/80">
          Midnight Season 2
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl tracking-tight text-white sm:text-5xl">
          Healer CDA
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/55">
          Full fight timeline to enrage, assign healer CDs, tank externals, and
          raid utilities, then copy for NSRT.
        </p>
      </header>

      <nav className="mb-8 flex gap-2 text-sm">
        {(
          [
            ["boss", "1 · Boss"],
            ["roster", "2 · Roster"],
            ["plan", "3 · Plan"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={id !== "boss" && !bossId}
            onClick={() => {
              if (id === "plan" && boss) {
                if (assignments.length === 0) {
                  applyAutoAssign();
                } else if (noteWindowIds.length === 0) {
                  setNoteWindowIds(defaultNoteWindowIds(boss));
                }
              }
              setStep(id);
            }}
            className={`rounded-full px-3 py-1.5 transition ${
              step === id
                ? "bg-teal-500 text-slate-950"
                : "bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-30"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {step === "boss" && (
        <BossPicker
          selectedId={bossId}
          lastBossId={lastBossId}
          onSelect={selectBoss}
        />
      )}

      {step === "roster" && boss && (
        <div className="space-y-6">
          <RosterEditor
            bossName={`${boss.shortName} (${boss.difficulty})`}
            poolHealers={poolHealers}
            poolTanks={poolTanks}
            poolUtilities={poolUtilities}
            activeHealerIds={activeHealerIds}
            activeTankIds={activeTankIds}
            activeUtilityIds={activeUtilityIds}
            onPoolHealersChange={setPoolHealers}
            onPoolTanksChange={setPoolTanks}
            onPoolUtilitiesChange={setPoolUtilities}
            onActiveHealerIdsChange={setActiveHealerIds}
            onActiveTankIdsChange={setActiveTankIds}
            onActiveUtilityIdsChange={setActiveUtilityIds}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setStep("boss")}
              className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/70 hover:bg-white/5"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goPlan}
              disabled={roster.length === 0}
              className="rounded-md bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-40"
            >
              {assignments.length === 0
                ? "Auto-assign & continue"
                : "Continue to plan"}
            </button>
          </div>
        </div>
      )}

      {step === "plan" && boss && plan && (
        <div className="space-y-8">
          <div className="sticky top-0 z-20 -mx-4 space-y-2 bg-[#071018] px-4 py-2 sm:-mx-6 sm:px-6">
            <div className="rounded-lg border border-white/10 bg-[#0c1820] px-4 py-3 text-sm text-white/70">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div>
                    <span className="font-medium text-white">
                      {boss.shortName}
                    </span>
                    <span className="text-white/35"> · </span>
                    <span className="text-white/80">{boss.difficulty}</span>
                  </div>
                  {roster.length > 0 && assignments.length > 0 && (
                    <div className="text-xs text-white/40">
                      {roster
                        .map((h) => {
                          const n = assignments.filter(
                            (a) => a.healerId === h.id,
                          ).length;
                          return `${h.name} ${n}`;
                        })
                        .join(" · ")}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("roster")}
                    className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5"
                  >
                    Back
                  </button>
                  <CopyNsrtButton plan={plan} boss={boss} />
                  <CopyViserioButton plan={plan} boss={boss} />
                </div>
              </div>
            </div>
            {timersDirty && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90">
                <span>
                  Timers edited — Auto-assign again to refresh CD readiness.
                </span>
                <button
                  type="button"
                  onClick={runAutoAssign}
                  disabled={roster.length === 0}
                  className="shrink-0 font-medium text-amber-200 underline-offset-2 hover:underline disabled:opacity-40"
                >
                  Auto-assign
                </button>
              </div>
            )}
            {missingTankAssignments.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  document
                    .getElementById(
                      `assignment-${missingTankAssignments[0].id}`,
                    )
                    ?.scrollIntoView({
                      behavior: "smooth",
                      block: "nearest",
                    });
                }}
                className="w-full rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-sm font-medium text-amber-100/90 hover:bg-amber-500/20"
              >
                {missingTankAssignments.length} tank external
                {missingTankAssignments.length === 1 ? "" : "s"} missing a
                tank target →
              </button>
            )}
          </div>
          <Timeline
            boss={boss}
            roster={roster}
            tanks={tanks}
            utilities={utilities}
            assignments={assignments}
            noteWindowIds={noteWindowIds}
            personalWindowIds={personalWindowIds}
            onChange={setAssignments}
            onNoteWindowIdsChange={setNoteWindowIds}
            onPersonalWindowIdsChange={setPersonalWindowIds}
            onAutoAssign={runAutoAssign}
            onReset={() => {
              if (assignments.length > 0 || personalWindowIds.length > 0) {
                const ok = window.confirm(
                  "Clear all CD and personals assignments for this fight? Your saved plan will be wiped.",
                );
                if (!ok) return;
              }
              setAssignments([]);
              setPersonalWindowIds([]);
            }}
            onWindowTimeChange={setWindowTime}
          />
          <ExportPanel boss={boss} plan={plan} />
        </div>
      )}
    </div>
  );
}
