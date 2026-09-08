"use client";

import { useEffect, useRef, useState } from "react";
import type { AssignOption, UtilityAssignOption } from "@/domain/autoAssign";
import { formatTime } from "@/domain/time";
import type { Boss } from "@/domain/types";

function abilityLabel(boss: Boss, windowId: string): string {
  return boss.windows.find((w) => w.id === windowId)?.ability ?? windowId;
}

interface Props {
  boss: Boss;
  options: AssignOption[];
  utilityOptions: UtilityAssignOption[];
  personalsOn: boolean;
  suggestPersonals: boolean;
  onPick: (healerId: string, spellId: string) => void;
  onPickUtility: (utilityId: string, spellId: string) => void;
  onPickPersonals: () => void;
}

export function CdAssignSelect({
  boss,
  options,
  utilityOptions,
  personalsOn,
  suggestPersonals,
  onPick,
  onPickUtility,
  onPickPersonals,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const available = options.filter((o) => !o.onThisWindow);
  const readyOpts = available.filter((o) => o.ready);
  const busyOpts = available.filter((o) => !o.ready);
  const utilAvailable = utilityOptions.filter((o) => !o.onThisWindow);
  const utilReady = utilAvailable.filter((o) => o.ready);
  const utilBusy = utilAvailable.filter((o) => !o.ready);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const empty =
    available.length === 0 && utilAvailable.length === 0 && personalsOn;

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

  function renderUtil(opt: UtilityAssignOption) {
    const from = opt.conflicts
      .map((c) => abilityLabel(boss, c.windowId))
      .join(", ");
    return (
      <button
        key={`u-${opt.caster.id}|${opt.spell.id}`}
        type="button"
        onClick={() => {
          onPickUtility(opt.caster.id, opt.spell.id);
          setOpen(false);
        }}
        className={`flex w-full flex-col items-start gap-0.5 border-b border-white/5 px-2 py-1.5 text-left last:border-0 hover:bg-white/5 ${
          opt.ready ? "text-violet-100/90" : "text-white/30"
        }`}
      >
        <span className="w-full truncate text-xs">
          → {opt.caster.name} — {opt.spell.name}
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
              {(utilReady.length > 0 || utilBusy.length > 0) && (
                <>
                  <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-violet-300/50">
                    Raid utility
                  </div>
                  {utilReady.map(renderUtil)}
                  {utilBusy.map(renderUtil)}
                </>
              )}
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
