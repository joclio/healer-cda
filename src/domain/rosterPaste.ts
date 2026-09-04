import type { HealerSpec, TankClass } from "@/domain/types";

export type PastedHealer = { name: string; spec: HealerSpec };
export type PastedTank = { name: string; class: TankClass };

export type PasteRosterResult = {
  healers: PastedHealer[];
  tanks: PastedTank[];
  skipped: number;
  note: string;
};

const SPEC_ALIASES: Record<string, HealerSpec> = {
  "resto-druid": "resto-druid",
  "restoration druid": "resto-druid",
  "resto druid": "resto-druid",
  resto: "resto-druid",
  restoration: "resto-druid",
  druid: "resto-druid",
  "holy-priest": "holy-priest",
  "holy priest": "holy-priest",
  holy: "holy-priest",
  priest: "holy-priest",
  "disc-priest": "disc-priest",
  "discipline priest": "disc-priest",
  "disc priest": "disc-priest",
  discipline: "disc-priest",
  disc: "disc-priest",
  "resto-shaman": "resto-shaman",
  "restoration shaman": "resto-shaman",
  "resto shaman": "resto-shaman",
  shaman: "resto-shaman",
  mistweaver: "mistweaver",
  "mistweaver monk": "mistweaver",
  mw: "mistweaver",
  monk: "mistweaver",
  "holy-paladin": "holy-paladin",
  "holy paladin": "holy-paladin",
  paladin: "holy-paladin",
  preservation: "preservation",
  "preservation evoker": "preservation",
  "pres evoker": "preservation",
  evoker: "preservation",
};

const HEALER_ROLE = /^(heal|healer|healing|hps)$/i;
const TANK_ROLE = /^(tank|tanks|tanking)$/i;
const HEALER_SECTION = /^healers?\s*\(\d+\)$/i;
const TANK_SECTION = /^tanks?\s*\(\d+\)$/i;
const RANGED_SECTION = /^ranged\s*\(\d+\)$/i;
const NAME_HEADER = /^name$/i;
const CLASS_HEADER = /^class$/i;

const HEALER_CLASSES = new Set([
  "priest",
  "paladin",
  "druid",
  "shaman",
  "monk",
  "evoker",
]);

const TANK_CLASSES = new Set([
  "paladin",
  "warrior",
  "death knight",
  "monk",
  "druid",
  "demon hunter",
]);

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  const cells: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') {
      q = !q;
      continue;
    }
    if (ch === "," && !q) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function compact(cells: string[]): string[] {
  return cells.map((c) => c.trim()).filter((c) => c.length > 0);
}

function headerIndex(headers: string[], ...names: string[]): number {
  const set = new Set(names.map(norm));
  return headers.findIndex((h) => set.has(norm(h)));
}

function resolveSpec(specRaw: string, classRaw: string): HealerSpec | null {
  const spec = norm(specRaw);
  const cls = norm(classRaw);

  if (spec.includes("disc") || spec === "discipline") return "disc-priest";
  if (spec.includes("mist") || spec === "mw") return "mistweaver";
  if (spec.includes("preserv")) return "preservation";

  if (spec === "holy" || spec.startsWith("holy ")) {
    if (cls.includes("paladin") || spec.includes("paladin")) return "holy-paladin";
    if (cls.includes("priest") || spec.includes("priest")) return "holy-priest";
    return SPEC_ALIASES[spec] ?? null;
  }

  if (
    spec === "resto" ||
    spec === "restoration" ||
    spec.startsWith("resto ") ||
    spec.startsWith("restoration ")
  ) {
    if (cls.includes("shaman") || spec.includes("shaman")) return "resto-shaman";
    if (cls.includes("druid") || spec.includes("druid")) return "resto-druid";
  }

  for (const key of [
    spec,
    cls,
    `${spec} ${cls}`.trim(),
    `${cls} ${spec}`.trim(),
  ]) {
    if (key && SPEC_ALIASES[key]) return SPEC_ALIASES[key];
  }
  return null;
}

