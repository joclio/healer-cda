"use client";

import { useEffect, useState } from "react";
import { parseRosterPaste } from "@/domain/rosterPaste";
import {
  DEFAULT_SPEC_FOR_CLASS,
  HEALER_CLASS_LABELS,
  SPEC_CLASS_COLOR,
  SPEC_SHORT_LABELS,
  SPEC_TO_CLASS,
  TANK_CLASS_COLOR,
  TANK_CLASS_LABELS,
  TANK_SPEC_LABELS,
  UTILITY_CLASS_COLOR,
  UTILITY_CLASS_LABELS,
  specsForClass,
  type Healer,
  type HealerClass,
  type HealerSpec,
  type Tank,
  type TankClass,
  type UtilityCaster,
  type UtilityClass,
} from "@/domain/types";

const HEALER_CLASSES = Object.keys(HEALER_CLASS_LABELS) as HealerClass[];
const TANK_CLASSES = Object.keys(TANK_CLASS_LABELS) as TankClass[];
const UTILITY_CLASSES = Object.keys(UTILITY_CLASS_LABELS) as UtilityClass[];

const FIELD =
  "w-full rounded-md border border-white/10 bg-slate-950/60 px-2 py-1.5 text-sm text-white outline-none focus:border-teal-400/60";

const MOBILE_LABEL =
  "text-[10px] font-semibold uppercase tracking-wider text-white/35 sm:hidden";

type RowKind = "healer" | "tank";

function rowGrid(kind: RowKind, reordering: boolean): string {
  const cols =
    kind === "healer"
      ? reordering
        ? "sm:grid-cols-[3.25rem_minmax(0,1fr)_7rem_9rem_4.25rem]"
        : "sm:grid-cols-[minmax(0,1fr)_7rem_9rem_4.25rem]"
      : reordering
        ? "sm:grid-cols-[3.25rem_minmax(0,1fr)_9rem_4.25rem]"
        : "sm:grid-cols-[minmax(0,1fr)_9rem_4.25rem]";
  return [
    "flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 sm:grid sm:items-center sm:gap-2 sm:px-2",
    cols,
  ].join(" ");
}

function colHeader(kind: RowKind, reordering: boolean): string {
  const cols =
    kind === "healer"
      ? reordering
        ? "grid-cols-[3.25rem_minmax(0,1fr)_7rem_9rem_4.25rem]"
        : "grid-cols-[minmax(0,1fr)_7rem_9rem_4.25rem]"
      : reordering
        ? "grid-cols-[3.25rem_minmax(0,1fr)_9rem_4.25rem]"
        : "grid-cols-[minmax(0,1fr)_9rem_4.25rem]";
  return [
    "mb-1 hidden items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/35 sm:grid",
    cols,
  ].join(" ");
}

function colorDot(color: string) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function stableId(prefix: string, name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${slug || "unnamed"}`;
}

function newId(prefix: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}`;
}

function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  const tmp = next[index];
  next[index] = next[j];
  next[j] = tmp;
  return next;
}

type UndoState =
  | { kind: "healer"; item: Healer; index: number }
  | { kind: "tank"; item: Tank; index: number }
  | { kind: "utility"; item: UtilityCaster; index: number };

interface Props {
  bossName: string;
  poolHealers: Healer[];
  poolTanks: Tank[];
  poolUtilities: UtilityCaster[];
  activeHealerIds: string[];
  activeTankIds: string[];
  activeUtilityIds: string[];
  onPoolHealersChange: (healers: Healer[]) => void;
  onPoolTanksChange: (tanks: Tank[]) => void;
  onPoolUtilitiesChange: (utilities: UtilityCaster[]) => void;
  onActiveHealerIdsChange: (ids: string[]) => void;
  onActiveTankIdsChange: (ids: string[]) => void;
  onActiveUtilityIdsChange: (ids: string[]) => void;
}

