"use client";

import { useEffect, useRef, useState } from "react";
import { TimelineRuler } from "@/components/TimelineRuler";
import { WindowRow } from "@/components/WindowRow";
import { SPELLS } from "@/data/catalog";
import {
  assignOrMoveSpell,
  assignOrMoveUtility,
  uncoveredWindows,
} from "@/domain/autoAssign";
import { sortedWindows } from "@/domain/time";
import {
  timelineHorizonSec,
  type Assignment,
  type Boss,
  type Healer,
  type Tank,
  type UtilityCaster,
} from "@/domain/types";

interface Props {
  boss: Boss;
  roster: Healer[];
  tanks: Tank[];
  utilities: UtilityCaster[];
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

export function Timeline({
  boss,
  roster,
  tanks,
  utilities,
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
  const [menuBossId, setMenuBossId] = useState(boss.id);
  const notesRef = useRef<HTMLDivElement>(null);
  if (boss.id !== menuBossId) {
    setMenuBossId(boss.id);
    setSourceOpen(false);
    setHowToOpen(false);
    setNotesOpen(false);
  }
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

  function assignUtilityToWindow(
    windowId: string,
    utilityId: string,
    spellId: string,
  ) {
    const window = boss.windows.find((w) => w.id === windowId);
    if (!window) return;
    onChange(
      assignOrMoveUtility(assignments, window, utilityId, spellId, SPELLS),
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

      <TimelineRuler
        boss={boss}
        maxTime={maxTime}
        rulerWindows={rulerWindows}
        assignments={assignments}
        personalSet={personalSet}
        noteSet={noteSet}
      />

      <div className="space-y-2">
        <div className="hidden grid-cols-[100px_56px_1fr_1fr] gap-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/35 sm:grid">
          <span>Time</span>
          <span title="Checked abilities appear when you press Copy NSRT">
            Note
          </span>
          <span>Boss ability</span>
          <span>Healer CDs / utilities / personals</span>
        </div>
        {visibleWindows.map((w) => (
          <WindowRow
            key={w.id}
            window={w}
            boss={boss}
            roster={roster}
            tanks={tanks}
            utilities={utilities}
            assignments={assignments}
            inNote={noteSet.has(w.id)}
            personals={personalSet.has(w.id)}
            onToggleNote={() => toggleNote(w.id)}
            onTogglePersonals={() => togglePersonals(w.id)}
            onAssign={(healerId, spellId) =>
              assignToWindow(w.id, healerId, spellId)
            }
            onAssignUtility={(utilityId, spellId) =>
              assignUtilityToWindow(w.id, utilityId, spellId)
            }
            onRemoveAssignment={removeAssignment}
            onSetTank={setAssignmentTank}
            onClear={() => clearWindow(w.id)}
            onTimeChange={(timeSec) => onWindowTimeChange(w.id, timeSec)}
          />
        ))}
      </div>
    </div>
  );
}
