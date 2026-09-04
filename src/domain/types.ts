export type HealerSpec =
  | "resto-druid"
  | "holy-priest"
  | "disc-priest"
  | "resto-shaman"
  | "mistweaver"
  | "holy-paladin"
  | "preservation";

export type SpellKind =
  | "raidThroughput"
  | "raidDefensive"
  | "tankExternal"
  | "raidUtility";

export type WindowSeverity = "tank" | "raid" | "critical";
export type WindowCategory = "throughput" | "defensive" | "external";

export type BossGroup = "raid" | "lair";

/** Classes that bring tank/DPS raid utility CDs (Rally, AMZ, Darkness, …). */
export type UtilityClass =
  | "warrior"
  | "death-knight"
  | "demon-hunter"
  | "rogue";

export interface Spell {
  id: string;
  spellId: number;
  name: string;
  /** Healer specs that can cast this (healer CDs). */
  specs?: HealerSpec[];
  /** Classes that can cast this (raid utilities). */
  classes?: UtilityClass[];
  kind: SpellKind;
  cooldownSec: number;
  durationSec: number;
}

export interface DamageWindow {
  id: string;
  /** Pull-relative time for planner timeline (seconds). */
  timeSec: number;
  /** Boss ability / pressure name shown in the UI. */
  ability: string;
  /** In-game spell ID when known (BigWigs / journal / combat log). */
  abilitySpellId?: number;
  /** How this window is triggered (cast CD, HP%, stage). */
  trigger: string;
  severity: WindowSeverity;
  category: WindowCategory;
  phase?: number;
  /** Short mechanic description. */
  note?: string;
  /**
   * When true (default), auto-assign places a healer CD here.
   * Set false for informational casts (movement, eggs, etc.).
   */
  assignCd?: boolean;
  /**
   * Recommend a whole-raid personal defensive call on this ability.
   * Auto-assign personals targets these windows; UI shows as suggested in Add CD.
   */
  suggestPersonals?: boolean;
  /**
   * Default for “include in note” when opening a plan.
   * Defaults to same as assignCd (CD windows on, info off).
   */
  includeInNote?: boolean;
}

export interface Boss {
  id: string;
  name: string;
  shortName: string;
  encounterId: number;
  group: BossGroup;
  difficulty: string;
  order: number;
  /** Where ability names / timers were taken from. */
  source: string;
  sourceUrl?: string;
  /**
   * Hard/soft enrage from pull (seconds). Timeline scales to this when set
   * so the full fight is visible by default.
   */
  enrageSec?: number;
  /** Display name for the enrage marker (e.g. Fury Unleashed). */
  enrageName?: string;
  windows: DamageWindow[];
}

export interface Healer {
  id: string;
  name: string;
  spec: HealerSpec;
}

/** Tank class (for display / color; externals don't care about spec). */
export type TankClass =
  | "warrior"
  | "paladin"
  | "death-knight"
  | "monk"
  | "druid"
  | "demon-hunter";

/** Tank who can be the target of healer externals. */
export interface Tank {
  id: string;
  name: string;
  class?: TankClass;
}

export const TANK_CLASS_LABELS: Record<TankClass, string> = {
  warrior: "Warrior",
  paladin: "Paladin",
  "death-knight": "Death Knight",
  monk: "Monk",
  druid: "Druid",
  "demon-hunter": "Demon Hunter",
};

/** Tank-spec names without class (class shown separately in UI). */
export const TANK_SPEC_LABELS: Record<TankClass, string> = {
  warrior: "Protection",
  paladin: "Protection",
  "death-knight": "Blood",
  monk: "Brewmaster",
  druid: "Guardian",
  "demon-hunter": "Vengeance",
};

export const TANK_CLASS_COLOR: Record<TankClass, string> = {
  warrior: "#C69B6D",
  paladin: "#F48CBA",
  "death-knight": "#C41E3A",
  monk: "#00FF98",
  druid: "#FF7C0A",
  "demon-hunter": "#A330C9",
};

export interface UtilityCaster {
  id: string;
  name: string;
  class: UtilityClass;
}

export interface Assignment {
  id: string;
  windowId: string;
  /** Healer assignee (healer CDs / externals). */
  healerId?: string;
  /** Utility / tank assignee (raid utility CDs). */
  utilityId?: string;
  spellId: string;
  timeSec: number;
  /** Target tank when the spell is a tank external. */
  tankId?: string;
}

