import { getSpell } from "@/data/catalog";
import { formatTime } from "@/domain/time";
import type {
  Assignment,
  Boss,
  Healer,
  Plan,
  Tank,
  UtilityCaster,
} from "@/domain/types";

function healerName(roster: Healer[], id: string | undefined): string {
  if (!id) return "?";
  return roster.find((h) => h.id === id)?.name ?? id;
}

function tankName(tanks: Tank[], id: string | undefined): string | null {
  if (!id) return null;
  return tanks.find((t) => t.id === id)?.name ?? id;
}

function utilityName(
  utilities: UtilityCaster[],
  tanks: Tank[],
  id: string | undefined,
): string {
  if (!id) return "?";
  return (
    utilities.find((u) => u.id === id)?.name ??
    tanks.find((t) => t.id === id)?.name ??
    id
  );
}

function assigneeName(plan: Plan, a: Assignment): string {
  if (a.utilityId) {
    return utilityName(plan.utilities ?? [], plan.tanks, a.utilityId);
  }
  return healerName(plan.roster, a.healerId);
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
            : spell?.kind === "raidUtility"
              ? " (Raid)"
              : "";
      const onTank = tankName(plan.tanks, a.tankId);
      const target = onTank ? ` → ${onTank}` : "";
      lines.push(
        `         → ${spell?.name ?? a.spellId}${tag} — ${assigneeName(plan, a)}${target}`,
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

/**
 * NSRT Shared Notes import format (Northern Sky Raid Tools):
 * - Header must include EncounterID + Name (+ Difficulty) or ImportFullReminderString drops it
 * - Reminder lines must NOT repeat EncounterID (parser skips firstline with EncounterID)
 * - Every reminder needs tag + time + (text|spellid); use tag:everyone for raid-wide calls
 * - Player tags are bare names (tag:Shammy), not {Shammy}
 * - Always ph:1 — our timeSec is pull-relative; window.phase is guide metadata only.
 *   Emitting ph:2/3 breaks Viserio import when that boss has no such phase.
 */
function nsrtLine(
  parts: Array<string | null | undefined | false>,
): string {
  return parts.filter(Boolean).join(";") + ";";
}

export function toNsrtNote(plan: Plan, boss: Boss): string {
  const lines: string[] = [
    nsrtLine([
      `EncounterID:${boss.encounterId}`,
      `Difficulty:${boss.difficulty}`,
      `Name:${boss.name}`,
    ]),
  ];

  const windows = noteWindows(plan, boss);
  const personalSet = new Set(plan.personalWindowIds ?? []);

  for (const window of windows) {
    const assigned = plan.assignments.filter((a) => a.windowId === window.id);
    const personals = personalSet.has(window.id);
    const bossSpell = window.abilitySpellId
      ? `bossSpell:${window.abilitySpellId}`
      : null;

    if (personals) {
      lines.push(
        nsrtLine([
          `time:${window.timeSec}`,
          `ph:1`,
          `tag:everyone`,
          `text:Raid personals @ ${window.ability}`,
          bossSpell,
          `countdown:5`,
        ]),
      );
    }

    if (assigned.length === 0) {
      if (personals) continue;
      lines.push(
        nsrtLine([
          `time:${window.timeSec}`,
          `ph:1`,
          `tag:everyone`,
          `text:${window.ability}`,
          bossSpell,
          `countdown:5`,
        ]),
      );
      continue;
    }

    for (const a of assigned) {
      const spell = getSpell(a.spellId);
      const who = assigneeName(plan, a);
      const onTank = tankName(plan.tanks, a.tankId);
      const text = spell
        ? onTank
          ? `${who} ${spell.name} → ${onTank} @ ${window.ability}`
          : spell.kind === "raidUtility"
            ? `${who} ${spell.name} (Raid) @ ${window.ability}`
            : `${who} ${spell.name} @ ${window.ability}`
        : `${who} ${a.spellId}`;

      lines.push(
        nsrtLine([
          `time:${a.timeSec}`,
          `ph:1`,
          `tag:${who}`,
          spell ? `spellid:${spell.spellId}` : null,
          `text:${text}`,
          bossSpell,
          `countdown:5`,
        ]),
      );
    }
  }

  return lines.join("\n");
}

/**
 * Viserio Cooldowns CD Import (NSRT paste).
 * Spell rows must be spellid-only — a long text: field makes Viserio treat the
 * line as a text reminder (class-colored chips with names, no spell icons).
 * Personals stay text reminders with tag:everyone. Skip bare ability rows.
 */
export function toViserioNote(plan: Plan, boss: Boss): string {
  const lines: string[] = [
    nsrtLine([
      `EncounterID:${boss.encounterId}`,
      `Difficulty:${boss.difficulty}`,
      `Name:${boss.name}`,
    ]),
  ];

  const windows = noteWindows(plan, boss);
  const personalSet = new Set(plan.personalWindowIds ?? []);

  for (const window of windows) {
    const assigned = plan.assignments.filter((a) => a.windowId === window.id);
    const personals = personalSet.has(window.id);
    const bossSpell = window.abilitySpellId
      ? `bossSpell:${window.abilitySpellId}`
      : null;

    if (personals) {
      lines.push(
        nsrtLine([
          `time:${window.timeSec}`,
          `ph:1`,
          `tag:everyone`,
          `text:Raid personals`,
          bossSpell,
          `countdown:5`,
        ]),
      );
    }

    for (const a of assigned) {
      const spell = getSpell(a.spellId);
      if (!spell) continue;
      const who = assigneeName(plan, a);
      const onTank = tankName(plan.tanks, a.tankId);

      lines.push(
        nsrtLine([
          `time:${a.timeSec}`,
          `ph:1`,
          `tag:${who}`,
          `spellid:${spell.spellId}`,
          bossSpell,
          onTank ? `glowunit:${onTank}` : null,
          `countdown:5`,
        ]),
      );
    }
  }

  return lines.join("\n");
}

export const VISERIO_COOLDOWNS_URL =
  "https://wowutils.com/viserio-cooldowns";

