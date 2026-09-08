"use client";

import { CdAssignSelect } from "@/components/CdAssignSelect";
import { getSpell, SPELLS } from "@/data/catalog";
import {
  listAssignOptions,
  listUtilityAssignOptions,
  windowSuggestsPersonals,
} from "@/domain/autoAssign";
import { formatTime, parseTimeInput } from "@/domain/time";
import {
  SPEC_CLASS_COLOR,
  UTILITY_CLASS_COLOR,
  isUtilityClass,
  type Assignment,
  type Boss,
  type DamageWindow,
  type Healer,
  type Tank,
  type UtilityCaster,
} from "@/domain/types";

const CATEGORY_LABEL = {
  throughput: "Throughput CD",
  defensive: "Raid DR",
  external: "Tank external",
} as const;

interface Props {
  window: DamageWindow;
  boss: Boss;
  roster: Healer[];
  tanks: Tank[];
  utilities: UtilityCaster[];
  assignments: Assignment[];
  inNote: boolean;
  personals: boolean;
  onToggleNote: () => void;
  onTogglePersonals: () => void;
  onAssign: (healerId: string, spellId: string) => void;
  onAssignUtility: (utilityId: string, spellId: string) => void;
  onRemoveAssignment: (assignmentId: string) => void;
  onSetTank: (assignmentId: string, tankId: string) => void;
  onClear: () => void;
  onTimeChange: (timeSec: number) => void;
}

export function WindowRow({
  window: w,
  boss,
  roster,
  tanks,
  utilities,
  assignments,
  inNote,
  personals,
  onToggleNote,
  onTogglePersonals,
  onAssign,
  onAssignUtility,
  onRemoveAssignment,
  onSetTank,
  onClear,
  onTimeChange,
}: Props) {
  const assigned = assignments.filter((a) => a.windowId === w.id);
  const needsCd = w.assignCd !== false;
  const options = listAssignOptions(roster, assignments, w.id, w.timeSec, SPELLS);
  const utilityOptions = listUtilityAssignOptions(
    utilities,
    tanks,
    assignments,
    w.id,
    w.timeSec,
    SPELLS,
  );

  return (
    <div
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
            onTimeChange(next);
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
            onChange={onToggleNote}
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
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-100">
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
          <span className="text-sm text-white/35">No major CD needed</span>
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
              onClick={onTogglePersonals}
              className="shrink-0 text-[10px] text-white/40 hover:text-rose-300"
              title="Remove raid personals"
            >
              ✕
            </button>
          </div>
        )}
        {assigned.map((a) => {
          const healer = a.healerId
            ? roster.find((h) => h.id === a.healerId)
            : undefined;
          const util =
            a.utilityId != null
              ? utilities.find((u) => u.id === a.utilityId)
              : undefined;
          const tankCaster =
            a.utilityId != null && !util
              ? tanks.find((t) => t.id === a.utilityId)
              : undefined;
          const spell = getSpell(a.spellId);
          const isExternal = spell?.kind === "tankExternal";
          const isUtility = spell?.kind === "raidUtility";
          const casterName =
            healer?.name ?? util?.name ?? tankCaster?.name ?? "?";
          const casterColor = healer
            ? SPEC_CLASS_COLOR[healer.spec]
            : util
              ? UTILITY_CLASS_COLOR[util.class]
              : tankCaster?.class && isUtilityClass(tankCaster.class)
                ? UTILITY_CLASS_COLOR[tankCaster.class]
                : undefined;
          return (
            <div
              key={a.id}
              id={`assignment-${a.id}`}
              className={`min-w-0 space-y-1 rounded-md border px-2 py-1.5 text-sm ${
                isUtility
                  ? "border-violet-500/25 bg-violet-500/10"
                  : "border-teal-500/20 bg-teal-500/10"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate">
                  <span
                    className={isUtility ? "text-violet-200" : "text-teal-200"}
                  >
                    {spell?.name}
                  </span>
                  <span className="text-white/35"> → </span>
                  <span style={{ color: casterColor }}>{casterName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveAssignment(a.id)}
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
                    onChange={(e) => onSetTank(a.id, e.target.value)}
                    className={`w-full max-w-full rounded border bg-slate-950/80 px-1.5 py-1 text-xs text-white ${
                      a.tankId ? "border-white/10" : "border-amber-400/50"
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
              utilityOptions={utilityOptions}
              personalsOn={personals}
              suggestPersonals={windowSuggestsPersonals(w)}
              onPick={onAssign}
              onPickUtility={onAssignUtility}
              onPickPersonals={onTogglePersonals}
            />
          </div>
          {(assigned.length > 0 || personals) && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-[10px] text-white/40 hover:text-white"
            >
              Clear all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
