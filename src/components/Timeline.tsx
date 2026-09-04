"use client";

import { useEffect, useRef, useState } from "react";
import { getSpell, SPELLS } from "@/data/catalog";
import {
  assignOrMoveSpell,
  listAssignOptions,
  uncoveredWindows,
  windowSuggestsPersonals,
  type AssignOption,
} from "@/domain/autoAssign";
import { formatTime, parseTimeInput, sortedWindows } from "@/domain/time";
import {
  SPEC_CLASS_COLOR,
  timelineHorizonSec,
  type Assignment,
  type Boss,
  type Healer,
  type Tank,
} from "@/domain/types";

interface Props {
  boss: Boss;
  roster: Healer[];
  tanks: Tank[];
  assignments: Assignment[];
  noteWindowIds: string[];
  personalWindowIds: string[];
  onChange: (assignments: Assignment[]) => void;
  onNoteWindowIdsChange: (ids: string[]) => void;
  onPersonalWindowIdsChange: (ids: string[]) => void;
  onAutoAssign: () => void;
  onReset: () => void;
  onWindowTimeChange: (windowId: string, timeSec: number) => void;
}

const CATEGORY_LABEL = {
  throughput: "Throughput CD",
  defensive: "Raid DR",
  external: "Tank external",
} as const;

function abilityLabel(boss: Boss, windowId: string): string {
  return boss.windows.find((w) => w.id === windowId)?.ability ?? windowId;
}

