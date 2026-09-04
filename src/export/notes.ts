import { getSpell } from "@/data/catalog";
import { formatTime } from "@/domain/time";
import type { Assignment, Boss, Healer, Plan, Tank } from "@/domain/types";

function healerName(roster: Healer[], id: string): string {
  return roster.find((h) => h.id === id)?.name ?? id;
}

function tankName(tanks: Tank[], id: string | undefined): string | null {
  if (!id) return null;
  return tanks.find((t) => t.id === id)?.name ?? id;
}

function noteWindows(plan: Plan, boss: Boss) {
  const include = new Set(plan.noteWindowIds);
  return [...boss.windows]
    .filter((w) => include.has(w.id))
    .sort((a, b) => a.timeSec - b.timeSec);
}

export function toTextNote(plan: Plan, boss: Boss): string {
  const lines = [
    `Healer CDA — ${boss.name} (${boss.difficulty})`,
    "─".repeat(40),
  ];

  const windows = noteWindows(plan, boss);
  const personalSet = new Set(plan.personalWindowIds ?? []);
  if (windows.length === 0) {
    lines.push("(no abilities selected for note)");
    return lines.join("\n");
  }

  for (const window of windows) {
    const assigned = plan.assignments.filter((a) => a.windowId === window.id);
    const personals = personalSet.has(window.id);
    lines.push(`${formatTime(window.timeSec)}  ${window.ability}`);
    if (personals) {
      lines.push(`         → Raid personals`);
    }
    if (assigned.length === 0 && !personals) {
      lines.push(`         (no CD assigned)`);
      continue;
    }
    for (const a of assigned) {
      const spell = getSpell(a.spellId);
      const tag =
        spell?.kind === "tankExternal"
          ? " (Tank)"
          : spell?.kind === "raidDefensive"
            ? " (DR)"
            : "";
      const onTank = tankName(plan.tanks, a.tankId);
      const target = onTank ? ` → ${onTank}` : "";
      lines.push(
        `         → ${spell?.name ?? a.spellId}${tag} — ${healerName(plan.roster, a.healerId)}${target}`,
      );
    }
  }

  if (boss.enrageSec != null) {
    lines.push(
      `${formatTime(boss.enrageSec)}  ${boss.enrageName ?? "Enrage"} (kill by)`,
    );
  }

  return lines.join("\n");
}

export function toNsrtNote(plan: Plan, boss: Boss): string {
  const lines: string[] = [
    `{${boss.name}}`,
    `EncounterID:${boss.encounterId}`,
  ];

  const windows = noteWindows(plan, boss);
  const personalSet = new Set(plan.personalWindowIds ?? []);

  for (const window of windows) {
    const assigned = plan.assignments.filter((a) => a.windowId === window.id);
    const phase = window.phase ?? 1;
    const personals = personalSet.has(window.id);

    if (personals) {
      lines.push(
        [
          `EncounterID:${boss.encounterId}`,
          `time:${window.timeSec}`,
          `ph:${phase}`,
          `text:Raid personals @ ${window.ability}`,
          `countdown:5`,
        ].join(";"),
      );
    }

    if (assigned.length === 0) {
      if (personals) continue;
      lines.push(
        [
          `EncounterID:${boss.encounterId}`,
          `time:${window.timeSec}`,
          `ph:${phase}`,
          `text:${window.ability}`,
          `countdown:5`,
        ].join(";"),
      );
      continue;
    }

    for (const a of assigned) {
      const spell = getSpell(a.spellId);
      const healer = healerName(plan.roster, a.healerId);
      const onTank = tankName(plan.tanks, a.tankId);
      const text = spell
        ? onTank
          ? `${healer} ${spell.name} → ${onTank} @ ${window.ability}`
          : `${healer} ${spell.name} @ ${window.ability}`
        : `${healer} ${a.spellId}`;

      lines.push(
        [
          `EncounterID:${boss.encounterId}`,
          `time:${a.timeSec}`,
          `ph:${phase}`,
          `tag:{${healer}}`,
          spell ? `spellid:${spell.spellId}` : null,
          `text:${text}`,
          `countdown:5`,
        ]
          .filter(Boolean)
          .join(";"),
      );
    }
  }

  return lines.join("\n");
}

export function assignmentLabel(
  a: Assignment,
  roster: Healer[],
): { spellName: string; healerName: string } {
  return {
    spellName: getSpell(a.spellId)?.name ?? a.spellId,
    healerName: healerName(roster, a.healerId),
  };
}
