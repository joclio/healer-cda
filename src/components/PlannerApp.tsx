"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BossPicker } from "@/components/BossPicker";
import { ExportPanel } from "@/components/ExportPanel";
import { PlanHeader } from "@/components/PlanHeader";
import { RosterEditor } from "@/components/RosterEditor";
import { Timeline } from "@/components/Timeline";
import {
  FIGHT_PICKS_KEY,
  LAST_BOSS_KEY,
  ROSTER_KEY,
  TANKS_KEY,
  UTILITIES_KEY,
  defaultTankIds,
  loadPlanSlice,
  pruneIds,
  prunePersistedPlans,
  readSavedPlans,
  sanitizeHealers,
  sanitizeTanks,
  sanitizeUtilities,
  writePlanForBoss,
  type FightPicks,
  type SavedPlan,
} from "@/components/plannerStorage";
import { getBoss, SPELLS } from "@/data/catalog";
import { autoAssign, autoAssignPersonals, utilityAssigneeIds } from "@/domain/autoAssign";
import { applyPlanFile, toPlanFile } from "@/domain/planFile";
import { withTimeOverrides } from "@/domain/time";
import {
  defaultNoteWindowIds,
  type Assignment,
  type Boss,
  type Healer,
  type Tank,
  type UtilityCaster,
} from "@/domain/types";

type Step = "boss" | "roster" | "plan";

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
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Set during hydration; pruned from localStorage after commit, not during render. */
  const pendingPlanPrune = useRef<Set<string> | null>(null);
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (isClient && !hydrated) {
    try {
      const rawRoster = localStorage.getItem(ROSTER_KEY);
      if (rawRoster) setPoolHealers(sanitizeHealers(JSON.parse(rawRoster)));
      const rawTanks = localStorage.getItem(TANKS_KEY);
      const tanks = sanitizeTanks(rawTanks ? JSON.parse(rawTanks) : []);
      if (rawTanks) setPoolTanks(tanks);
      const rawUtilities = localStorage.getItem(UTILITIES_KEY);
      const utilities = sanitizeUtilities(
        rawUtilities ? JSON.parse(rawUtilities) : [],
      );
      setPoolUtilities(utilities);
      // Tank casters use tank.id as Assignment.utilityId — keep those assignees.
      pendingPlanPrune.current = utilityAssigneeIds(utilities, tanks);

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

  function persist(write: () => void) {
    try {
      write();
      setSaveError(null);
    } catch {
      setSaveError("Could not save in this browser. Export the plan before you leave.");
    }
  }

  useEffect(() => {
    if (!hydrated || !pendingPlanPrune.current) return;
    persist(() => prunePersistedPlans(pendingPlanPrune.current!));
    pendingPlanPrune.current = null;
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    persist(() => localStorage.setItem(ROSTER_KEY, JSON.stringify(poolHealers)));
  }, [poolHealers, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    persist(() => localStorage.setItem(TANKS_KEY, JSON.stringify(poolTanks)));
  }, [poolTanks, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    persist(() =>
      localStorage.setItem(UTILITIES_KEY, JSON.stringify(poolUtilities)),
    );
  }, [poolUtilities, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    persist(() =>
      localStorage.setItem(FIGHT_PICKS_KEY, JSON.stringify(fightPicks)),
    );
  }, [fightPicks, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    persist(() => {
      if (lastBossId) localStorage.setItem(LAST_BOSS_KEY, lastBossId);
      else localStorage.removeItem(LAST_BOSS_KEY);
    });
  }, [lastBossId, hydrated]);

  /** Persist live plan editors for the current boss (no React state echo). */
  useEffect(() => {
    if (!hydrated || !bossId) return;
    persist(() =>
      writePlanForBoss(bossId, {
        assignments,
        noteWindowIds,
        personalWindowIds,
        timeOverrides,
      }),
    );
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
        persist(() =>
          writePlanForBoss(bossId, {
            assignments,
            noteWindowIds,
            personalWindowIds,
            timeOverrides,
          }),
        );
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

  function resetTimers() {
    if (!baseBoss) return;
    const source = new Map(baseBoss.windows.map((w) => [w.id, w.timeSec]));
    setTimeOverrides({});
    setAssignments((prev) =>
      prev.map((a) =>
        source.has(a.windowId) ? { ...a, timeSec: source.get(a.windowId)! } : a,
      ),
    );
  }

  function importPlan(
    raw: string,
  ): { ok: true; skippedNames: number; skippedWindows: number } | { ok: false; error?: string } {
    if (!baseBoss) return { ok: false, error: "No fight selected." };
    if (
      (assignments.length > 0 ||
        personalWindowIds.length > 0 ||
        Object.keys(timeOverrides).length > 0) &&
      !window.confirm("Replace the current plan for this fight with the pasted plan?")
    ) {
      return { ok: false };
    }
    const applied = applyPlanFile(raw, baseBoss, roster, tanks, utilities);
    if (!applied.ok) return applied;
    applyPlanSlice(applied.plan);
    return {
      ok: true,
      skippedNames: applied.skippedNames,
      skippedWindows: applied.skippedWindows,
    };
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

  const timersDirty = Object.keys(timeOverrides).length > 0;

  function downloadPlan() {
    if (!boss || !plan) return;
    const body = JSON.stringify(toPlanFile(plan, timeOverrides), null, 2) + "\n";
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${boss.id}-plan.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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

      {saveError && (
        <p className="mb-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90">
          {saveError}
        </p>
      )}

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
          <PlanHeader
            boss={boss}
            plan={plan}
            timersDirty={timersDirty}
            onBack={() => setStep("roster")}
            onAutoAssign={runAutoAssign}
            onResetTimers={resetTimers}
            onDownloadPlan={downloadPlan}
            onImportPlan={importPlan}
          />
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
