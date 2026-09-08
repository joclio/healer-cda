import { getSpell } from "@/data/catalog";
import { formatTime } from "@/domain/time";
import type { Assignment, Boss, DamageWindow } from "@/domain/types";

interface Props {
  boss: Boss;
  maxTime: number;
  rulerWindows: DamageWindow[];
  assignments: Assignment[];
  personalSet: Set<string>;
  noteSet: Set<string>;
}

export function TimelineRuler({
  boss,
  maxTime,
  rulerWindows,
  assignments,
  personalSet,
  noteSet,
}: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/50 p-4">
      <div
        className="relative"
        style={{
          minWidth: Math.max(720, Math.ceil(maxTime * 2.8)),
          height: 72,
        }}
      >
        <div className="absolute inset-x-0 top-7 h-px bg-gradient-to-r from-transparent via-teal-400/35 to-transparent" />

        {Array.from({ length: Math.floor(maxTime / 60) + 1 }, (_, i) => i * 60).map(
          (sec) => (
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
          ),
        )}

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
  );
}
