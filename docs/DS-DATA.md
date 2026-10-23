# The Director Sportif data object, v1 (agreed 2026-10-16)

Step 1 of `docs/DS-DISPLAY.md`. What the Director Sportif (DS) publishes and a display reads. Nothing is built yet;
the words get tried on a real ride and may change.

## Rules

- **One object per tick** (each Sauce `nearby` update, ~1 per second), for the rider the meters are for (you, or
  the rider you watch).
- **Values are numbers; states are short codes; words come from the vocabulary below.** No numbers or names in a
  word. No sentences anywhere in the object: explanations live in the DS window's tooltips and help.
- **Metric units in the data** (W, m, km/h, kJ, m²). The display converts to imperial when Sauce's
  `/imperialUnits` is on, and chooses ft or m for left / right.
- **Nothing to read: watt meters read 0, the others blank** (the user, 2026-10-16: like Sauce's draft gauge, which
  doesn't say nobody is here). Alone, your spot costs 0 W and you lose 0 W to blocking, so Position, Holding, Pack
  cost and Blocked publish 0. Gap, Left / right and Tuck publish null (shown "-"): for them 0 means something
  (touching the wheel, dead in line, fast enough to tuck). Either way the state still says why (`alone`,
  `settling`, ...) for anyone who wants it; no word is shown for it.
- **Active words for advice** (the user: "back off", not "too close"). Meters that advise (Position, Holding,
  Blocked, Passing, Tuck) say what to do; meters that describe (Pack cost, Gap, Left / right) say what is.
- **Versioning:** `v: 1`. Adding a meter, state or field keeps v1 (displays ignore what they don't know). Renaming
  or removing anything, or changing a unit, makes v2.
- **Privacy:** your own heart rate only; nothing about other riders except what a meter is about (no names, no
  IDs in the object).

## The object

```js
{
  v: 1,
  ts: 1792154400000,          // wall clock ms of this tick (a display blanks after 5 s without one)
  self: true,                 // false = the meters are for a rider you watch (calls only sound for you)
  meters: {
    position: {value: 12, state: 'too-close', level: 'warn'},
    holding:  {value: -8, state: 'holding', level: null},
    ...                       // one entry per meter below, always present (value null when there is none)
  },
  basics: {power: 245, speed: 41.2, draft: 63, cadence: 88, heartrate: 151, grade: -0.012},
  call: {id: 'moveUp', state: 'move', word: 'move up', in: 25, for: null, priority: 80} | null,
}
```

**level**: `null` (fine) | `'warn'` (yellow) | `'alarm'` (red), from the DS's own ranges (today's tile defaults,
below). A display may override them with the rider's own thresholds.

## The meters

Common states, used by every meter with nothing to read: `alone` (no group) · `settling` (just teleported)
· `coasting` (under 30 W in a group) · `warming` (filling the window) · `none` (nothing to show here). No word
is shown for them; the value is 0 (watt meters) or blank (the rest).

| Meter (key) | Value | Unit | States → word | Level (warn / alarm) |
|---|---|---|---|---|
| Position (`position`) | watts your spot saves short of the ideal spot at your speed (0 = nothing to gain; v0.31.0, was vs the best-placed rider in your group), 10 s | W | `good` stay · `sit-in` sit in (front of the group) · `gapping` gap opening (a hole opening ahead of your wheel or the next) · `too-close` back off · `boxed` drift back (boxed in: to the back, where there's room) · `close-up` close up (gap too big) · `find-wheel` find a wheel · `no-draft` change wheel (the wheel gives no draft) | 10 / 20 W |
| Holding (`holding`) | power beyond what keeping your place needed, 10 s (pair) / 20 s (3+) | W | `hold` hold (within the band) · `easy` easy (over the band: pushing for nothing) · `blocked` ease off (over the band because you're blocked: the same word as Blocked) · `moving-up` moving up (over the band while moving up: the price of the move, not waste) · `drifting` drifting (under the band) | 20 / 40 W |
| Pack cost (`pack`) | watts your spot costs beyond Zwift's draft | W | `front` front · `room` room · `tight` tight (< 3.5 m to the wheel) · `crowded` crowded (2+ riders close ahead) · `boxed` boxed in · `group` in the group · `pair` with one (value null) | 25 / 40 W |
| Blocked (`blocked`) | watts lost to blocking, 10 s | W | `clear` (no word) · `blocked` ease off (pushing into the wheel) · `blocked-left` / `blocked-right` drop back (stuck alongside a rider on that side) | 10 / 30 W |
| Passing (`passing`) | closing speed on the rider (0 with nobody closing) | km/h | `too-slow` go harder (you, closing 1–5 km/h: 5+ goes through) · `go-wide` go wide (you, in line with them) · `drop-back` drop back (you, glued to their wheel) · `rider-left` block left · `rider-right` block right · `rider-behind` hold line (a rider creeping up on you: staying in their way costs them far more than you) · `none` | — |
| Gap (`gap`) | to the wheel in line, center to center (null beyond 25 m) | m | `wheel` (blank) · `beside` beside (none in line) · `no-wheel` no wheel · `no-draft` no draft | — |
| Left / right (`side`) | you to the right (+) or left (−) of the wheel | m | `inline` (blank) · `beside` beside · `no-wheel` (blank) | — |
| Tuck (`tuck`) | km/h still needed to tuck (0 when fast enough; blank off a descent) | km/h | `build` pedal on · `stop` coast (fast enough: stop pedaling; in a race, or the event type not known yet) · `rest` rest (fast enough, but not a race: the tuck saves legs, not time; no call) · `tuck` tuck (in it) · `draft` in draft · `frame` no tuck (TT / MTB) · `none` | — |
| Group (`group`) | riders in your group, you included | riders | — | — |
| CdA (`cda`) | the air drag area the meters use | m² | `model` (bike × your size) · `yours` (your own CdA) · `guessed` (height or weight hidden) | — |

Extra fields a meter may carry beside `value / state / level`:
- `gap.approx: true`: the gap came from positions, not Sauce's time gap (can be meters off; shown as "~").
- `tuck.drag: {tuck: 0.273, coast: 0.275, tuckS: 7, coastS: 12}`: the measured CdA in the tuck vs coasting.
- `position.save: 12`: watts the advised move saves (= value today; kept separate in case they diverge).

Later, from the Data Tap (step 4 of the plan):

| Meter | Value | Unit | States → word | Level |
|---|---|---|---|---|
| Demand (`demand`) | the power the ideal spot needs to hold your group, 30 s (`pctFtp`: % of your FTP) | W | `ok` (no word) | none: it only reports |
| FRC (`frc`) | anaerobic reserve left | kJ | `ok` · `low` low · `empty` empty | 30% / 10% left |
| Draft (`draftShare`) | your draft as a share of the most you could get | % | `full` · `partial` partial · `none` | — |

## The call

At most one call per tick: the most important thing to say now.

**Times, not distances** (the user, 2026-10-16: "something in 300 m requires me to know how fast I am going; that
is for computers to figure out"). A call about something ahead carries seconds, never meters:
- `in`: seconds until it happens (the climb starts, the sprint, the power-up should fire, the wood starts).
- `for`: seconds it lasts, when that matters (the steep part, the wooden bridge).
The DS converts with the speed you'll actually ride there, not just your speed now: your group's speed on the flat,
slowing on the climb ahead from its grade (as `director.mjs nextClimb` does today). Recomputed every tick, so it
counts down; rounded to 5 s above 20 s, whole seconds below.

A display shows the word and the times ("steep 25 s · 40 s", "AERO 12 s"). The voice says the word, then the time
if there is one ("steep in 25", "AERO in 12"); the chime is the call `id`'s own (v0.30.0: no Zwift messages to yourself any more). Speeds and watts stay on the meters, not in calls (a closing speed is the Passing meter).

| Call (id) | States → word | in / for | Priority |
|---|---|---|---|
| Your pass (`pass`) | `too-slow` go harder · `drop-back` drop back (`go-wide` is shown on the Passing meter, never called: v0.34.0) | — | 70 |
| Gap opening (`gap`) | `opening` gap opening (Position `gapping`) | — | 75 |
| Blocked (`blocked`) | `wheel` ease off · `left` / `right` drop back | — | 65 |
| Being passed (`passed`) | `left` block left · `right` block right · `behind` hold line | — | 60 |
| Tuck (`tuck`) | `stop` coast | — | 40 |
| Move up (`moveUp`) | `prep` climb · `move` move up · `hold` hold spot · `late` stay in line | in: to the climb | 40 / 80 / 60 / 30 |
| Nudge (`nudge`) | `wheel` ease off · `middle` use edge · `front` sit in · `line` get in line | — | 19–22 |
| Sprint (`sprint`) | `position` top ten · `good` good spot · `windup` get a wheel · `last` last wheel, be ready · `last-go` jump now · `window` you can go · `take-wheel-light` / `-medium` / `-hard` wheel, jump light / medium / hard (call id `wheel`, last km, at the moment to jump; `take-wheel` wheel, jump without FTP / model) · `closer` dig in · `keep-going` keep going · `ease-ftp` ease to FTP · `ease` ease off (both also at contested race-card intermediates: `intermediate: true`, `remainingM` to its line) · `shake-left` drift left · `shake-right` drift right | in: to the line | 55–94; `targetW`: the power you can hold to the line leaving 3 kJ |
| Power-up (`powerup`) | `ready-<name>` AERO · `fire-<name>` AERO now · `hold-<name>` hold AERO | in: until it should fire | 70–95 |
| Climb pacing (`pacing`) | `steep` steep · `top` over top | in: to the steep part / the top; for: how long it's steep | 35 |
| Bend (`bend`) | `open` inside open · `outside` outside | in: to the bend | 25 |
| Surface (`surface`) | `wood` · `dirt` · `cobbles` · `brick` (the word is the surface) | in: to it; for: how long | 20 |

`<name>` is the power-up: AERO · VAN · GHOST · BURRITO · ARROWS · FEATHER (the word uses the same name).
Priorities follow today's director (`pages/director.mjs`); the DS calls (pass, blocked, passed, tuck) slot in by
how urgent they are. The first four exist in the DS now; the rest move from the Data Tap in step 4.

## What doesn't go in the per-tick object

- **The route card** (climbs, sprints, surfaces along the course, the rider's plan) and **the workout** (steps):
  sent once, as `{type: 'route', v: 1, id, ...}` / `{type: 'workout', ...}` with a revision number, again when they
  change. A display that wants a course strip asks for them; most use the meters and calls instead.
- **Explanations**: the help text for each meter and word lives in the DS (tooltips, a help page).

## Transport

- **Our display (the DS Grid):** a `BroadcastChannel('director-sportif/v1')` between our windows (same origin):
  messages `{type: 'tick', data: <the object>}`, `{type: 'route', ...}`, `{type: 'workout', ...}`, and
  `{type: 'hello'}` from a display that just opened (the DS answers with the route and workout).
- **Sauce's grid, later** (when it supports fields from mods): the same object, through whatever API they add.

## Decisions

Answered by the user, 2026-10-16:

1. **Words:** OK for now; a real ride will tell more.
2. **Nothing to read:** watt meters show 0 (like Sauce's draft gauge), the others blank; no word for alone etc.
3. **Holding vs Blocked:** blocking losses aren't in what Holding expects, so both rise together. Holding's word
   follows the cause: blocked -> "ease off" (as Blocked), moving up -> "moving up", otherwise over the band ->
   "easy", within -> "hold", under -> "drifting".
4. **Active words** for advice: "back off", "drift back", "change wheel", "go harder", "block left", "coast"...
5. **Levels:** the DS's own ranges are the defaults; the rider's thresholds in the display override them.
6. ~~Calls with numbers~~ Decided (2026-10-16): calls carry seconds (`in`, `for`), never meters; the DS does
   the conversion; the voice says the time too ("steep in 25").
