# Healer CDA

Local-first healer cooldown planner for **World of Warcraft: Midnight Season 2** — **The Venomous Abyss** plus the lair boss **Nymrissa Wavecaller**.

Assign raid CDs, tank externals, and whole-raid personals, then **Copy NSRT** into Northern Sky Raid Tools.

## Requirements

1. Install [Node.js 20.9+](https://nodejs.org) (LTS is fine). npm is included.
2. Open a new terminal and check: `node -v` should print `v20.9` or newer.

## Quick start

From this repo:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Leave that terminal running while you use the app. If the page does not load, the terminal will show the port (usually `3000`).

## Raid lead flow

1. **Boss** — pick a fight, then **Heroic** / **Mythic** (or click the selected card again) to go to roster.
2. **Roster** — healers (name + spec), tanks, and **raid utilities**. Paste WowAudit Main Roster to import healers/tanks plus Warrior / DK / DH DPS for Rally, AMZ, and Darkness.
3. **Plan** — first visit auto-assigns; later visits restore your saved plan. **Auto-assign CDs** asks before replacing manual work. Tweak rows, set tank targets, then **Copy NSRT** (in-game) or **Copy Viserio** (paste into [Viserio Cooldowns](https://wowutils.com/viserio-cooldowns) CD → Import).
4. In-game: `/ns` → Shared Notes → Import → paste.

### Plan screen tips

- **CD windows only** (on by default) hides info-only abilities; turn it off to see the full cast list.
- **Note · N** chooses which boss abilities appear in the copied note (row checkboxes).
- Edit any window time as `mm:ss` if your pull differs; re-auto-assign if readiness looks wrong.
- Sticky header keeps **Copy NSRT** available while you scroll.
- Matching tanks (Warrior / DK / DH) can cast utility CDs without a separate utility entry.
- Raid personals only auto-suggest when a window has `suggestPersonals` (or soft-CD wording) — bare “soak” notes no longer force personals.

Each plan row is **boss ability → healer CD(s), raid utilities, and/or raid personals**.

## Timers

Heroic timers lean on **BigWigs** first-cycle cast bars / guides; several fights also track public **WowUtils** / **WCL** Mythic kill data. Coiled Altar and Ula’tek are Heroic-only until Mythic rankings exist. Nymrissa remains guide-estimated. Prefer editing JSON under `data/bosses/` when a fight changes.

## Scripts

| Command         | Purpose                 |
| --------------- | ----------------------- |
| `npm run dev`   | Local app               |
| `npm run build` | Production build        |
| `npm test`      | Domain / auto-assign tests |

## Scope

- Healers, tank externals, raid personals, tank/DPS raid utilities (Rally, AMZ, Darkness)
- Local-first (no accounts). The planner never needs Warcraft Logs login; WCL is only used offline in optional `scripts/` when rebuilding timer JSON.
- NSRT + readable text export
- Plans (assignments, notes, timers) persist in this browser per boss

In-game companion addon is planned later; NSRT notes cover pull reminders for now.
