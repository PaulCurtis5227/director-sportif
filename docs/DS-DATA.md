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
· `coasting` (under 30 W in a group; Position also on a fast descent, 45+ km/h and 2%+ down, v0.60.1) · `warming` (filling the window) · `draftless` (you get no draft at all: 0 W on a
wheel for 10 s at 25+ km/h (v0.60.1; not while a burrito is out, estimated gaps count half), a TT bike in a group or a time trial; Position, Holding, Pack cost, Blocked and Passing, and their
calls, plus move up, habits and the finish's wheel calls, v0.40.0) · `no-map` (a road Sauce has no map for, its gaps all
0, until the road is measured from your own riding: the pack meters, Gap and L/R; v0.50.0, word "no map") · `none`
(nothing to show here). No word is shown for them (except `no-map`); the value is 0 (watt meters) or blank (the rest).
Once measured, Gap is `approx` (from the road completion, ~0.3 m off at 5–15 m).

| Meter (key) | Value | Unit | States → word | Level (warn / alarm) |
|---|---|---|---|---|
| Position (`position`) | watts your spot saves short of the ideal spot at your speed (0 = nothing to gain; v0.31.0, was vs the best-placed rider in your group), 10 s | W | `good` stay · `sit-in` sit in (front of the group) · `shatter` shattering (the riders ahead split up; v0.45.0) · `gapping` gap opening (a hole opening ahead of your wheel or the next, or the riders ahead riding away; v0.45.0) · `dropping` losing group (you falling off the back of the group you rode with, shown when alone too; v0.58.0) · `too-close` back off · `boxed` drift back (boxed in: to the back, where there's room) · `close-up` close up (gap too big) · `off-back` close up (10 m+ behind the wheel ahead for 3 s: off the back, a spoken gap call; v0.60.0) · `find-wheel` find a wheel · `unsteady` hold a wheel (less draft than your gap gives: the wheel moving about, or off its line; v0.37.0) · `no-draft` change wheel (the wheel gives no draft) | 7 / 28 W (the field's quartiles in two races) |
| Holding (`holding`) | power beyond what keeping your place needed, 10 s (pair) / 12 s (3+; 20 s before v0.67.0) | W | `hold` hold (within the band) · `easy` easy (over the band: pushing for nothing) · `blocked` ease off (over the band because you're blocked: the same word as Blocked) · `moving-up` moving up (over the band while moving up: the price of the move, not waste) · `drifting` drifting (under the band) | 20 / 40 W |
| Pack cost (`pack`) | watts your spot costs beyond Zwift's draft; since v0.67.0 Zwift's box (in line 0.5–3.25 m center to center behind a rider, holding or closing on them; × mass × speed²) + the draft above 27% of your air drag counted at 60% (pack-cost.mjs, docs/PLAN.md §26) | W | `box` in a wheel's box · `edge` its edge · `room` room (clear of the box) · `front` front · `group` in the group · `pair` with one (value null). Before v0.67.0 also `tight`, `crowded` and `boxed` (gone) | 25 / 40 W |
| Blocked (`blocked`) | since v0.67.0: the box's watts now, 5 s (pack-box.mjs: in line within about a bike length behind a rider, holding or closing); the state is said BEFORE you reach the box (closing, ≤ 3 s to it, seen 2 ticks) or while pushing into it, once per wheel per 20 s and 30 s apart; `blocked-left` / `blocked-right` no longer occur (the spike watch is gone, docs/PLAN.md §26). Before v0.67.0: watts lost to blocking spikes, 10 s | W | `clear` (no word) · `step-left` / `step-right` step left / right (held on the wheel in line: the free side, half a meter gets the watts back) · `blocked` ease off (the same with no room to step) · `blocked-left` / `blocked-right` drop back (stuck alongside a rider on that side) | 10 / 30 W |
| Passing (`passing`) | closing speed on the rider (0 with nobody closing) | km/h | `too-slow` go harder (you, closing 1–3 km/h: 3+ goes through; 1–5 / 5+ before v0.67.0) · `go-wide` go wide (you, in line with them) · `drop-back` drop back (you, glued to their wheel) · `rider-left` block left · `rider-right` block right · `none` | — |
| Gap (`gap`) | to your wheel: the rider ahead giving you the most draft (v0.60.1, wheel-pick.mjs: share by gap × a sideways factor, the pack one up to 1.5 m aside while your draft is good, a lone pair's 91 / 66 / 40% otherwise; a rider beside you is none; the wheel you're on kept within 80% of the best), wheel to wheel (center to center less a 1.5 m bike; below 0 = overlapping; null beyond 25 m; v0.51.0) | m | `wheel` (blank) · `beside` beside (none in line) · `no-wheel` no wheel · `no-draft` no draft | level (v0.57.0, ds-data.mjs gapLevel): `alarm` pushing into the wheel (Blocked `blocked` / `step-*`), `good` 2–3.5 m, `warn` under 1 m or over 5 m |
| Left / right (`side`) | you to the right (+) or left (−) of the wheel | m | `inline` (blank) · `beside` beside · `no-wheel` (blank) | — |
| Tuck (`tuck`) | km/h still needed to tuck (0 when fast enough; blank off a descent) | km/h | words in a race only (v0.51.0): `soon` supertuck in N (gaining speed, tuck speed within 15 s; the word with its seconds is in `tuck.word`, `tuck.inS`) · `stop` coast (fast enough: stop pedaling) · `build` (no word: short of tuck speed, or not a race) · `rest` (no word: fast enough, not a race or not known yet) · `tuck` tuck (in it) · `draft` in draft · `frame` no tuck (TT / MTB, or no draft at all on a wheel: a TT bike whatever the setting) · `none` | — |
| Group (`group`) | riders in your group, you included | riders | — | — |
| CdA (`cda`) | the air drag area the meters use | m² | `model` (bike × your size) · `yours` (your own CdA) · `guessed` (height or weight hidden) | — |

Extra fields a meter may carry beside `value / state / level`:
- `gap.centerM`: the same gap center to center (what the engine reads; before v0.51.0 this was the value).
- `gap.approx: true`: the gap came from positions, not Sauce's time gap (can be meters off; the Grid names it "Est. gap").
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

**Moving up through the group (v0.57.0):** while you ride 1+ km/h faster than your group (`ds.throughKmh`, 3 s), no call
that holds you back is made: ease off (`blocked` and the habit `nudge` `wheel`), drop back (`alongside`, `pass` `drop-back`),
give room / get in line (`nudge`), being passed (`passed`). **Bends** (`bend`) are their own lane: the call shown when
nothing else is, sounded on their own timing. **Only calls you can hear compete** for the sound: a type you turned off no
longer holds back a lower one you hear.

A display shows the word and the times ("steep 25 s · 40 s", "AERO 12 s"). The voice says the word, then the time
if there is one ("steep in 25", "AERO in 12"); the chime is the call `id`'s own (v0.30.0: no Zwift messages to yourself any more). Speeds and watts stay on the meters, not in calls (a closing speed is the Passing meter).

| Call (id) | States → word | in / for | Priority |
|---|---|---|---|
| Your pass (`pass`) | `too-slow` go harder · `drop-back` drop back (`go-wide` is shown on the Passing meter, never called: v0.34.0) | — | 70 |
| Gap opening (`gap`) | `opening` gap opening (Position `gapping`) · `dropping` losing group (Position `dropping`, once per drift; v0.58.0) · `close-up` close up (Position `off-back`; v0.60.0) | — | 75 |
| Group shattering (`shatter`, v0.57.0; was `gap` / `shatter`) | `group` group shattering (Position `shatter`) | — | 75 |
| Ease off (`blocked`) | `wheel` ease off (pushing into the wheel, no room to step) | — | 65 |
| Step out (`step`, v0.57.0; was `blocked`) | `step-left` / `step-right` step left / right | — | 65 |
| Stuck alongside (`alongside`, v0.57.0; was `blocked` / `left` · `right`) | `left` / `right` drop back | — | 65 |
| Being passed (`passed`) | `left` block left · `right` block right (in a race or practice race only, never a teammate; straight behind: no call, v0.51.0) | — | 60 |
| Tuck (`tuck`) | `stop` coast | — | 40 |
| Move up (`moveUp`) | `prep` climb · `move` move up · `hold` hold spot · `late` stay in line | in: to the climb | 40 / 80 / 60 / 30 |
| Nudge (`nudge`) | `wheel` ease off · `middle` use edge · `front` sit in · `line` get in line · `crowd` give room (under 1 m off the wheel at full draft for 10 s: ~5 W for the same speed; v0.41.0) | — | 18–22 |
| Sprint (`sprint`) | `position` top ten · `good` good spot · `windup` get a wheel · `last` last wheel, be ready · `last-go` jump now · `window-prep` jump in N (`inS`: seconds to the window; v0.45.0) · `window` you can go · `take-wheel-light` / `-medium` / `-hard` wheel, jump light / medium / hard (call id `wheel`, last km, at the moment to jump; `take-wheel` wheel, jump without FTP / model) · `closer` dig in · `keep-going` keep going · `ease-ftp` ease to FTP · `ease` ease off (both also at contested race-card intermediates: `intermediate: true`, `remainingM` to its line) · `clear` safe, coast (the finish, no jump needed: no place can change even if you coast; v0.56.1) · `shake-left` drift left · `shake-right` drift right | in: to the line | 55–94; `targetW`: the power you can hold to the line leaving 3 kJ |
| Power-up (`powerup`) | `ready-<name>` AERO · `fire-<name>` AERO now · `hold-<name>` AERO (in N) or AERO at jump (no seconds) · `feather-ready` FEATHER (in N) · `feather-soon` FEATHER in 10 (12–8 s before, over every finish call; v0.60.0) · `feather-fire` FEATHER now (the feather you hold, at the steepest 30 s of a climb ahead, 3%+; v0.41.0) | in: until it should fire | 70–95 (feather 50 / 75) |
| Burritos (`burrito`) | `cone` burrito, move over (an active burrito 1–8.5 m ahead of you, within a quarter of that aside: measured 2026-10-27) · `done` burritos done (90% of your race fired theirs; 10 s) | — | 72 / 30 |
| Flyer (`flyer`) | `away` "flyer, go" / "two flyers, go" (v0.66.0: one or two riders jumping off the front of your bunch in an event: 3 m+ clear and under 2.5 s up, 3 km/h+ faster than the rest's median for 3 updates, the gap grown 2 m+ in 3 s; once per flyer, 60 s apart; while it goes no "ease off". v0.65.0 waited for 20 m: too late to catch) | — | 74 |
| Teammate HR (`teamHr`) | `missing` "Nick: no heart rate" (you, or a teammate: your team tag, your race; none for 20 s; said at the start and every 2 min until acknowledged in the window: a teammate once per event, you up to 3 times) · `back` "Nick: heart rate back" (once) | — | 74 / 30 |
| Bridge (`bridge`, after the Bridge button; v0.53.0) | `now` bridge now · `last` last chance to bridge · `later` bridge on the climb / bridge (in N) · `far` too far to bridge · `attack` attack · `hold-<W>` hold W · `made` made it | in: to the cheapest start (later) | 68 (later 50) |
| Climb pacing (`pacing`) | `steep` steep (a part averaging 5%+; on a climb only 1.5 points steeper than where you are) · `top` over top (after 30 s of climbing, 5–15 s out) | in: to the steep part / the top; for: how long it's steep | 35 |
| Bend (`bend`) | `open-left` / `open-right` move left / right (v0.58.0, was "inside left / right": the inside is open, moving over gains ground after the draft it costs; read from your place on the road, so alone and in a TT too; in the finish too) · nothing when you're on the inside already (within 0.5 m of the road's inside edge) or on the outside with no way in (v0.58.0: "stay close" dropped, a hold-the-wheel call) · `cut-s` cut the S / `cut-bend` cut the bend (v0.51.0: a stretch ahead twisting enough to steer a shorter line: dirt 90°+ per 100 m, pavement 120°+; your route's geometry; replaces the others) | in: to the bend (inside, cut) | 45 (cut 46) |
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
   follows the cause: blocked -> "step left / right" or "ease off" (as Blocked), moving up -> "moving up", otherwise over the band ->
   "easy", within -> "hold", under -> "drifting".
4. **Active words** for advice: "back off", "drift back", "change wheel", "go harder", "block left", "coast"...
5. **Levels:** the DS's own ranges are the defaults; the rider's thresholds in the display override them.
6. ~~Calls with numbers~~ Decided (2026-10-16): calls carry seconds (`in`, `for`), never meters; the DS does
   the conversion; the voice says the time too ("steep in 25").
