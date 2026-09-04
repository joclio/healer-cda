"use client";

import { useState } from "react";
import { toNsrtNote, toTextNote } from "@/export/notes";
import type { Boss, Plan } from "@/domain/types";

interface Props {
  plan: Plan;
  boss: Boss;
}

/** Compact Copy NSRT for the plan header. */
export function CopyNsrtButton({ plan, boss }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(toNsrtNote(plan, boss));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md bg-teal-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400"
    >
      {copied ? "Copied NSRT" : "Copy NSRT"}
    </button>
  );
}

export function ExportPanel({ plan, boss }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyText() {
    await navigator.clipboard.writeText(toTextNote(plan, boss));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const text = toTextNote(plan, boss);
  const nsrt = toNsrtNote(plan, boss);

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
        <button
          type="button"
          onClick={copyText}
          className="rounded-md bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/15"
        >
          {copied ? "Copied" : "Copy text"}
        </button>
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
          <div>
            <h3 className="mb-2 text-sm font-medium text-white">NSRT note</h3>
            <p className="mb-2 text-[11px] text-white/40">
              Paste into Northern Sky Raid Tools via /ns → Shared Notes → Import
            </p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-white/70">
              {nsrt}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