function CdAssignSelect({
  boss,
  options,
  personalsOn,
  suggestPersonals,
  onPick,
  onPickPersonals,
}: {
  boss: Boss;
  options: AssignOption[];
  personalsOn: boolean;
  suggestPersonals: boolean;
  onPick: (healerId: string, spellId: string) => void;
  onPickPersonals: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const available = options.filter((o) => !o.onThisWindow);
  const readyOpts = available.filter((o) => o.ready);
  const busyOpts = available.filter((o) => !o.ready);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const empty = available.length === 0 && personalsOn;

  function renderOpt(opt: AssignOption) {
    const from = opt.conflicts
      .map((c) => abilityLabel(boss, c.windowId))
      .join(", ");
    return (
      <button
        key={`${opt.healer.id}|${opt.spell.id}`}
        type="button"
        onClick={() => {
          onPick(opt.healer.id, opt.spell.id);
          setOpen(false);
        }}
        className={`flex w-full flex-col items-start gap-0.5 border-b border-white/5 px-2 py-1.5 text-left last:border-0 hover:bg-white/5 ${
          opt.ready ? "text-white/85" : "text-white/30"
        }`}
      >
        <span className="w-full truncate text-xs">
          → {opt.healer.name} — {opt.spell.name}
        </span>
        {!opt.ready && (
          <span className="w-full truncate text-[10px] text-amber-200/40">
            on CD
            {from ? ` @ ${from}` : ""}
            {opt.readyAtSec != null
              ? ` · ready ${formatTime(opt.readyAtSec)}`
              : ""}{" "}
            · move
          </span>
        )}
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative w-full min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full max-w-full items-center justify-between gap-2 rounded border border-white/10 bg-slate-950/80 px-1.5 py-1 text-left text-xs text-white/70 hover:bg-slate-950"
      >
        <span className="truncate">Add CD…</span>
        <span className="shrink-0 text-white/35">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto overflow-x-hidden rounded border border-white/15 bg-slate-950 shadow-xl">
          {!personalsOn && (
            <button
              type="button"
              onClick={() => {
                onPickPersonals();
                setOpen(false);
              }}
              className="flex w-full flex-col items-start gap-0.5 border-b border-white/10 px-2 py-1.5 text-left text-amber-100/90 hover:bg-amber-500/10"
            >
              <span className="w-full truncate text-xs">
                → Raid personals
                {suggestPersonals ? " · suggested" : ""}
              </span>
              <span className="w-full truncate text-[10px] text-amber-200/50">
                Whole raid personal defensives
              </span>
            </button>
          )}
          {empty ? (
            <div className="px-2 py-2 text-xs text-white/35">
              All roster CDs already here
            </div>
          ) : (
            <>
              {readyOpts.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-white/30">
                    Ready
                  </div>
                  {readyOpts.map(renderOpt)}
                </>
              )}
              {busyOpts.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-white/30">
                    On cooldown
                  </div>
                  {busyOpts.map(renderOpt)}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Timeline({
  boss,
  roster,
  tanks,
  assignments,
  noteWindowIds,
  personalWindowIds,
  onChange,
  onNoteWindowIdsChange,
  onPersonalWindowIdsChange,
  onAutoAssign,
  onReset,
  onWindowTimeChange,
}: Props) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [cdOnly, setCdOnly] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const notesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSourceOpen(false);
    setHowToOpen(false);
    setNotesOpen(false);
  }, [boss.id]);
  useEffect(() => {
    if (!notesOpen) return;
    function onDoc(e: MouseEvent) {
      if (!notesRef.current?.contains(e.target as Node)) setNotesOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [notesOpen]);
  const windows = sortedWindows(boss.windows);
  const visibleWindows = cdOnly
    ? windows.filter((w) => w.assignCd !== false)
    : windows;
  const maxTime = timelineHorizonSec(boss);
  const uncovered = uncoveredWindows(
    boss,
    assignments,
    undefined,
    personalWindowIds,
  );
  const noteSet = new Set(noteWindowIds);
  const personalSet = new Set(personalWindowIds);
  const rulerWindows = windows.filter((w) => w.assignCd !== false);

  function clearWindow(windowId: string) {
    onChange(assignments.filter((a) => a.windowId !== windowId));
    if (personalSet.has(windowId)) {
      onPersonalWindowIdsChange(
        personalWindowIds.filter((id) => id !== windowId),
      );
    }
  }

  function removeAssignment(assignmentId: string) {
    onChange(assignments.filter((a) => a.id !== assignmentId));
  }

  function assignToWindow(windowId: string, healerId: string, spellId: string) {
    const window = boss.windows.find((w) => w.id === windowId);
    if (!window) return;
    onChange(
      assignOrMoveSpell(assignments, window, healerId, spellId, tanks, SPELLS),
    );
  }

  function setAssignmentTank(assignmentId: string, tankId: string) {
    onChange(
      assignments.map((a) =>
        a.id === assignmentId ? { ...a, tankId: tankId || undefined } : a,
      ),
    );
  }

  function toggleNote(windowId: string) {
    if (noteSet.has(windowId)) {
      onNoteWindowIdsChange(noteWindowIds.filter((id) => id !== windowId));
    } else {
      onNoteWindowIdsChange([...noteWindowIds, windowId]);
    }
  }

  function togglePersonals(windowId: string) {
    if (personalSet.has(windowId)) {
      onPersonalWindowIdsChange(
        personalWindowIds.filter((id) => id !== windowId),
      );
    } else {
      onPersonalWindowIdsChange([...personalWindowIds, windowId]);
      if (!noteSet.has(windowId)) {
        onNoteWindowIdsChange([...noteWindowIds, windowId]);
      }
    }
  }

  function selectCdNotes() {
    onNoteWindowIdsChange(
      boss.windows.filter((w) => w.assignCd !== false).map((w) => w.id),
    );
  }

  function selectAllNotes() {
    onNoteWindowIdsChange(boss.windows.map((w) => w.id));
  }

  function clearNotes() {
    onNoteWindowIdsChange([]);
  }

  function jumpToUncovered() {
    const first = uncovered[0];
    if (!first) return;
    document
      .getElementById(`window-${first.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAutoAssign}
          disabled={roster.length === 0}
          className="rounded-md bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Auto-assign CDs
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
        >
          Reset assignments
        </button>
        <button
          type="button"
          onClick={() => setCdOnly((v) => !v)}
          title={
            cdOnly
              ? "Showing only abilities that need a healer CD. Click to also show info rows."
              : "Showing CD and info rows. Click to hide info-only abilities."
          }
          className={`rounded-md border px-3 py-1.5 text-sm ${
            cdOnly
              ? "border-teal-500/40 bg-teal-500/10 text-teal-200"
              : "border-white/15 text-white/60 hover:bg-white/5"
          }`}
        >
          CD windows only
        </button>
        {uncovered.length > 0 && (
          <button
            type="button"
            onClick={jumpToUncovered}
            className="rounded-md border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-200 hover:bg-amber-500/25"
          >
            {uncovered.length} uncovered →
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs">
          {boss.sourceUrl && (
            <a
              href={boss.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-teal-300 underline-offset-2 hover:underline"
            >
              Source
            </a>
          )}
          {boss.source && (
            <button
              type="button"
              onClick={() => setSourceOpen((v) => !v)}
              className="text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
            >
              {sourceOpen ? "Hide timers" : "Timers"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setHowToOpen((v) => !v)}
            className="text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
          >
            {howToOpen ? "Hide how-to" : "How-to"}
          </button>
          <div ref={notesRef} className="relative">
            <button
              type="button"
              onClick={() => setNotesOpen((v) => !v)}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/60 hover:bg-white/5"
              title={
                noteWindowIds.length === 1
                  ? "1 ability to copy on note"
                  : `${noteWindowIds.length} abilities to copy on note`
              }
            >
              Note · {noteWindowIds.length} ▾
            </button>
            {notesOpen && (
              <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded border border-white/15 bg-slate-950 shadow-xl">
                <div className="border-b border-white/10 px-3 py-1.5 text-[10px] leading-snug text-white/40">
                  {noteWindowIds.length === 1
                    ? "1 ability to copy on note"
                    : `${noteWindowIds.length} abilities to copy on note`}
                  . Choose which boss abilities appear in the copied note.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    selectCdNotes();
                    setNotesOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-white/70 hover:bg-white/5"
                >
                  CD windows only
                </button>
                <button
                  type="button"
                  onClick={() => {
                    selectAllNotes();
                    setNotesOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-white/70 hover:bg-white/5"
                >
                  All windows
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearNotes();
                    setNotesOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-white/70 hover:bg-white/5"
                >
                  None
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {howToOpen && (
        <p className="text-xs leading-relaxed text-white/50">
          Stack multiple CDs per ability. Spells still on cooldown show faded —
          picking one moves it here. Ready spells are added without replacing
          others. Raid personals = whole-raid defensive call. The Note column
          checkboxes choose which abilities appear when you press Copy NSRT.
        </p>
      )}
      {sourceOpen && boss.source && (
        <p className="text-[11px] leading-relaxed text-white/35">{boss.source}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/50 p-4">
        <div
          className="relative"
          style={{
            minWidth: Math.max(720, Math.ceil(maxTime * 2.8)),
            height: 72,
          }}
        >
          <div className="absolute inset-x-0 top-7 h-px bg-gradient-to-r from-transparent via-teal-400/35 to-transparent" />

          {Array.from(
            { length: Math.floor(maxTime / 60) + 1 },
            (_, i) => i * 60,
          ).map((sec) => (
            <div
              key={`tick-${sec}`}
              className="absolute top-5 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${(sec / maxTime) * 100}%` }}
            >
              <div className="h-3 w-px bg-white/20" />
              <span className="mt-8 font-mono text-[10px] text-white/30">
                {formatTime(sec)}
              </span>
            </div>
          ))}

          {boss.enrageSec != null && (
            <div
              className="absolute top-1 z-10 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${(boss.enrageSec / maxTime) * 100}%` }}
              title={`${formatTime(boss.enrageSec)} ${boss.enrageName ?? "Enrage"}`}
            >
              <div className="h-10 w-px bg-rose-400/70" />
              <span className="mt-0.5 whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-rose-300/90">
                {boss.enrageName ?? "Enrage"}
              </span>
            </div>
          )}

          {rulerWindows.map((w) => {
            const left = (w.timeSec / maxTime) * 100;
            const assigned = assignments.filter((a) => a.windowId === w.id);
            const personals = personalSet.has(w.id);
            const isUncovered = assigned.length === 0 && !personals;
            const inNote = noteSet.has(w.id);
            const hasAssign = assigned.length > 0 || personals;
            const spellNames = assigned
              .map((a) => getSpell(a.spellId)?.name)
              .filter(Boolean)
              .join(", ");
            const tip = [
              `${formatTime(w.timeSec)} ${w.ability}`,
              "CD window",
              inNote ? "in note" : "not in note",
              personals ? "raid personals" : null,
              spellNames || (personals ? null : "unassigned"),
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <button
                key={w.id}
                type="button"
                title={tip}
                aria-label={tip}
                className={`absolute top-[22px] z-[5] h-3 w-3 -translate-x-1/2 rounded-full border-2 transition hover:scale-125 ${
                  personals
                    ? "border-amber-300 bg-amber-400"
                    : hasAssign
                      ? "border-teal-300 bg-teal-400"
                      : isUncovered
                        ? "border-amber-400 bg-amber-400/30"
                        : "border-teal-300 bg-teal-400"
                } ${inNote ? "ring-2 ring-teal-300/30" : ""}`}
                style={{ left: `${left}%` }}
                onClick={() => {
                  document
                    .getElementById(`window-${w.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }}
              />
            );
          })}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-white/35">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-teal-400" /> Healer CD
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> Personals
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-amber-400 bg-amber-400/30" />{" "}
            Open
          </span>
          <span className="text-white/25">
            CD windows only · hover for name · click jumps to row
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="hidden grid-cols-[100px_56px_1fr_1fr] gap-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/35 sm:grid">
          <span>Time</span>
          <span title="Checked abilities appear when you press Copy NSRT">
            Note
          </span>
          <span>Boss ability</span>
          <span>Healer CDs / raid personals</span>
        </div>
        {visibleWindows.map((w) => {
          const assigned = assignments.filter((a) => a.windowId === w.id);
          const needsCd = w.assignCd !== false;
          const inNote = noteSet.has(w.id);
          const personals = personalSet.has(w.id);
          const options = listAssignOptions(
            roster,
            assignments,
            w.id,
            w.timeSec,
            SPELLS,
          );

          return (
            <div
              key={w.id}
              id={`window-${w.id}`}
              className={`grid gap-3 rounded-lg border p-3 sm:grid-cols-[100px_56px_1fr_1fr] ${
                needsCd
                  ? "border-white/10 bg-white/[0.03]"
                  : "border-white/5 bg-white/[0.015]"
              }`}
            >
              <div>
                <input
                  key={`${w.id}-${w.timeSec}`}
                  defaultValue={formatTime(w.timeSec)}
                  onBlur={(e) => {
                    const next = parseTimeInput(e.target.value);
                    if (next === null) {
                      e.target.value = formatTime(w.timeSec);
                      return;
                    }
                    onWindowTimeChange(w.id, next);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="w-full rounded-md border border-white/15 bg-slate-950/70 px-2 py-1.5 font-mono text-sm text-teal-300 outline-none focus:border-teal-400/60"
                  aria-label={`Time for ${w.ability}`}
                  title="Edit time (mm:ss)"
                />
                <div className="mt-1 text-[10px] uppercase tracking-wide text-white/35">
                  P{w.phase ?? 1} · {CATEGORY_LABEL[w.category]}
                </div>
              </div>

              <div className="flex items-start pt-1.5">
                <label
                  className="flex cursor-pointer items-center gap-1.5 text-xs text-white/55"
                  title="Checked = this ability appears when you press Copy NSRT"
                >
                  <input
                    type="checkbox"
                    checked={inNote}
                    onChange={() => toggleNote(w.id)}
                    className="rounded border-white/20 bg-slate-950 text-teal-500 focus:ring-teal-400/40"
                  />
                  <span className="sm:sr-only">In note</span>
                </label>
              </div>

              <div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`font-medium ${needsCd ? "text-white" : "text-white/60"}`}
                  >
                    {w.ability}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      needsCd
                        ? "bg-teal-500/20 text-teal-200"
                        : "bg-white/10 text-white/45"
                    }`}
                  >
                    {needsCd ? "CD" : "Info"}
                  </span>
                  {personals && (
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-amber-500/20 text-amber-100">
                      Personals
                    </span>
                  )}
                  {w.abilitySpellId ? (
                    <a
                      href={`https://www.wowhead.com/spell=${w.abilitySpellId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] text-white/35 hover:text-teal-300"
                    >
                      {w.abilitySpellId}
                    </a>
                  ) : null}
                </div>
                {w.note ? (
                  <div className="mt-1 text-xs leading-relaxed text-white/55">
                    {w.note}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-white/35">{w.trigger}</div>
                )}
              </div>

              <div className="min-w-0 space-y-2">
                {!needsCd ? (
                  <span className="text-sm text-white/35">
                    No major CD needed
                  </span>
                ) : assigned.length === 0 && !personals ? (
                  <span className="text-sm text-amber-300/80">
                    {windowSuggestsPersonals(w)
                      ? "Suggested: raid personals →"
                      : "No CD assigned →"}
                  </span>
                ) : null}
                {personals && (
                  <div className="flex items-start justify-between gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-sm text-amber-100/90">
                    <span>Raid personals</span>
                    <button
                      type="button"
                      onClick={() => togglePersonals(w.id)}
                      className="shrink-0 text-[10px] text-white/40 hover:text-rose-300"
                      title="Remove raid personals"
                    >
                      ✕
                    </button>
                  </div>
                )}
                {assigned.map((a) => {
                  const healer = roster.find((h) => h.id === a.healerId);
                  const spell = getSpell(a.spellId);
                  const isExternal = spell?.kind === "tankExternal";
                  return (
                    <div
                      key={a.id}
                      id={`assignment-${a.id}`}
                      className="min-w-0 space-y-1 rounded-md border border-teal-500/20 bg-teal-500/10 px-2 py-1.5 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 truncate">
                          <span className="text-teal-200">{spell?.name}</span>
                          <span className="text-white/35"> → </span>
                          <span
                            style={{
                              color: healer
                                ? SPEC_CLASS_COLOR[healer.spec]
                                : undefined,
                            }}
                          >
                            {healer?.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAssignment(a.id)}
                          className="shrink-0 text-[10px] text-white/40 hover:text-rose-300"
                          title="Remove this CD"
                        >
                          ✕
                        </button>
                      </div>
                      {isExternal && (
                        <div className="space-y-1">
                          <select
                            value={a.tankId ?? ""}
                            onChange={(e) =>
                              setAssignmentTank(a.id, e.target.value)
                            }
                            className={`w-full max-w-full rounded border bg-slate-950/80 px-1.5 py-1 text-xs text-white ${
                              a.tankId
                                ? "border-white/10"
                                : "border-amber-400/50"
                            }`}
                          >
                            <option value="">Tank target…</option>
                            {tanks.map((t) => (
                              <option key={t.id} value={t.id}>
                                → {t.name}
                              </option>
                            ))}
                          </select>
                          {!a.tankId && (
                            <div className="text-[10px] text-amber-200/80">
                              Pick a tank target
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <CdAssignSelect
                      boss={boss}
                      options={options}
                      personalsOn={personals}
                      suggestPersonals={windowSuggestsPersonals(w)}
                      onPick={(healerId, spellId) =>
                        assignToWindow(w.id, healerId, spellId)
                      }
                      onPickPersonals={() => togglePersonals(w.id)}
                    />
                  </div>
                  {(assigned.length > 0 || personals) && (
                    <button
                      type="button"
                      onClick={() => clearWindow(w.id)}
                      className="shrink-0 text-[10px] text-white/40 hover:text-white"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
