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

**Every other rider, only where they were and the draft they got.** Per rider, per tick:

| Field | Why |
|---|---|
| state time (`worldTime`) | gaps corrected for uneven arrival |
| road and direction | which road |
| position along it | gap, place, group |
| left / right (`roadPosition`) | wheel, side, room |
| speed | closing speeds |
| Zwift's draft | the draft each rider got |
| active power-up | the physics under AERO, the feather… |
| a random id, new for every recording | to keep a rider's track together; nothing links two recordings |

Not recorded for other riders: names, Zwift ids, power, cadence, heart rate, weight, height, chat.

**The director's call** at each tick, your **marks** (the Mark button) and, with the OBS link on, when your OBS
recording and stream started (so a moment can be found in your video).

## The format

NDJSON, gzipped. Line 1 is a header:

```json
{"__capture": 1, "format": "capture-1", "createdAt": <ms>, "fields": ["worldTime", "roadId", ...], "meta": {...}}
```

Then one line per tick:

```json
{"t": <ms>, "me": <your Sauce entry, or null while you watch someone else>, "r": [[id, ...values], ...], "c": [call, state, in]}
```

`values` follow the header's `fields`; a value that didn't change since that rider's last row is `null`, and trailing
unchanged values are left off. `readCapture(text)` in `capture.mjs` puts them back. Marks are `{"t", "mark"}` lines,
video clocks `{"t", "video": {kind, event, startMs}}`.

At about 3.5–6 MB an hour (gzipped), a two-hour race is ~10 MB.
