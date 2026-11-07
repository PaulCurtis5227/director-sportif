<!-- Director Sportif — a Sauce for Zwift mod. Copyright (C) 2026 Paul Curtis. SPDX-License-Identifier: GPL-3.0-or-later -->
# The recording

The Director Sportif can record your rides (Record button, or every event / all the time in the settings). The file
stays on your computer: it's saved to your Downloads folder as `ds-capture-<date>.ndjson.gz`. Nothing is sent
anywhere unless you take the file somewhere yourself, for example to get a ride report at caffecter.com.

Code: `pages/src/capture.mjs` (writing and reading), `pages/src/engine/checkpoint.mjs` (saved every 30 s, so a
crash loses at most half a minute).

## What's in it

**You, in full.** Your entry from Sauce, every tick: your power, speed, cadence, position on the road, draft, your
Zwift profile as Sauce has it (name, weight, height, FTP) and your heart rate. It's your own data on your own disk.

**Every other rider: where they were, the draft they got and their power** (from v0.56.0; before it, no power).
Per rider, per tick:

| Field | Why |
|---|---|
| state time (`worldTime`) | gaps corrected for uneven arrival |
| road and direction | which road |
| position along it | gap, place, group |
| left / right (`roadPosition`) | wheel, side, room |
| speed | closing speeds |
| Zwift's draft | the draft each rider got |
| active power-up | the physics under AERO, the feather… |
| power | what the pack's effort and the draft cost each rider |
| map position (`x`, `y`; v0.59.0) | gaps on roads Sauce has no map for; bends |
| a random id, new for every recording | to keep a rider's track together; nothing links two recordings |

Their weight and height, as Sauce has them, once per rider (again only if they change; none for riders Zwift hides
them for, such as minors): the physics of a rider needs their mass and size.

Not recorded for other riders: names, Zwift ids, cadence, heart rate, FTP, chat.

**The director's call** at each tick, your **marks** (the Mark button) and, with the OBS link on, when your OBS
recording and stream started (so a moment can be found in your video). In an event, its name, category and type, and
when the recording stops, **your result** from Sauce: your place and how many riders finished and started (counts only,
nothing about any other rider).

## The format

NDJSON, gzipped. Line 1 is a header:

```json
{"__capture": 1, "format": "capture-1.2", "createdAt": <ms>, "fields": ["worldTime", "roadId", ...], "meta": {...}}
```

Then one line per tick:

```json
{"t": <ms>, "me": <your Sauce entry, or null while you watch someone else>, "r": [[id, ...values], ...], "c": [call, state, in], "b": [[id, kg, cm], ...]}
```

`values` follow the header's `fields`; a value that didn't change since that rider's last row is `null`, and trailing
unchanged values are left off. `b` (weight and height) only on the tick a rider is first seen, or when it changes. `readCapture(text)` in `capture.mjs` puts them back. Marks are `{"t", "mark"}` lines,
video clocks `{"t", "video": {kind, event, startMs}}`, your event `{"t", "event": {sg, name, subgroup, type}}` and
your result `{"t", "event": {sg, place, finishers, started, timeMs}}`.

`format` is `capture-1` before v0.56.0, `capture-1.1` from it (other riders' power and body added) and `capture-1.2` from
v0.59.0 (their map position, x / y: about a third more bytes); readers go by
`fields`, so every reader reads both.

At about 3.5–6 MB an hour (gzipped), a two-hour race is ~10 MB.