function isTankClass(classRaw: string, specRaw: string): boolean {
  const s = `${norm(classRaw)} ${norm(specRaw)}`;
  return /\b(protection|prot|guardian|blood|brewmaster|vengeance|tank)\b/.test(
    s,
  );
}

function resolveTankClass(classRaw: string): TankClass | null {
  const cls = norm(classRaw);
  if (cls.includes("death")) return "death-knight";
  if (cls.includes("demon")) return "demon-hunter";
  if (cls.includes("warrior")) return "warrior";
  if (cls.includes("paladin")) return "paladin";
  if (cls.includes("monk")) return "monk";
  if (cls.includes("druid")) return "druid";
  return null;
}

function findCol(grid: string[][], re: RegExp): { row: number; col: number } | null {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (re.test(grid[r][c] ?? "")) return { row: r, col: c };
    }
  }
  return null;
}

function looksLikeWowAuditRoster(grid: string[][]): boolean {
  return grid.some((row) =>
    row.some((c) => HEALER_SECTION.test(c) || /main roster/i.test(c)),
  );
}

/**
 * WowAudit Main Roster: Healers / Ranged / Melee columns + Tanks block.
 * Uses column ranges so empty healer slots don't pull in ranged names.
 */
function parseWowAuditMainRoster(grid: string[][]): PasteRosterResult {
  const healers: PastedHealer[] = [];
  const tanks: PastedTank[] = [];
  const seenHeal = new Set<string>();
  const seenTank = new Set<string>();
  let skipped = 0;

  const healerHdr = findCol(grid, HEALER_SECTION);
  const rangedHdr = findCol(grid, RANGED_SECTION);
  const tankHdr = findCol(grid, TANK_SECTION);

  if (healerHdr) {
    const lo = Math.max(0, healerHdr.col - 1);
    const hi = rangedHdr ? rangedHdr.col : lo + 6;
    let pastNameHeader = false;

    for (let r = healerHdr.row + 1; r < grid.length; r++) {
      if (tankHdr && r >= tankHdr.row) break;
      const row = grid[r];
      const slice = compact(row.slice(lo, hi));
      if (slice.some((c) => NAME_HEADER.test(c))) {
        pastNameHeader = true;
        continue;
      }
      if (!pastNameHeader) continue;
      if (slice.length < 2) continue;

      const name = slice[0];
      const cls = slice[1];
      if (!HEALER_CLASSES.has(norm(cls))) {
        skipped++;
        continue;
      }
      const spec = resolveSpec("", cls);
      if (!spec) {
        skipped++;
        continue;
      }
      const key = name.toLowerCase();
      if (!seenHeal.has(key)) {
        healers.push({ name, spec });
        seenHeal.add(key);
      }
    }
  }

  if (tankHdr) {
    let pastNameHeader = false;
    for (let r = tankHdr.row + 1; r < grid.length; r++) {
      const row = grid[r];
      const cells = compact(row);
      if (cells.length === 1 && /^(change roster|link)$/i.test(cells[0])) break;
      if (cells.some((c) => NAME_HEADER.test(c))) {
        pastNameHeader = true;
        continue;
      }
      if (!pastNameHeader && cells.length >= 2) {
        pastNameHeader = true;
      }
      if (!pastNameHeader || cells.length < 2) continue;

      const name = cells[0];
      const cls = cells[1];
      if (/^(change roster|link)$/i.test(name)) break;
      if (!TANK_CLASSES.has(norm(cls))) {
        skipped++;
        continue;
      }
      const tankClass = resolveTankClass(cls);
      if (!tankClass) {
        skipped++;
        continue;
      }
      const key = name.toLowerCase();
      if (!seenTank.has(key)) {
        tanks.push({ name, class: tankClass });
        seenTank.add(key);
      }
    }
  }

  return {
    healers,
    tanks,
    skipped,
    note: `WowAudit Main Roster: ${healers.length} healers, ${tanks.length} tanks. Specs default from class — edit Disc/Holy after.`,
  };
}