export function RosterEditor({
  bossName,
  poolHealers,
  poolTanks,
  poolUtilities,
  activeHealerIds,
  activeTankIds,
  activeUtilityIds,
  onPoolHealersChange,
  onPoolTanksChange,
  onPoolUtilitiesChange,
  onActiveHealerIdsChange,
  onActiveTankIdsChange,
  onActiveUtilityIdsChange,
}: Props) {
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [verifySpecs, setVerifySpecs] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [reordering, setReordering] = useState(false);

  const activeHealerSet = new Set(activeHealerIds);
  const activeTankSet = new Set(activeTankIds);
  const activeUtilitySet = new Set(activeUtilityIds);
  const showTankPicker = poolTanks.length >= 3;
  const empty =
    poolHealers.length === 0 &&
    poolTanks.length === 0 &&
    poolUtilities.length === 0;

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 5000);
    return () => window.clearTimeout(t);
  }, [undo]);

  function applyPaste() {
    setPasteError(null);
    setPasteNote(null);
    const result = parseRosterPaste(pasteText);
    if (
      result.healers.length === 0 &&
      result.tanks.length === 0 &&
      result.utilities.length === 0
    ) {
      setPasteError(
        "No healers, tanks, or raid utilities found. Paste the WowAudit Main Roster tab.",
      );
      return;
    }

    if (result.healers.length > 0) {
      const next = result.healers.map((h) => ({
        id: stableId("h", h.name),
        name: h.name,
        spec: h.spec,
      }));
      onPoolHealersChange(next);
      onActiveHealerIdsChange(next.map((h) => h.id));
      setVerifySpecs(true);
    }
    if (result.tanks.length > 0) {
      const next = result.tanks.map((t) => ({
        id: stableId("t", t.name),
        name: t.name,
        class: t.class,
      }));
      onPoolTanksChange(next);
      onActiveTankIdsChange(next.map((t) => t.id));
    }
    if (result.utilities.length > 0) {
      const next = result.utilities.map((u) => ({
        id: stableId("u", u.name),
        name: u.name,
        class: u.class,
      }));
      onPoolUtilitiesChange(next);
      onActiveUtilityIdsChange(next.map((u) => u.id));
    }
    setPasteNote(result.note);
    setPasteText("");
    setShowPaste(false);
    setEditing(false);
    setUndo(null);
  }

  function addHealer() {
    const h: Healer = {
      id: newId("h"),
      name: `Healer ${poolHealers.length + 1}`,
      spec: "resto-shaman",
    };
    onPoolHealersChange([...poolHealers, h]);
    onActiveHealerIdsChange([...activeHealerIds, h.id]);
    setEditing(true);
  }

  function updateHealer(id: string, patch: Partial<Healer>) {
    onPoolHealersChange(
      poolHealers.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    );
  }

  function setHealerClass(id: string, cls: HealerClass) {
    const h = poolHealers.find((x) => x.id === id);
    if (!h) return;
    if (SPEC_TO_CLASS[h.spec] === cls) return;
    updateHealer(id, { spec: DEFAULT_SPEC_FOR_CLASS[cls] });
  }

  function removeHealer(id: string) {
    const index = poolHealers.findIndex((h) => h.id === id);
    if (index < 0) return;
    const item = poolHealers[index];
    onPoolHealersChange(poolHealers.filter((h) => h.id !== id));
    onActiveHealerIdsChange(activeHealerIds.filter((x) => x !== id));
    setUndo({ kind: "healer", item, index });
  }

  function toggleHealer(id: string) {
    if (activeHealerSet.has(id)) {
      onActiveHealerIdsChange(activeHealerIds.filter((x) => x !== id));
    } else {
      onActiveHealerIdsChange([...activeHealerIds, id]);
    }
  }

  function addTank() {
    const t: Tank = {
      id: newId("t"),
      name: `Tank ${poolTanks.length + 1}`,
      class: "warrior",
    };
    onPoolTanksChange([...poolTanks, t]);
    onActiveTankIdsChange([...activeTankIds, t.id]);
    setEditing(true);
  }

  function updateTank(id: string, patch: Partial<Tank>) {
    onPoolTanksChange(
      poolTanks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }

  function removeTank(id: string) {
    const index = poolTanks.findIndex((t) => t.id === id);
    if (index < 0) return;
    const item = poolTanks[index];
    onPoolTanksChange(poolTanks.filter((t) => t.id !== id));
    onActiveTankIdsChange(activeTankIds.filter((x) => x !== id));
    setUndo({ kind: "tank", item, index });
  }

  function toggleTank(id: string) {
    if (activeTankSet.has(id)) {
      onActiveTankIdsChange(activeTankIds.filter((x) => x !== id));
    } else {
      onActiveTankIdsChange([...activeTankIds, id]);
    }
  }

  function addUtility() {
    const u: UtilityCaster = {
      id: newId("u"),
      name: `Utility ${poolUtilities.length + 1}`,
      class: "warrior",
    };
    onPoolUtilitiesChange([...poolUtilities, u]);
    onActiveUtilityIdsChange([...activeUtilityIds, u.id]);
    setEditing(true);
  }

  function updateUtility(id: string, patch: Partial<UtilityCaster>) {
    onPoolUtilitiesChange(
      poolUtilities.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    );
  }

  function removeUtility(id: string) {
    const index = poolUtilities.findIndex((u) => u.id === id);
    if (index < 0) return;
    const item = poolUtilities[index];
    onPoolUtilitiesChange(poolUtilities.filter((u) => u.id !== id));
    onActiveUtilityIdsChange(activeUtilityIds.filter((x) => x !== id));
    setUndo({ kind: "utility", item, index });
  }

  function toggleUtility(id: string) {
    if (activeUtilitySet.has(id)) {
      onActiveUtilityIdsChange(activeUtilityIds.filter((x) => x !== id));
    } else {
      onActiveUtilityIdsChange([...activeUtilityIds, id]);
    }
  }

  function restoreUndo() {
    if (!undo) return;
    if (undo.kind === "healer") {
      const next = [...poolHealers];
      next.splice(undo.index, 0, undo.item);
      onPoolHealersChange(next);
      if (!activeHealerIds.includes(undo.item.id)) {
        onActiveHealerIdsChange([...activeHealerIds, undo.item.id]);
      }
    } else if (undo.kind === "tank") {
      const next = [...poolTanks];
      next.splice(undo.index, 0, undo.item);
      onPoolTanksChange(next);
      if (!activeTankIds.includes(undo.item.id)) {
        onActiveTankIdsChange([...activeTankIds, undo.item.id]);
      }
    } else {
      const next = [...poolUtilities];
      next.splice(undo.index, 0, undo.item);
      onPoolUtilitiesChange(next);
      if (!activeUtilityIds.includes(undo.item.id)) {
        onActiveUtilityIdsChange([...activeUtilityIds, undo.item.id]);
      }
    }
    setUndo(null);
  }

  function tankColor(t: Tank): string {
    return t.class ? TANK_CLASS_COLOR[t.class] : "#94a3b8";
  }

  function moveButtons(
    index: number,
    total: number,
    onMove: (dir: -1 | 1) => void,
  ) {
    return (
      <div className="flex gap-0.5">
        <button
          type="button"
          aria-label="Move up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="rounded px-1.5 py-0.5 text-xs text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-25"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Move down"
          disabled={index >= total - 1}
          onClick={() => onMove(1)}
          className="rounded px-1.5 py-0.5 text-xs text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-25"
        >
          ↓
        </button>
      </div>
    );
  }

  function pastePanel() {
    return (
      <div className="space-y-3">
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={empty ? 8 : 5}
          placeholder="Paste WowAudit Main Roster here…"
          className="w-full resize-y rounded-md border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-white/25 focus:border-teal-400/60"
        />
        <button
          type="button"
          onClick={applyPaste}
          disabled={!pasteText.trim()}
          className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400 disabled:opacity-40"
        >
          Apply paste
        </button>
        {pasteError && (
          <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {pasteError}
          </p>
        )}
        {pasteNote && (
          <p className="text-sm text-teal-200/80">{pasteNote}</p>
        )}
      </div>
    );
  }

  function undoBar() {
    if (!undo) return null;
    const label =
      undo.kind === "healer"
        ? `Removed ${undo.item.name}`
        : `Removed ${undo.item.name}`;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white/80">
        <span>{label}</span>
        <button
          type="button"
          onClick={restoreUndo}
          className="font-medium text-teal-300 hover:text-teal-200"
        >
          Undo
        </button>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="space-y-4 rounded-lg border border-white/10 bg-white/[0.03] p-5">
        <div>
          <h2 className="text-sm font-medium text-white">Import roster</h2>
          <p className="mt-1 text-sm text-white/55">
            Paste your WowAudit Main Roster once. It stays in this browser —
            then you only pick who is on each fight.
          </p>
        </div>
        {pastePanel()}
        <button
          type="button"
          onClick={addHealer}
          className="text-sm text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
        >
          Or add healers manually
        </button>
      </div>
    );
  }

  if (editing) {
    const healerGrid = rowGrid("healer", reordering);
    const healerHeader = colHeader("healer", reordering);
    const tankGrid = rowGrid("tank", reordering);
    const tankHeader = colHeader("tank", reordering);

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white">Edit roster</h2>
            <p className="mt-1 text-sm text-white/55">
              {reordering
                ? "↑↓ sets assign priority · top healers get CDs first"
                : "Browser save · list order = assign priority"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setReordering((v) => !v)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                reordering
                  ? "border-teal-500/40 bg-teal-500/10 text-teal-200"
                  : "border-white/15 text-white/55 hover:bg-white/5 hover:text-white/80"
              }`}
            >
              {reordering ? "Done reordering" : "Reorder"}
            </button>
            {!showPaste && (
              <button
                type="button"
                onClick={() => setShowPaste(true)}
                className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/55 hover:bg-white/5 hover:text-white/80"
              >
                Replace…
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setVerifySpecs(false);
                setUndo(null);
                setReordering(false);
              }}
              className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400"
            >
              Done
            </button>
          </div>
        </div>

        {showPaste && (
          <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-white">
                  Replace roster
                </h3>
                <p className="mt-1 text-sm text-white/55">
                  Overwrites saved healers, tanks, and raid utilities.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPaste(false)}
                className="text-sm text-white/45 hover:text-white/70"
              >
                Cancel
              </button>
            </div>
            {pastePanel()}
          </div>
        )}

        {verifySpecs && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90">
            <span>
              Specs defaulted from class after paste — check Discipline vs Holy.
            </span>
            <button
              type="button"
              onClick={() => setVerifySpecs(false)}
              className="shrink-0 text-amber-200/80 underline-offset-2 hover:underline"
            >
              Got it
            </button>
          </div>
        )}

        {undoBar()}

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-white">
            Healers ({poolHealers.length})
          </h3>

          <div className={healerHeader}>
            {reordering && <span />}
            <span>Name</span>
            <span>Class</span>
            <span>Spec</span>
            <span />
          </div>

          <ul className="space-y-1.5">
            {poolHealers.map((h, i) => {
              const cls = SPEC_TO_CLASS[h.spec];
              const classSpecs = specsForClass(cls);
              return (
                <li key={h.id} className={healerGrid}>
                  {reordering &&
                    moveButtons(i, poolHealers.length, (dir) =>
                      onPoolHealersChange(moveItem(poolHealers, i, dir)),
                    )}
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className={MOBILE_LABEL}>Name</span>
                    <div className="flex min-w-0 items-center gap-2">
                      {colorDot(SPEC_CLASS_COLOR[h.spec])}
                      <input
                        value={h.name}
                        onChange={(e) =>
                          updateHealer(h.id, { name: e.target.value })
                        }
                        className={`min-w-0 ${FIELD}`}
                        placeholder="Name"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={MOBILE_LABEL}>Class</span>
                    <select
                      value={cls}
                      onChange={(e) =>
                        setHealerClass(h.id, e.target.value as HealerClass)
                      }
                      className={FIELD}
                      title="Class"
                    >
                      {HEALER_CLASSES.map((c) => (
                        <option key={c} value={c}>
                          {HEALER_CLASS_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={MOBILE_LABEL}>Spec</span>
                    {classSpecs.length > 1 ? (
                      <select
                        value={h.spec}
                        onChange={(e) =>
                          updateHealer(h.id, {
                            spec: e.target.value as HealerSpec,
                          })
                        }
                        className={FIELD}
                        title="Spec"
                      >
                        {classSpecs.map((spec) => (
                          <option key={spec} value={spec}>
                            {SPEC_SHORT_LABELS[spec]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="truncate px-1 py-1.5 text-sm text-white/70">
                        {SPEC_SHORT_LABELS[h.spec]}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeHealer(h.id)}
                    className="justify-self-end rounded-md px-2 py-1 text-sm text-rose-300 hover:bg-rose-500/10 sm:self-center"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={addHealer}
              className="text-sm text-teal-300/80 hover:text-teal-200"
            >
              + Add healer
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-white">
            Tanks ({poolTanks.length})
          </h3>

          <div className={tankHeader}>
            {reordering && <span />}
            <span>Name</span>
            <span>Class</span>
            <span />
          </div>

          {poolTanks.length === 0 ? (
            <p className="text-sm text-white/45">No tanks yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {poolTanks.map((t, i) => (
                <li key={t.id} className={tankGrid}>
                  {reordering &&
                    moveButtons(i, poolTanks.length, (dir) =>
                      onPoolTanksChange(moveItem(poolTanks, i, dir)),
                    )}
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className={MOBILE_LABEL}>Name</span>
                    <div className="flex min-w-0 items-center gap-2">
                      {colorDot(tankColor(t))}
                      <input
                        value={t.name}
                        onChange={(e) =>
                          updateTank(t.id, { name: e.target.value })
                        }
                        className={`min-w-0 ${FIELD}`}
                        placeholder="Name"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={MOBILE_LABEL}>Class</span>
                    <select
                      value={t.class ?? "warrior"}
                      onChange={(e) =>
                        updateTank(t.id, {
                          class: e.target.value as TankClass,
                        })
                      }
                      className={FIELD}
                      title="Class"
                    >
                      {TANK_CLASSES.map((c) => (
                        <option key={c} value={c}>
                          {TANK_CLASS_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTank(t.id)}
                    className="justify-self-end rounded-md px-2 py-1 text-sm text-rose-300 hover:bg-rose-500/10 sm:self-center"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={addTank}
              className="text-sm text-teal-300/80 hover:text-teal-200"
            >
              + Add tank
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-white">
            Raid utilities ({poolUtilities.length})
          </h3>
          <p className="text-xs text-white/40">
            DPS (or anyone) who brings Rally, AMZ, Darkness, Smoke Bomb. Matching
            tanks are offered automatically.
          </p>

          <div className={tankHeader}>
            {reordering && <span />}
            <span>Name</span>
            <span>Class</span>
            <span />
          </div>

          {poolUtilities.length === 0 ? (
            <p className="text-sm text-white/45">No utility casters yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {poolUtilities.map((u, i) => (
                <li key={u.id} className={tankGrid}>
                  {reordering &&
                    moveButtons(i, poolUtilities.length, (dir) =>
                      onPoolUtilitiesChange(moveItem(poolUtilities, i, dir)),
                    )}
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className={MOBILE_LABEL}>Name</span>
                    <div className="flex min-w-0 items-center gap-2">
                      {colorDot(UTILITY_CLASS_COLOR[u.class])}
                      <input
                        value={u.name}
                        onChange={(e) =>
                          updateUtility(u.id, { name: e.target.value })
                        }
                        className={`min-w-0 ${FIELD}`}
                        placeholder="Name"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={MOBILE_LABEL}>Class</span>
                    <select
                      value={u.class}
                      onChange={(e) =>
                        updateUtility(u.id, {
                          class: e.target.value as UtilityClass,
                        })
                      }
                      className={FIELD}
                      title="Class"
                    >
                      {UTILITY_CLASSES.map((c) => (
                        <option key={c} value={c}>
                          {UTILITY_CLASS_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeUtility(u.id)}
                    className="justify-self-end rounded-md px-2 py-1 text-sm text-rose-300 hover:bg-rose-500/10 sm:self-center"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={addUtility}
              className="text-sm text-teal-300/80 hover:text-teal-200"
            >
              + Add utility
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white">
              Healers for {bossName}
            </h2>
            <p className="mt-1 text-sm text-white/55">
              {activeHealerIds.length} selected · picks saved for this boss
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() =>
                onActiveHealerIdsChange(poolHealers.map((h) => h.id))
              }
              className="rounded-md border border-white/10 px-2 py-1 text-teal-300/90 hover:bg-white/5"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onActiveHealerIdsChange([])}
              className="rounded-md border border-white/10 px-2 py-1 text-white/50 hover:bg-white/5"
            >
              None
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-white/10 px-2 py-1 text-white/60 hover:bg-white/5"
            >
              Edit roster
            </button>
          </div>
        </div>

        {verifySpecs && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90">
            <span>
              Specs defaulted from class — open Edit roster to fix Discipline vs
              Holy.
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="shrink-0 text-amber-200/80 underline-offset-2 hover:underline"
            >
              Edit
            </button>
          </div>
        )}

        <ul className="space-y-1.5">
          {poolHealers.map((h) => {
            const on = activeHealerSet.has(h.id);
            return (
              <li key={h.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm ${
                    on
                      ? "border-white/15 bg-white/[0.05] text-white"
                      : "border-white/5 bg-white/[0.02] text-white/55"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleHealer(h.id)}
                  />
                  {colorDot(SPEC_CLASS_COLOR[h.spec])}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {h.name}
                  </span>
                  <span className="shrink-0 text-xs text-white/40">
                    {SPEC_SHORT_LABELS[h.spec]}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {poolTanks.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-white">Tanks</h2>
              <p className="mt-0.5 text-sm text-white/55">
                {showTankPicker
                  ? `${activeTankIds.length} selected for externals`
                  : "Used for external targets"}
              </p>
            </div>
            {showTankPicker && (
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    onActiveTankIdsChange(poolTanks.map((t) => t.id))
                  }
                  className="rounded-md border border-white/10 px-2 py-1 text-teal-300/90 hover:bg-white/5"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => onActiveTankIdsChange([])}
                  className="rounded-md border border-white/10 px-2 py-1 text-white/50 hover:bg-white/5"
                >
                  None
                </button>
              </div>
            )}
          </div>
          {showTankPicker ? (
            <ul className="space-y-1.5">
              {poolTanks.map((t) => {
                const on = activeTankSet.has(t.id);
                return (
                  <li key={t.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm ${
                        on
                          ? "border-white/15 bg-white/[0.05] text-white"
                          : "border-white/5 bg-white/[0.02] text-white/55"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleTank(t.id)}
                      />
                      {colorDot(tankColor(t))}
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {t.name}
                      </span>
                      <span className="shrink-0 text-xs text-white/40">
                        {TANK_SPEC_LABELS[t.class ?? "warrior"]}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="space-y-1.5">
              {poolTanks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 rounded-md border border-white/15 bg-white/[0.05] px-3 py-2.5 text-sm text-white"
                >
                  {colorDot(tankColor(t))}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {t.name}
                  </span>
                  <span className="shrink-0 text-xs text-white/40">
                    {TANK_SPEC_LABELS[t.class ?? "warrior"]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white">Raid utilities</h2>
            <p className="mt-0.5 text-sm text-white/55">
              {activeUtilityIds.length} selected · Rally / AMZ / Darkness /
              Smoke Bomb
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() =>
                onActiveUtilityIdsChange(poolUtilities.map((u) => u.id))
              }
              className="rounded-md border border-white/10 px-2 py-1 text-teal-300/90 hover:bg-white/5"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onActiveUtilityIdsChange([])}
              className="rounded-md border border-white/10 px-2 py-1 text-white/50 hover:bg-white/5"
            >
              None
            </button>
          </div>
        </div>
        {poolUtilities.length === 0 ? (
          <p className="text-sm text-white/45">
            None yet — Edit roster to add DPS who bring raid CDs. Matching tanks
            still count.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {poolUtilities.map((u) => {
              const on = activeUtilitySet.has(u.id);
              return (
                <li key={u.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm ${
                      on
                        ? "border-white/15 bg-white/[0.05] text-white"
                        : "border-white/5 bg-white/[0.02] text-white/55"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleUtility(u.id)}
                    />
                    {colorDot(UTILITY_CLASS_COLOR[u.class])}
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {u.name}
                    </span>
                    <span className="shrink-0 text-xs text-white/40">
                      {UTILITY_CLASS_LABELS[u.class]}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
