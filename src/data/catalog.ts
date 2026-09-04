import type { Boss, Spell } from "@/domain/types";
import healers from "../../data/spells/healers.json";
import raidUtilities from "../../data/spells/raid-utilities.json";
import nekzali from "../../data/bosses/nekzali.json";
import nekzaliMythic from "../../data/bosses/nekzali-mythic.json";
import entombedSentinels from "../../data/bosses/entombed-sentinels.json";
import entombedSentinelsMythic from "../../data/bosses/entombed-sentinels-mythic.json";
import lostExplorers from "../../data/bosses/lost-explorers.json";
import lostExplorersMythic from "../../data/bosses/lost-explorers-mythic.json";
import vashnik from "../../data/bosses/vashnik.json";
import vashnikMythic from "../../data/bosses/vashnik-mythic.json";
import sszorak from "../../data/bosses/sszorak.json";
import sszorakMythic from "../../data/bosses/sszorak-mythic.json";
import twinFangs from "../../data/bosses/twin-fangs.json";
import twinFangsMythic from "../../data/bosses/twin-fangs-mythic.json";
import coiledAltar from "../../data/bosses/coiled-altar.json";
import ulatek from "../../data/bosses/ulatek.json";
import nymrissa from "../../data/bosses/nymrissa.json";

export const HEALER_SPELLS = healers as Spell[];
export const RAID_UTILITY_SPELLS = raidUtilities as Spell[];
export const SPELLS = [...HEALER_SPELLS, ...RAID_UTILITY_SPELLS];

export const BOSSES = [
  nekzali,
  nekzaliMythic,
  entombedSentinels,
  entombedSentinelsMythic,
  lostExplorers,
  lostExplorersMythic,
  vashnik,
  vashnikMythic,
  sszorak,
  sszorakMythic,
  twinFangs,
  twinFangsMythic,
  coiledAltar,
  ulatek,
  nymrissa,
] as Boss[];

export function getBoss(id: string): Boss | undefined {
  return BOSSES.find((b) => b.id === id);
}

export function getSpell(id: string): Spell | undefined {
  return SPELLS.find((s) => s.id === id);
}
