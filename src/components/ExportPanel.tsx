"use client";

import { useState } from "react";
import {
  toNsrtNote,
  toTextNote,
  toViserioNote,
  VISERIO_COOLDOWNS_URL,
} from "@/export/notes";
import type { Boss, Plan } from "@/domain/types";

interface Props {
  plan: Plan;
  boss: Boss;
}

async function copyText(body: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(body);
    return true;
  } catch {
    return false;
  }
}

function useCopyLabel(idle: string) {
  const [label, setLabel] = useState(idle);
  async function copy(body: string, okLabel: string) {
    const ok = await copyText(body);
    setLabel(ok ? okLabel : "Copy failed");
    setTimeout(() => setLabel(idle), 1500);
  }
  return { label, copy };
}

/** Compact Copy NSRT for the plan header. */
export function CopyNsrtButton({ plan, boss }: Props) {
  const { label, copy } = useCopyLabel("Copy NSRT");
  return (
    <button
      type="button"
      onClick={() => copy(toNsrtNote(plan, boss), "Copied NSRT")}
      className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400"
    >
      {label}
    </button>
  );
}

/** Copy NSRT note for pasting into Viserio Cooldowns CD Import. */
export function CopyViserioButton({ plan, boss }: Props) {
  const { label, copy } = useCopyLabel("Copy Viserio");
  return (
    <button
      type="button"
      title="Paste into Viserio Cooldowns → CD page → Import"
      onClick={() => copy(toViserioNote(plan, boss), "Copied Viserio")}
      className="rounded-md border border-teal-400/40 bg-teal-500/10 px-3 py-1.5 text-sm font-medium text-teal-100 hover:bg-teal-500/20"
    >
      {label}
    </button>
  );
}

export function ExportPanel({ plan, boss }: Props) {
  const [open, setOpen] = useState(false);
  const textCopy = useCopyLabel("Copy text");
  const nsrtCopy = useCopyLabel("Copy NSRT");
  const viserioCopy = useCopyLabel("Copy Viserio");

  const text = toTextNote(plan, boss);
  const nsrt = toNsrtNote(plan, boss);
  const viserio = toViserioNote(plan, boss);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm font-medium text-white hover:text-teal-200"
        >
          {open ? "Hide note preview" : "Show note preview"}
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => textCopy.copy(text, "Copied")}
            className="rounded-md bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/15"
          >
            {textCopy.label}
          </button>
          <button
            type="button"
            onClick={() => nsrtCopy.copy(nsrt, "Copied NSRT")}
            className="rounded-md bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/15"
          >
            {nsrtCopy.label}
          </button>
          <button
            type="button"
            onClick={() => viserioCopy.copy(viserio, "Copied Viserio")}
            className="rounded-md border border-teal-400/30 bg-teal-500/10 px-3 py-1 text-xs text-teal-100 hover:bg-teal-500/20"
          >
            {viserioCopy.label}
          </button>
        </div>
      </div>
      {open && (
        <div className="grid gap-4 border-t border-white/10 p-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-white">
              Readable note
            </h3>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-white/70">
              {text}
            </pre>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-medium text-white">NSRT note</h3>
              <p className="mb-2 text-[11px] text-white/40">
                Paste into Northern Sky Raid Tools via /ns → Shared Notes →
                Import.
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-white/70">
                {nsrt}
              </pre>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-white">
                Viserio Cooldowns
              </h3>
              <p className="mb-2 text-[11px] text-white/40">
                Spell-only NSRT lines (no long text:) so Import creates CD icons,
                not name chips. Open a boss CD page on{" "}
                <a
                  href={VISERIO_COOLDOWNS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-teal-300/80 underline-offset-2 hover:underline"
                >
                  wowutils.com/viserio-cooldowns
                </a>
                , click Import, paste, then confirm.
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-white/70">
                {viserio}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