function parseFlatTable(lines: string[]): PasteRosterResult {
  const first = splitLine(lines[0]);
  const looksLikeHeader = first.some((c) =>
    /^(name|character|char|player|role|class|spec|specialization|specialisation)$/i.test(
      norm(c),
    ),
  );

  let headers: string[];
  let rows: string[][];
  if (looksLikeHeader) {
    headers = first;
    rows = lines.slice(1).map(splitLine);
  } else {
    headers = ["name", "spec", "role"];
    rows = lines.map(splitLine);
  }

  const nameIdx = (() => {
    const i = headerIndex(
      headers,
      "name",
      "character",
      "char",
      "player",
      "character name",
    );
    return i >= 0 ? i : 0;
  })();
  const roleIdx = headerIndex(headers, "role");
  const classIdx = headerIndex(headers, "class");
  const specIdx = headerIndex(
    headers,
    "spec",
    "specialization",
    "specialisation",
    "active spec",
  );

  const healers: PastedHealer[] = [];
  const tanks: PastedTank[] = [];
  let skipped = 0;
  const seenHeal = new Set<string>();
  const seenTank = new Set<string>();

  for (const row of rows) {
    const name = (row[nameIdx] ?? "").trim();
    if (!name || /^name$/i.test(name)) {
      skipped++;
      continue;
    }
    const role = roleIdx >= 0 ? (row[roleIdx] ?? "").trim() : "";
    const className = classIdx >= 0 ? (row[classIdx] ?? "").trim() : "";
    const specName =
      specIdx >= 0
        ? (row[specIdx] ?? "").trim()
        : classIdx < 0 && row.length > 1
          ? (row[1] ?? "").trim()
          : "";

    const key = name.toLowerCase();

    if (role && TANK_ROLE.test(role)) {
      const tankClass =
        resolveTankClass(className) ??
        resolveTankClass(specName) ??
        "warrior";
      if (!seenTank.has(key)) {
        tanks.push({ name, class: tankClass });
        seenTank.add(key);
      }
      continue;
    }

    if (role && HEALER_ROLE.test(role)) {
      const spec = resolveSpec(specName, className) ?? "holy-priest";
      if (!seenHeal.has(key)) {
        healers.push({ name, spec });
        seenHeal.add(key);
      }
      continue;
    }

    if (role) {
      skipped++;
      continue;
    }

    if (isTankClass(className, specName) || TANK_ROLE.test(specName)) {
      const tankClass =
        resolveTankClass(className) ??
        resolveTankClass(specName) ??
        "warrior";
      if (!seenTank.has(key)) {
        tanks.push({ name, class: tankClass });
        seenTank.add(key);
      }
      continue;
    }

    const spec = resolveSpec(specName, className);
    if (spec) {
      if (!seenHeal.has(key)) {
        healers.push({ name, spec });
        seenHeal.add(key);
      }
      continue;
    }

    skipped++;
  }

  const cols = [
    `name@${nameIdx}`,
    roleIdx >= 0 ? `role@${roleIdx}` : null,
    classIdx >= 0 ? `class@${classIdx}` : null,
    specIdx >= 0 ? `spec@${specIdx}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    healers,
    tanks,
    skipped,
    note: `Parsed ${healers.length} healers, ${tanks.length} tanks (${cols}; skipped ${skipped}).`,
  };
}

/** Parse WowAudit / Google Sheets paste (TSV or CSV). */
export function parseRosterPaste(raw: string): PasteRosterResult {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { healers: [], tanks: [], skipped: 0, note: "Empty paste." };
  }

  const grid = lines.map(splitLine);
  if (looksLikeWowAuditRoster(grid)) {
    const result = parseWowAuditMainRoster(grid);
    if (result.healers.length > 0 || result.tanks.length > 0) return result;
  }

  return parseFlatTable(lines);
}