export interface Plan {
  bossId: string;
  roster: Healer[];
  tanks: Tank[];
  utilities: UtilityCaster[];
  assignments: Assignment[];
  /** Window ids that should appear in exported notes. */
  noteWindowIds: string[];
  /** Windows where the whole raid uses personal defensives. */
  personalWindowIds: string[];
}

export const UTILITY_CLASS_LABELS: Record<UtilityClass, string> = {
  warrior: "Warrior",
  "death-knight": "Death Knight",
  "demon-hunter": "Demon Hunter",
  rogue: "Rogue",
};

export const UTILITY_CLASS_COLOR: Record<UtilityClass, string> = {
  warrior: "#C69B6D",
  "death-knight": "#C41E3A",
  "demon-hunter": "#A330C9",
  rogue: "#FFF468",
};

export function isUtilityClass(cls: string | undefined): cls is UtilityClass {
  return (
    cls === "warrior" ||
    cls === "death-knight" ||
    cls === "demon-hunter" ||
    cls === "rogue"
  );
}

/** Assignee id for cooldown tracking (healer or utility). */
export function assignmentAssigneeId(a: Assignment): string | undefined {
  return a.utilityId ?? a.healerId;
}

export const SPEC_LABELS: Record<HealerSpec, string> = {
  "resto-druid": "Restoration Druid",
  "holy-priest": "Holy Priest",
  "disc-priest": "Discipline Priest",
  "resto-shaman": "Restoration Shaman",
  mistweaver: "Mistweaver Monk",
  "holy-paladin": "Holy Paladin",
  preservation: "Preservation Evoker",
};

/** Compact labels for tight UI (edit selects, pick list). */
export const SPEC_SHORT_LABELS: Record<HealerSpec, string> = {
  "resto-druid": "Resto",
  "holy-priest": "Holy",
  "disc-priest": "Discipline",
  "resto-shaman": "Resto",
  mistweaver: "Mistweaver",
  "holy-paladin": "Holy",
  preservation: "Preservation",
};

export const SPEC_CLASS_COLOR: Record<HealerSpec, string> = {
  "resto-druid": "#FF7C0A",
  "holy-priest": "#FFFFFF",
  "disc-priest": "#FFFFFF",
  "resto-shaman": "#0070DD",
  mistweaver: "#00FF98",
  "holy-paladin": "#F48CBA",
  preservation: "#33937F",
};

export type HealerClass =
  | "druid"
  | "priest"
  | "shaman"
  | "monk"
  | "paladin"
  | "evoker";

export const HEALER_CLASS_LABELS: Record<HealerClass, string> = {
  druid: "Druid",
  priest: "Priest",
  shaman: "Shaman",
  monk: "Monk",
  paladin: "Paladin",
  evoker: "Evoker",
};

export const SPEC_TO_CLASS: Record<HealerSpec, HealerClass> = {
  "resto-druid": "druid",
  "holy-priest": "priest",
  "disc-priest": "priest",
  "resto-shaman": "shaman",
  mistweaver: "monk",
  "holy-paladin": "paladin",
  preservation: "evoker",
};

export const DEFAULT_SPEC_FOR_CLASS: Record<HealerClass, HealerSpec> = {
  druid: "resto-druid",
  priest: "holy-priest",
  shaman: "resto-shaman",
  monk: "mistweaver",
  paladin: "holy-paladin",
  evoker: "preservation",
};

export function specsForClass(cls: HealerClass): HealerSpec[] {
  return (Object.keys(SPEC_TO_CLASS) as HealerSpec[]).filter(
    (s) => SPEC_TO_CLASS[s] === cls,
  );
}

/** Default windows to export: CD rows, or explicit includeInNote. */
export function defaultNoteWindowIds(boss: Boss): string[] {
  return boss.windows
    .filter((w) => {
      if (w.includeInNote !== undefined) return w.includeInNote;
      return w.assignCd !== false;
    })
    .map((w) => w.id);
}

/** Timeline horizon — always enrage when set. */
export function timelineHorizonSec(boss: Boss): number {
  const last = Math.max(0, ...boss.windows.map((w) => w.timeSec));
  return Math.max(boss.enrageSec ?? 0, last, 60);
}
