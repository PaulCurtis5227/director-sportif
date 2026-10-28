<!-- Director Sportif — a Sauce for Zwift mod. Copyright (C) 2026 Paul Curtis. SPDX-License-Identifier: GPL-3.0-or-later -->
# Director Sportif

A [Sauce for Zwift](https://www.sauce.llc) mod: a director sportif in your ear. It reads the pack, the road and the race
from Sauce and tells you, in a word or two, what to do now. Its meters show on a display you lay out yourself.

## Two windows (open both)

- **Director Sportif**: the director, the part that thinks. It reads Sauce's data, works out the meters and makes the
  calls. It's one line: **what to do now** (the call and each meter's advice in one place, yellow or red when
  urgent), then the **Record** button ("● 12:03" while recording) and **Mark**. In the start pen the text takes turns
  showing the event, the race card, OBS and your bike. **Keep it open
  while you ride** (it can sit behind Zwift): close it and the meters and calls stop. Its gear holds your bike, CdA,
  FTP and FRC, how each call reaches you, your race card plan, recording and OBS.
- **Director Sportif — Grid**: the display. The slots, sizes and yellow / red thresholds you set with its gear. It
  computes nothing: it shows what the Director Sportif window publishes (described in [`docs/DS-DATA.md`](docs/DS-DATA.md);
  any window of the mod can listen on the same channel).

## The meters

Each shows a number, and a word under it when there's something to do ("back off", "ease off", "block left").

- **Position**: what your spot in the group costs you in watts, against the best spot at your speed (4–6 m back on a
  fast descent, not on the wheel). Blank behind a rider who gives no draft (a hand cycle): "change wheel".
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
  going"; power-ups by Zwift's names ("VAN in 25", "AERO now"): advice only, never fired for you. A feather you
  hold gets its own call before a climb: "FEATHER in 20", then "FEATHER now" at the steepest part.
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

### First setup (two minutes)

1. **Choose how you hear the calls.** Out of the box the main calls are spoken (the gap, your pass, blocked, move
   up, steep, the finish, power-ups, race card, surfaces) and a few kinds chime. Director Sportif's gear ▸ **Calls**:
   tick **Voice** and / or **Chime** per kind. Bends and habits are off to start with; a chime alone suits being
   passed.
2. **Tell it about you.** Gear ▸ **You**: your **bike** and **wheels** (Sauce doesn't say which you ride: the meters
   use them for your drag), and your **FTP** and **FRC** (for the FRC meter and the finish calls; left blank, your
   Zwift profile's FTP and 15 kJ).
3. **Lay out the Grid.** It starts with Position, Holding, Blocked, Gap and L/R, numbers only (the words are on the
   Director Sportif window). Its gear adds, removes and orders slots, shows a meter's word under it if you want it
   there, and sets the yellow / red ranges. Place it over Zwift, or capture it in OBS.

Then ride: the meters fill once you're in a group, and the Grid says "waiting for the Director Sportif window" whenever
that window is closed.

## Recording

Record (or record every event, or all the time) saves your ride to your Downloads folder as
`ds-capture-<date>.ndjson.gz`: you in full, other riders only as positions and draft under random ids, never their
names, power or heart rate. What's in it and the format: [`docs/RECORDING.md`](docs/RECORDING.md). The file stays on your
computer unless you take it somewhere, for example to [caffecter.com](https://caffecter.com/report.html) for a ride report.

With **Record every event** on, each event gets its own file, even when you pressed Record in the warm-up: that file
ends when the event's own starts (5 minutes before the start). A recording you start in an event runs until you stop it.
No file is saved (no save window) from the start pen to the finish: files that end in between are kept safe and saved
once you finish or leave the event.

## Burritos

In a race where everyone gets a burrito (it takes the draft from the riders in a cone behind whoever fires it, for
20 s), the Director Sportif sees each one fired: "burrito, move over" when one goes off just ahead of you, and "burritos
done" once nearly everyone has used theirs. The Grid's **Burritos** field counts the riders ahead of you who still hold
one: near the front, fewer of them can catch you. The cone is short (measured over 45 burritos in a race): from 1 to
8.5 m behind the rider who fired it, and a quarter of that distance to either side (±0.5 m at 2 m back, ±2 m at 8 m).
Riding a lane to the side of the wheel, or 9 m or more back, keeps your draft.

## Teammate heart rate

Some races disqualify a rider with no heart rate, or halve their points. In a race, the Director Sportif checks
you and the riders in your race who carry your team tag (the "(Dinos)" or "[Dinos]" in a Zwift name): one with no
heart rate for 20 s gets a call, "Nick: no heart rate", in the pen (time to pair a strap) or in the race, and a red
banner in the Director Sportif window that stays until you press **I know Nick has no HR**. Until you do, the call
comes again every 2 minutes. Once you have, a teammate is done for the event: you tell them, the rest is up to them. Your
own warning comes back only if your heart rate returns and then drops out again, until you have pressed **I know**
three times. A heart rate back gets one call, unless you already acknowledged that rider. Only whether a signal is there is read; nothing about it is kept, and the recording has no names.
Turn it off in the Calls tab (Teammate HR).

## Race cards

A race card is the course of one race, written down: where the scored sprints and KOMs are, the climbs, the arches
and which power-up each gives, the finish. With a card, the director calls what's coming on that course: "sprint in
70", "sprint line in 25", "use VAN in 35", "position only", your own notes. Without one, it still calls the road it
can see (climbs, surfaces), just not the race's own segments.

**Included:** the Zwift Racing League 2026/27 Round 1 races, weeks 3–6 (Urumaze, Figure 8 Reverse TTT, Green to
Screen, Spiral Summit), from Zwift Insider's race guides. New cards come with new releases.

**Using one:** nothing to do on race day. In an event, the Director Sportif window picks the card for the route
you're on by itself (a card only speaks on its own route, since its distances are race distances on that route). In
the pen, the Director Sportif window shows which card it's using ("card: …", or "no race card").

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
