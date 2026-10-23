<!-- Director Sportif — a Sauce for Zwift mod. Copyright (C) 2026 Paul Curtis. SPDX-License-Identifier: GPL-3.0-or-later -->
# Director Sportif

A [Sauce for Zwift](https://www.sauce.llc) mod: a director sportif in your ear. It reads the pack, the road and the race
from Sauce and tells you, in a word or two, what to do now. Its meters show on a display you lay out yourself.

## Two windows

- **Director Sportif**: the director. It runs the meters and the calls and shows a short status (the call now, your
  route and race card, whether data is coming). Keep it open: the Grid shows nothing without it. Its gear holds your
  bike, CdA, FTP and FRC, how each call reaches you, and your race card plan.
- **Director Sportif — Grid**: the display. The slots, sizes and yellow / red thresholds you set with its gear. It
  computes nothing: it shows what the Director Sportif window publishes (described in [`docs/DS-DATA.md`](docs/DS-DATA.md);
  any window of the mod can listen on the same channel).

## The meters

Each shows a number, and a word under it when there's something to do ("back off", "ease off", "block left").

- **Position**: what your spot costs against the best-placed rider in your group. Blank behind a rider who gives no
  draft (a hand cycle): "change wheel".
- **Holding**: watts beyond what keeping your place needs, over 10–20 s. Its word follows the cause: "ease off" when
  you're pushing into the wheel, "moving up" while you move up, "easy" otherwise.
- **Pack cost**: the steady watts your spot costs beyond Zwift's draft (tight, crowded, boxed in).
- **Blocked**: watts lost pushing into the wheel ahead.
- **Passing**: the closing speed when you creep up on a rider at the speed that gets you held, or one creeps up on you.
- **Gap**, **L/R**: to the wheel in front.
- **Tuck**: the speed still needed for a supertuck; **Tuck drag**: your drag in the tuck against coasting.
- **Surface**: the watts the road under you costs your tyres beyond pavement (wood, dirt, cobbles…).
- **FRC**: your reserve above FTP, from your power ("low", "empty").
- **Director**: the one call to act on now. Plus a word slot per meter, and power, speed, draft, cadence, heart rate
  and grade.

Watt meters read 0 with nothing to read (alone); distance meters go blank.

## The calls

Each kind reaches you the way you pick in the settings: a chime (its own sound), your computer's voice, or both; the
windows always show it. Times are in seconds, never meters.

- **The pack**: "go harder", "go wide", "drop back" (your pass), "block left" / "hold line" (a rider creeping up),
  "ease off" (blocked).
- **Climbs**: "climb in 90", "move up" 60–45 s before it, "hold spot" or "stay in line"; "steep in 20 for 30",
  "over top in 15". From your route: it works alone, from the start.
- **The finish**: "top ten in 120", "get a wheel", "go first", "go wide", "dig in" (a rider closing fast), "keep
  going"; power-ups by Zwift's names ("hold VAN in 25", "AERO now"): advice only, never fired for you.
- **The race card** for the route you're racing: "sprint in 70", "sprint line in 25", "use VAN in 35", your notes.
- **The road**: "dirt in 15 for 40"; "coast" when you're fast enough to supertuck.
- **Habits**, now and then: "use edge", "sit in", "get in line", "ease off".

If you record or stream with OBS, the Director Sportif can connect to it (settings: OBS): it notes when your recording
and stream started, so a ride's moments can link into your video, and it can start and stop OBS recording with the race.

When you join an event, the Director Sportif window asks whether its bike type is right (Sauce doesn't say which bike
you ride); in a time trial a bike that isn't a TT bike turns it red.

## Install

1. Install [Sauce for Zwift](https://www.sauce.llc).
2. Download `director-sportif-<version>.zip` from the [releases](../../releases/latest) and unzip it into your
   `Documents\SauceMods` folder (create it if it isn't there; with OneDrive, the Documents folder OneDrive keeps).
3. Quit Sauce fully (from the tray) and start it again.

## Use

Settings ▸ Mods in Sauce: enable Director Sportif, then open **Director Sportif** and **Director Sportif — Grid**.
Right-click a window to show its title bar; the gear opens its settings. A manifest change (a new version) needs a full
Sauce quit.

## Recording

Record (or record every event, or all the time) saves your ride to your Downloads folder as
`ds-capture-<date>.ndjson.gz`: you in full, other riders only as positions and draft under random ids, never their
names, power or heart rate. What's in it and the format: [`docs/RECORDING.md`](docs/RECORDING.md). The file stays on your
computer unless you take it somewhere, for example to [caffecter.com](https://caffecter.com/report.html) for a ride report.

## Develop

- `npm test` runs the headless tests (meter engine, data object, calls, the Grid's slots, route and race cards).
- `npm run dev-link` installs this folder into SauceMods as a junction. Changes need a window reopen; a manifest
  change needs a full Sauce quit.
- `npm run build` writes a release copy to `dist/`; `npm run release` also zips it (`dist/director-sportif-<version>.zip`).

The meters in `pages/src/engine/` come from measured Zwift pack physics. Pack cost and the draft-by-gap curve are
crude tables (`engine/pack-cost.mjs`, `engine/gap-curve.mjs`): a few watts from the full model, the same words and calls.

## License

GPL-3.0-or-later. See `LICENSE`.
