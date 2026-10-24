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
- **Blocked**: watts lost pushing into the wheel ahead. On fast descents sitting close costs the most of all: ease off to 5 m or more.
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
  going"; power-ups by Zwift's names ("hold VAN in 25", "AERO now"): advice only, never fired for you. A feather you
  hold gets its own call before a climb: "hold FEATHER in 20", then "FEATHER now" at the steepest part.
- **The race card** for the route you're racing: "sprint in 70", "sprint line in 25", "use VAN in 35", your notes.
- **The road**: "dirt in 15 for 40"; "coast" when you're fast enough to supertuck; bends: "inside left in 6" when the
  inside is open and moving over gains ground, "stay close" when you're on the outside of the bunch.
- **Habits**, now and then: "use edge", "sit in", "get in line", "ease off", "give room" (under a meter off the wheel).

On a bike that gets no draft (a TT bike in a group ride, or any bike in a time trial) the pack calls go quiet by
themselves after 20 s on a wheel with no draft: no "gap opening", "drop back" or "hold line" for a draft you don't get.

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

## Race cards

A race card is the course of one race, written down: where the scored sprints and KOMs are, the climbs, the arches
and which power-up each gives, the finish. With a card, the director calls what's coming on that course: "sprint in
70", "sprint line in 25", "use VAN in 35", "position only", your own notes. Without one, it still calls the road it
can see (climbs, surfaces), just not the race's own segments.

**Included:** the Zwift Racing League 2026/27 Round 1 races, weeks 3–6 (Urumaze, Figure 8 Reverse TTT, Green to
Screen, Spiral Summit), from Zwift Insider's race guides. New cards come with new releases.

**Using one:** nothing to do on race day. In an event, the Director Sportif window picks the card for the route
you're on by itself (a card only speaks on its own route, since its distances are race distances on that route). The
status line shows which card it's using.

**Your plan** (the gear ▸ **Race card** tab): pick a card, then for each item:

- a scored sprint or KOM: **contest** (called as a sprint, with "ease off" once your place is safe), **position**
  (be up there, no sprint), or **skip** (called as "skip it");
- an arch that gives a power-up: **use** or **keep** the one you hold;
- a **note**, said shortly before you get there ("sit in, the KOM matters more").

Your plan is saved on this computer only; the cards themselves hold only course facts. The title card and the
YouTube chapters (OBS, below) use the card too.

**A card for any race:** make one at [caffecter.com/race-card.html](https://www.caffecter.com/race-card.html) (pick the
route and laps; every sprint, KOM, climb and arch comes at its race km; add which segments score and what each arch
gives), then in the **Race card** tab press **Import a card** and pick the file. Imported cards are used like the
included ones; **Remove** takes one out again.

**Writing a card by hand:** a card is a JSON file (the included ones are in `pages/src/engine/race-cards/`) with an
`id`, a `name`, the `route` (Zwift's exact route name: the card only speaks on that route) and `items`. Each item
has `km` (race distance from the start), `kind` (`sprint`, `kom`, `climb`, `arch` or `finish`), `name`, and where it
applies `lengthKm`, `grade`, `scored` and `gives` (the power-up an arch gives). The included cards are the examples.
Keep a card to course facts.

## OBS (if you record or stream your races)

**Why:** the Director Sportif knows when the race starts and ends, so it can run OBS for you:

- **Never miss the start.** OBS starts recording with the race and stops after it: no clicking OBS in the pen, no
  three-hour file because you forgot to stop it. A recording you started yourself is never stopped.
- **YouTube chapters, ready to paste.** When OBS stops, a `ds-video-<time>-youtube-chapters.txt` lands in your
  Downloads: the start, each climb and sprint from the race card, 1.5 km to go, your jump, the finish, timed to
  your video.
- **A title card.** The video can open on a card (the event, the course, your plan) for 10–30 s in its own OBS scene,
  then cut back to your scene.
- **Moments in your video.** Your ride recording notes when OBS started recording or streaming, so a moment in the
  ride (your sprint, a move up) can be found at the right second of your video.

**Set up** (OBS 28 or newer has what's needed built in):

1. In OBS: **Tools ▸ WebSocket Server Settings**: tick **Enable WebSocket server**, keep port 4455, and set a password.
   **Show Connect Info** shows the address and password.
2. In the Director Sportif window's settings (the gear), **OBS** tab: tick **Connect to OBS**, then fill in the
   address (`ws://127.0.0.1:4455` when OBS runs on the same computer) and the password. The password stays in the
   window's settings on your computer.
3. Tick **Record OBS with the race** and pick a **Title card** length (or none). The title card needs Sauce's web
   server on (Sauce's settings); its OBS scene and source are made the first time.
4. Press **Rehearse** (outside an event, with OBS not recording): the window shows the title card, starts OBS, records
   90 s and stops, and saves the chapters file. Check the video before race day.

OBS can be closed or started later: the Director Sportif retries every 30 s and a missing OBS never breaks a ride.

**On stream:** capture the **Director Sportif — Grid** window in OBS (its window title never changes, so a window
capture keeps finding it). For a clean overlay, turn on **Solid background** in the Grid's Look settings and key out
the color.

## Develop

- `npm test` runs the headless tests (meter engine, data object, calls, the Grid's slots, route and race cards).
- `npm run dev-link` installs this folder into SauceMods as a junction. Changes need a window reopen; a manifest
  change needs a full Sauce quit.
- `npm run build` writes a release copy to `dist/`; `npm run release` also zips it (`dist/director-sportif-<version>.zip`).

The meters in `pages/src/engine/` come from measured Zwift pack physics. Pack cost and the draft-by-gap curve are
crude tables (`engine/pack-cost.mjs`, `engine/gap-curve.mjs`): a few watts from the full model, the same words and calls.

## License

GPL-3.0-or-later. See `LICENSE`.
