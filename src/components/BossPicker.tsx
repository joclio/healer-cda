import { BOSSES } from "@/data/catalog";
import type { Boss } from "@/domain/types";

interface Props {
  selectedId: string | null;
  lastBossId: string | null;
  onSelect: (boss: Boss, goRoster?: boolean) => void;
}

interface BossSlot {
  order: number;
  shortName: string;
  group: Boss["group"];
  heroic?: Boss;
  mythic?: Boss;
}

function buildSlots(group: Boss["group"]): BossSlot[] {
  const map = new Map<number, BossSlot>();
  for (const b of BOSSES.filter((x) => x.group === group)) {
    let slot = map.get(b.order);
    if (!slot) {
      slot = {
        order: b.order,
        shortName: b.shortName,
        group,
      };
      map.set(b.order, slot);
    }
    if (b.difficulty === "Mythic") slot.mythic = b;
    else slot.heroic = b;
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}

/** Prefer last fight on this boss, else last used difficulty, else Heroic. */
function preferredBoss(slot: BossSlot, lastBossId: string | null): Boss | null {
  if (lastBossId) {
    if (slot.mythic?.id === lastBossId) return slot.mythic;
    if (slot.heroic?.id === lastBossId) return slot.heroic;
    const last = BOSSES.find((b) => b.id === lastBossId);
    if (last?.difficulty === "Mythic" && slot.mythic) return slot.mythic;
    if (last?.difficulty === "Heroic" && slot.heroic) return slot.heroic;
  }
  return slot.heroic ?? slot.mythic ?? null;
}

export function BossPicker({ selectedId, lastBossId, onSelect }: Props) {
  const raid = buildSlots("raid");
  const lair = buildSlots("lair");

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
          Raid — The Venomous Abyss
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {raid.map((slot) => (
            <BossSlotCard
              key={`${slot.group}-${slot.order}`}
              slot={slot}
              selectedId={selectedId}
              lastBossId={lastBossId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </section>

      {lair.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300/70">
              Also
            </h2>
            <span className="text-[11px] text-white/35">
              Tidebound Grotto
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {lair.map((slot) => (
              <BossSlotCard
                key={`${slot.group}-${slot.order}`}
                slot={slot}
                selectedId={selectedId}
                lastBossId={lastBossId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function BossSlotCard({
  slot,
  selectedId,
  lastBossId,
  onSelect,
}: {
  slot: BossSlot;
  selectedId: string | null;
  lastBossId: string | null;
  onSelect: (boss: Boss, goRoster?: boolean) => void;
}) {
  const ids = [slot.heroic?.id, slot.mythic?.id].filter(Boolean) as string[];
  const selected = selectedId != null && ids.includes(selectedId);
  const isLast = lastBossId != null && ids.includes(lastBossId);
  const preferred = preferredBoss(slot, lastBossId);
  const selectedDiff =
    selectedId === slot.mythic?.id
      ? "Mythic"
      : selectedId === slot.heroic?.id
        ? "Heroic"
        : null;

  function onCardClick() {
    if (selected && selectedId) {
      const current =
        slot.mythic?.id === selectedId ? slot.mythic : slot.heroic;
      if (current) onSelect(current, true);
      return;
    }
    if (preferred) onSelect(preferred, false);
  }

  return (
    <div
      className={`rounded-lg border px-3 py-3 transition ${
        selected
          ? "border-teal-400/80 bg-teal-500/15 shadow-[0_0_0_1px_rgba(45,212,191,0.35)]"
          : isLast
            ? "border-amber-400/30 bg-white/[0.04] hover:border-amber-400/45"
            : "border-white/10 bg-white/[0.04] hover:border-white/20"
      }`}
    >
      <button
        type="button"
        onClick={onCardClick}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium leading-snug text-white">
            {slot.shortName}
          </div>
          {selected && selectedDiff && (
            <span className="shrink-0 rounded bg-teal-500/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-teal-100">
              {selectedDiff}
            </span>
          )}
        </div>
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {slot.heroic ? (
          <DiffButton
            label="Heroic"
            active={selectedId === slot.heroic.id}
            onClick={() => onSelect(slot.heroic!, true)}
          />
        ) : null}
        {slot.mythic ? (
          <DiffButton
            label="Mythic"
            active={selectedId === slot.mythic.id}
            onClick={() => onSelect(slot.mythic!, true)}
          />
        ) : slot.group === "raid" ? (
          <span
            className="rounded-md border border-dashed border-white/10 px-2 py-1 text-[11px] text-white/30"
            title="No Mythic kills on WCL yet"
          >
            Mythic soon
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DiffButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? "bg-teal-500 text-slate-950"
          : "bg-white/10 text-white/70 hover:bg-white/15 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
