"use client";

import { useState } from "react";
import { CopyNsrtButton, CopyViserioButton } from "@/components/ExportPanel";
import { getSpell } from "@/data/catalog";
import { planSkipNotice } from "@/domain/planFile";
import type { Boss, Plan } from "@/domain/types";

interface Props {
  boss: Boss;
  plan: Plan;
  timersDirty: boolean;
  onBack: () => void;
  onAutoAssign: () => void;
  onResetTimers: () => void;
  onDownloadPlan: () => void;
  onImportPlan: (
    raw: string,
  ) =>
    | { ok: true; skippedNames: number; skippedWindows: number }
    | { ok: false; error?: string };
}

export function PlanHeader({
  boss,
  plan,
  timersDirty,
  onBack,
  onAutoAssign,
  onResetTimers,
  onDownloadPlan,
  onImportPlan,
}: Props) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const missingTankAssignments = plan.assignments.filter((a) => {
    const spell = getSpell(a.spellId);
    return spell?.kind === "tankExternal" && !a.tankId;
  });

  return (
    <div className="sticky top-0 z-20 -mx-4 space-y-2 bg-[#071018] px-4 py-2 sm:-mx-6 sm:px-6">
      <div className="rounded-lg border border-white/10 bg-[#0c1820] px-4 py-3 text-sm text-white/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div>
              <span className="font-medium text-white">{boss.shortName}</span>
              <span className="text-white/35"> · </span>
              <span className="text-white/80">{boss.difficulty}</span>
            </div>
            {plan.roster.length > 0 && plan.assignments.length > 0 && (
              <div className="text-xs text-white/40">
                {plan.roster
                  .map((h) => {
                    const n = plan.assignments.filter(
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
              onClick={onBack}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onDownloadPlan}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5"
            >
              Download plan
            </button>
            <button
              type="button"
              onClick={() => {
                setPasteOpen((v) => !v);
                setPasteError(null);
                setPasteNotice(null);
              }}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5"
            >
              Paste plan
            </button>
            <CopyNsrtButton plan={plan} boss={boss} />
            <CopyViserioButton plan={plan} boss={boss} />
          </div>
        </div>
      </div>
      {pasteOpen && (
        <div className="space-y-2 rounded-md border border-white/10 bg-[#0c1820] px-3 py-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste a downloaded plan JSON"
            rows={4}
            className="w-full rounded border border-white/10 bg-slate-950/80 px-2 py-1.5 font-mono text-xs text-white/80 outline-none focus:border-teal-400/60"
          />
          <div className="flex items-center justify-between gap-2">
            {pasteError ? (
              <span className="text-xs text-amber-200/90">{pasteError}</span>
            ) : pasteNotice ? (
              <span className="text-xs text-amber-200/90">{pasteNotice}</span>
            ) : (
              <span className="text-xs text-white/35">
                Names are matched onto this browser&apos;s roster.
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                const result = onImportPlan(pasteText);
                if (result.ok) {
                  setPasteError(null);
                  const notice = planSkipNotice(
                    result.skippedNames,
                    result.skippedWindows,
                  );
                  if (notice) {
                    setPasteNotice(notice);
                    return;
                  }
                  setPasteOpen(false);
                  setPasteText("");
                  setPasteNotice(null);
                  return;
                }
                setPasteNotice(null);
                if (result.error) setPasteError(result.error);
              }}
              className="shrink-0 rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400"
            >
              Apply
            </button>
          </div>
        </div>
      )}
      {timersDirty && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/90">
          <span>Timers edited — Auto-assign again to refresh CD readiness.</span>
          <span className="flex shrink-0 gap-3">
            <button
              type="button"
              onClick={onResetTimers}
              className="font-medium text-amber-200 underline-offset-2 hover:underline"
            >
              Reset timers
            </button>
            <button
              type="button"
              onClick={onAutoAssign}
              disabled={plan.roster.length === 0}
              className="font-medium text-amber-200 underline-offset-2 hover:underline disabled:opacity-40"
            >
              Auto-assign
            </button>
          </span>
        </div>
      )}
      {missingTankAssignments.length > 0 && (
        <button
          type="button"
          onClick={() => {
            document
              .getElementById(`assignment-${missingTankAssignments[0].id}`)
              ?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
              });
          }}
          className="w-full rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-sm font-medium text-amber-100/90 hover:bg-amber-500/20"
        >
          {missingTankAssignments.length} tank external
          {missingTankAssignments.length === 1 ? "" : "s"} missing a tank
          target →
        </button>
      )}
    </div>
  );
}
