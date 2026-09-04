# Healer CDA

Local-first healer cooldown planner for **World of Warcraft: Midnight Season 2** — **The Venomous Abyss** plus the lair boss **Nymrissa Wavecaller**.

Assign raid CDs, tank externals, and whole-raid personals, then **Copy NSRT** into Northern Sky Raid Tools.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Raid lead flow

1. **Boss** — pick a fight and difficulty (Heroic / Mythic where available). First click selects; second click (or the H/M chip) continues to roster.
2. **Roster** — healers (name + spec) and tanks. Saved in your browser; paste from WowAudit-style lists is supported.
3. **Plan** — **Auto-assign CDs** fills healer spells and suggested personals. Tweak rows, set tank targets on externals, then **Copy NSRT**.
4. In-game: `/ns` → Shared Notes → Import → paste.

### Plan screen tips

- **CD windows only** (on by default) hides info-only abilities; turn it off to see the full cast list.
- **Note · N** chooses which boss abilities appear in the copied note (row checkboxes).
- Edit any window time as `mm:ss` if your pull differs; re-auto-assign if readiness looks wrong.
- Sticky header keeps **Copy NSRT** available while you scroll.

Each plan row is **boss ability → healer CD(s) and/or raid personals**.

## Timers

Heroic timers lean on **BigWigs** first-cycle cast bars / guides; several fights also track public **WowUtils** / **WCL** Mythic kill data. Coiled Altar and Ula’tek are Heroic-only until Mythic rankings exist. Nymrissa remains guide-estimated. Prefer editing JSON under `data/bosses/` when a fight changes.

## Scripts

| Command         | Purpose                 |
| --------------- | ----------------------- |
| `npm run dev`   | Local app               |
| `npm run build` | Production build        |
| `npm test`      | Domain / auto-assign tests |

## Scope

- Healers, tank externals, raid personals
- Local-first (no accounts, no WCL login required to use the planner)
- NSRT + readable text export

In-game companion addon is planned later; NSRT notes cover pull reminders for now.
