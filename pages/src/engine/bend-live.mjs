/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bend cue: take the inside when it's open, hold the wheel when it isn't.
 *
 * Zwift moves every rider at their own speed along their OWN line (speed through x/y = reported speed
 * within 0.5%, inside and outside alike), so the inside of a bend is a shortcut: you gain about
 * lateral offset × turn angle on the riders beside you. Measured on the 2026-09-29 Innsbruck race
 * (pairs of riders, local frames, sagitta-corrected): +0.19 m/s observed vs ~+0.17 predicted. That
 * race's user bend time: outside of the bunch −93.5 m, inside +63.7 m. In a pack you can't always
 * steer in — the inside was open only 13% of the time when on the outside — so the cue checks.
 *
 * Cutting in off your wheel costs draft fast (bends, both rides: 0.3–0.6 m inside keeps 86–91% of max
 * draft, 0.6–1 m 58–68%, 1–1.5 m ~40%; the OUTSIDE of the wheel keeps 97–100%). Gain and draft cost
 * both scale with speed², so speed hardly matters; at max draft cutting in almost never pays unless
 * there's another wheel on the inside to take. When you aren't drafting, the inside is free ground.
 *
 * The road ahead comes from every rider's track, pooled per course/road/direction/0.25% of
 * roadCompletion (its centre position and direction of travel), so the riders ahead of you draw the
 * bend before you reach it, and the map is saved per course.
 *
 * Zwift's x/y is MIRRORED relative to the map: a counter-clockwise turn in x/y is a RIGHT turn (checked
 * against the latlng track: 579/579 turns on the Innsbruck race, 1803/1803 on a Watopia group ride). All
 * geometry here is in x/y; only the words
 * shown to the rider are flipped.
 */

export const BEND_BIN = 2500;          // roadCompletion units per spot (as surface-live.mjs)
export const BEND_BINS = 1_000_000 / BEND_BIN;
export const BEND_LOOK_M = [15, 120];  // cue while the bend starts this far ahead
export const BEND_MIN_DEG = 30;        // smaller bends aren't worth steering for
export const BEND_MIN_GAIN_M = 1.0;    // …nor is less than this much road
export const BEND_START_DEG = 5;       // the road has turned this much -> the bend has started
export const INSIDE_MAX_M = 1.5;       // never suggest moving further than this
export const BIKE_WIDTH_M = 0.6;       // lateral room you need beside a rider
export const CORRIDOR_ALONG_M = [-2, 1];   // riders beside you (along-track m) block moving in
export const OUTSIDE_M = 0.3;          // this far outside the local bunch centre counts as "on the outside"
export const NEIGHBOUR_ALONG_M = 15;
export const WHEEL_AHEAD_M = 6;       // a rider this close ahead is a wheel you can take
export const BEND_IN_BACK_M = 30;     // the road over this far behind you…
export const BEND_IN_DEG = 3;         // …turned this much the same way: you're in the bend, no bend "ahead"
const XY_CCW_IS_RIGHT = true;
const SAVED_WEIGHT = 20;
const SPOT_CAP = 400;

const wrapDeg = a => ((a + 540) % 360) - 180;
const deg = r => r * 180 / Math.PI;

export function bendKey(courseId, roadId, reverse, bin) {
    return `${courseId}:${roadId}:${reverse ? 1 : 0}:${((bin % BEND_BINS) + BEND_BINS) % BEND_BINS}`;
}

export class BendMap {
    constructor({saved = null} = {}) {
        this.spots = new Map();   // key -> {sx, sy (cm), ux, uy (unit dir sums), n, salt (m), sv (m/s), na}
        this.prev = new Map();    // athleteId -> last state
        this.self = [];           // your last few samples {x, y, wt}
        this.load(saved);
    }

    load(saved) {
        if (!saved || saved.v !== 1 || !saved.spots) {
            return;
        }
        for (const [k, [x, y, a10, n, alt10, v10]] of Object.entries(saved.spots)) {
            if (this.spots.has(k) || !(n > 0)) {
                continue;
            }
            const w = Math.min(n, SAVED_WEIGHT);
            const a = a10 / 10 * Math.PI / 180;
            const hasAlt = Number.isFinite(alt10) && Number.isFinite(v10);
            this.spots.set(k, {sx: x * w, sy: y * w, ux: Math.cos(a) * w, uy: Math.sin(a) * w, n: w,
                               salt: hasAlt ? alt10 / 10 * w : 0, sv: hasAlt ? v10 / 10 * w : 0, na: hasAlt ? w : 0});
        }
    }

    toJSON(courseId = null) {
        const spots = {};
        const prefix = courseId == null ? '' : `${courseId}:`;
        for (const [k, s] of this.spots) {
            if (s.n >= 5 && k.startsWith(prefix)) {
                spots[k] = [Math.round(s.sx / s.n), Math.round(s.sy / s.n), Math.round(deg(Math.atan2(s.uy, s.ux)) * 10),
                            Math.min(Math.round(s.n), 999)];
                if (s.na > 0) {
                    spots[k].push(Math.round(s.salt / s.na * 10), Math.round(s.sv / s.na * 10));
                }
            }
        }
        return {v: 1, spots};
    }

    ingest(entries) {
        for (const o of entries) {
            const s = o && o.state;
            if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.roadCompletion)) {
                continue;
            }
            const p = this.prev.get(o.athleteId);
            if (p && s.worldTime <= p.worldTime) {
                continue;
            }
            this.prev.set(o.athleteId, s);
            if (o.self) {
                this.self.push({x: s.x, y: s.y, wt: s.worldTime, road: s.roadId, rev: !!s.reverse});
                if (this.self.length > 3) {
                    this.self.shift();
                }
            }
            if (!p || p.roadId !== s.roadId || !!p.reverse !== !!s.reverse || p.courseId !== s.courseId ||
                s.worldTime - p.worldTime > 3000) {
                continue;
            }
            const dx = s.x - p.x;
            const dy = s.y - p.y;
            const L = Math.hypot(dx, dy);
            if (L < 200 || L > 3000) {   // 2–30 m in one step (cm)
                continue;
            }
            const key = bendKey(s.courseId, s.roadId, s.reverse, Math.floor(((s.roadCompletion + p.roadCompletion) / 2) / BEND_BIN));
            let sp = this.spots.get(key);
            if (!sp) {
                this.spots.set(key, sp = {sx: 0, sy: 0, ux: 0, uy: 0, n: 0, salt: 0, sv: 0, na: 0});
            }
            if (sp.n >= SPOT_CAP) {
                for (const f of ['sx', 'sy', 'ux', 'uy', 'n', 'salt', 'sv', 'na']) {
                    sp[f] *= 0.5;
                }
            }
            sp.sx += (s.x + p.x) / 2;
            sp.sy += (s.y + p.y) / 2;
            sp.ux += dx / L;
            sp.uy += dy / L;
            sp.n += 1;
            // Altitude and riders' speed per spot: the climb profile ahead for the feather cue.
            if (Number.isFinite(s.altitude) && Number.isFinite(p.altitude)) {
                sp.salt += (s.altitude + p.altitude) / 2;
                sp.sv += ((s.speed || 0) + (p.speed || 0)) / 2 / 3.6;
                sp.na += 1;
            }
        }
    }

    /*
     * The stretches of road ahead in bins, rising (Sauce flips roadCompletion in reverse, so it rises the way you
     * ride): [{roadId, reverse, from, to (null = open)}]. Off a route: this road on (bins wrap: a loop road). On a
     * route (route-ahead.mjs routeSections: road percents): to the end of your section, then the route's next sections.
     * 2026-10-30: the road straight on past a junction drew a right bend while the route turned left.
     */
    legs(s, route = null) {
        const bin0 = Math.floor(s.roadCompletion / BEND_BIN);
        const open = [{roadId: s.roadId, reverse: !!s.reverse, from: bin0, to: null}];
        const list = route && Array.isArray(route.sections) ? route.sections : null;
        if (!list || !list.length) {
            return open;
        }
        const rc = (x, p) => (x.reverse ? 1 - p : p) * 1e6;
        const span = x => {
            const lo = Math.min(x.start, x.end);
            const hi = Math.max(x.start, x.end);
            return x.reverse ? [rc(x, hi), rc(x, lo)] : [rc(x, lo), rc(x, hi)];
        };
        const pct = s.reverse ? 1 - s.roadCompletion / 1e6 : s.roadCompletion / 1e6;
        const eps = 0.002;
        const i = list.findIndex(x => x.roadId === s.roadId && !!x.reverse === !!s.reverse &&
                                      pct >= Math.min(x.start, x.end) - eps && pct <= Math.max(x.start, x.end) + eps);
        if (i < 0) {
            return open;   // not where the route says: this road only
        }
        const out = [{roadId: s.roadId, reverse: !!s.reverse, from: bin0, to: Math.floor(span(list[i])[1] / BEND_BIN)}];
        const lapStart = Math.max(0, list.findIndex(x => !x.leadin));
        for (let n = 1, k = i + 1; n < list.length; n++, k++) {
            if (k >= list.length) {
                if (!route.laps) {
                    break;
                }
                k = lapStart;
            }
            const x = list[k];
            const [a, b] = span(x);
            out.push({roadId: x.roadId, reverse: !!x.reverse, from: Math.floor(a / BEND_BIN), to: Math.floor(b / BEND_BIN)});
        }
        return out;
    }

    /*
     * The road ahead as [{d (m from you), a (x/y direction, deg), alt (m), v (riders' mean m/s)}], from the pooled
     * spots. route: your route's sections (followed past junctions), or null (this road on).
     */
    roadAhead(s, maxM = 200, route = null) {
        const me = this.self;
        if (me.length < 2) {
            return null;
        }
        const a = me[me.length - 2];
        const b = me[me.length - 1];
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        if (L < 100) {
            return null;
        }
        const dir = [(b.x - a.x) / L, (b.y - a.y) / L];
        // ahead = a higher roadCompletion, in reverse too: Sauce flips it for reverse riders (zwift.mjs 1005000 −
        // roadTime), so it rises the way you ride. Walking down in reverse read the road behind you (v0.68.3: "steep
        // in 16" at 59 km/h on a descent, no climb for 13 min)
        const pts = [];
        let prev = {x: b.x, y: b.y};
        let d = 0;
        let missing = 0;
        let k = 0;
        walk: for (const leg of this.legs(s, route)) {
            for (let bin = leg.from; leg.to == null || bin <= leg.to; bin++) {
                if (k++ >= 160 || d > maxM) {
                    break walk;
                }
                const sp = this.spots.get(bendKey(s.courseId, leg.roadId, leg.reverse, bin));
                if (!sp || sp.n < 3) {
                    if (++missing > 8) {
                        break walk;
                    }
                    continue;
                }
                missing = 0;
                const c = {x: sp.sx / sp.n, y: sp.sy / sp.n};
                // Skip spots behind you (the bin you're in, or a direction mix-up).
                if (pts.length === 0 && ((c.x - b.x) * dir[0] + (c.y - b.y) * dir[1]) <= 0) {
                    continue;
                }
                d += Math.hypot(c.x - prev.x, c.y - prev.y) / 100;
                prev = c;
                pts.push({d, a: deg(Math.atan2(sp.uy, sp.ux)), alt: sp.na ? sp.salt / sp.na : null, v: sp.na ? sp.sv / sp.na : null});
            }
        }
        return pts.length >= 3 ? {pts, a0: deg(Math.atan2(dir[1], dir[0])), dir, pos: b} : null;
    }


    /*
     * Every bend within maxM: [{startM, endM, angleDeg (x/y, + = CCW), right (map sense)}]. A bend starts
     * when the road has turned BEND_START_DEG from its direction just before, and ends where it stops
     * turning (8° back from its maximum) or turns the other way.
     */
    bendsAhead(s, maxM = 200, route = null) {
        const road = this.roadAhead(s, maxM, route);
        if (!road) {
            return [];
        }
        const out = [];
        let ref = road.a0;
        let cur = null;
        const close = () => {
            out.push({startM: cur.startM, endM: cur.endM, angleDeg: cur.best,
                      right: XY_CCW_IS_RIGHT ? cur.best > 0 : cur.best < 0});
            cur = null;
        };
        for (const p of road.pts) {
            const rel = wrapDeg(p.a - ref);
            if (!cur) {
                if (Math.abs(rel) >= BEND_START_DEG) {
                    cur = {startM: p.d, endM: p.d, best: rel};
                } else {
                    ref = wrapDeg(ref + 0.2 * rel);   // follow a slowly drifting straight
                }
                continue;
            }
            if (Math.sign(rel) !== Math.sign(cur.best) || Math.abs(rel) < Math.abs(cur.best) - 8) {
                ref = p.a;
                close();
                continue;
            }
            if (Math.abs(rel) > Math.abs(cur.best)) {
                cur.best = rel;
                cur.endM = p.d;
            }
        }
        if (cur) {
            close();
        }
        return out;
    }

    /*
     * How far the road turned over the last backM up to you (x/y degrees, + = CCW): the pooled spots' directions there
     * and here (not your own two samples: a sideways move of 0.5 m reads as 3°). null when the spots are missing.
     */
    turnedBehind(s, backM = BEND_IN_BACK_M) {
        const bin0 = Math.floor(s.roadCompletion / BEND_BIN);
        const spot = bin => {
            const sp = this.spots.get(bendKey(s.courseId, s.roadId, s.reverse, bin));
            return sp && sp.n >= 3 ? sp : null;
        };
        let k0 = 0;
        while (k0 <= 8 && !spot(bin0 - k0)) {
            k0++;
        }
        const here = spot(bin0 - k0);
        if (!here) {
            return null;
        }
        let prev = {x: here.sx / here.n, y: here.sy / here.n};
        let d = 0;
        let missing = 0;
        for (let k = k0 + 1; k < k0 + 40; k++) {
            const sp = spot(bin0 - k);
            if (!sp) {
                if (++missing > 8) {
                    return null;
                }
                continue;
            }
            missing = 0;
            const c = {x: sp.sx / sp.n, y: sp.sy / sp.n};
            d += Math.hypot(c.x - prev.x, c.y - prev.y) / 100;
            prev = c;
            if (d >= backM) {
                return wrapDeg(deg(Math.atan2(here.uy, here.ux)) - deg(Math.atan2(sp.uy, sp.ux)));
            }
        }
        return null;
    }

    /*
     * The first bend of at least minDeg ahead, or null; null too while you're already in it: inside a long curve the
     * road ahead always turns another 5° 15–20 m on, so the bend seemed to start there all the way round (2026-10-30:
     * "inside right in 2" for 30 s through a 120° sweep). route: your route's sections (roadAhead).
     */
    nextBend(s, maxM = 200, minDeg = BEND_MIN_DEG, route = null) {
        const b = this.bendsAhead(s, maxM, route).find(x => Math.abs(x.angleDeg) >= minDeg) || null;
        const t = b ? this.turnedBehind(s) : null;
        if (t != null && Math.sign(t) === Math.sign(b.angleDeg) && Math.abs(t) >= BEND_IN_DEG) {
            return null;
        }
        return b;
    }
}

/*
 * Where you sit across the bunch for a bend turning `sign` (+1 = CCW in x/y). entries: the nearby
 * snapshot; me: your entry; dir: your x/y direction (unit); kRadPerM: current road curvature (x/y sense)
 * for the sagitta correction. Returns {inside (m, + = inside of the bunch centre), room (m you can move
 * in without hitting a rider beside you), insideWheels [m inside of you, riders 1–6 m ahead],
 * wheelInside (m your own wheel sits inside of you, or null), riders}.
 */
export function lateralSituation(entries, me, dir, sign, kRadPerM = 0) {
    const s = me.state;
    const nrm = [-dir[1], dir[0]];
    const rel = [];
    for (const o of entries) {
        const t = o && o.state;
        if (!t || o === me || t.roadId !== s.roadId || !!t.reverse !== !!s.reverse || !Number.isFinite(t.x)) {
            continue;
        }
        const dx = (t.x - s.x) / 100;
        const dy = (t.y - s.y) / 100;
        const along = dx * dir[0] + dy * dir[1];
        if (Math.abs(along) > NEIGHBOUR_ALONG_M) {
            continue;
        }
        const lat = dx * nrm[0] + dy * nrm[1] - kRadPerM * along * along / 2;
        if (Math.abs(lat) < 8) {
            rel.push({along, lat});
        }
    }
    if (rel.length < 2) {
        return null;
    }
    const myLat = -rel.reduce((a, z) => a + z.lat, 0) / rel.length;   // + = CCW side of the bunch centre
    let room = INSIDE_MAX_M;
    const wheels = [];
    let wheel = null;
    for (const z of rel) {
        const li = z.lat * sign;
        if (li > 0.05 && z.along > CORRIDOR_ALONG_M[0] && z.along < CORRIDOR_ALONG_M[1]) {
            room = Math.min(room, li - BIKE_WIDTH_M);   // beside you: you'd bump into them
        }
        if (z.along >= CORRIDOR_ALONG_M[1] && z.along <= WHEEL_AHEAD_M) {
            if (li > 0.3 && li <= INSIDE_MAX_M + 0.3) {
                wheels.push(li);
            }
            if (Math.abs(z.lat) <= 1.2 && (!wheel || Math.abs(z.lat) < Math.abs(wheel.lat))) {
                wheel = {lat: z.lat, li};   // your wheel = the rider most directly in front
            }
        }
    }
    room = Math.max(0, room);
    return {inside: myLat * sign, room, insideWheels: wheels.filter(x => x <= room + 0.3).sort((a, b) => a - b),
            wheelInside: wheel ? wheel.li : null, riders: rel.length};
}

/* Draft kept when you sit this far INSIDE the wheel in front in a bend (2026-09-27 + 09-29 bunch data;
 * outside of the wheel keeps 97–100% up to 1 m). */
export const INSIDE_DRAFT = [[0, 1], [0.45, 0.88], [0.8, 0.6], [1.25, 0.39], [2, 0.33]];

export function insideDraftFactor(x) {
    const t = INSIDE_DRAFT;
    if (x <= 0) {
        return 1;
    }
    for (let i = 1; i < t.length; i++) {
        if (x <= t[i][0]) {
            const f = (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
            return t[i - 1][1] + f * (t[i][1] - t[i - 1][1]);
        }
    }
    return t[t.length - 1][1];
}

/*
 * The cue for one tick: {state: 'open'|'outside'|null, text, bend, gainM, lossM, moveM}.
 * `open` only when the ground gained beats the draft given up: gain = move × angle; the draft lost over
 * the bend is converted into metres at what a metre costs to win back at your current draft. Both scale
 * with speed², so the answer barely depends on speed — it depends on the bend's radius and on whether
 * there's a wheel to take on the inside. ctx: {v (m/s), q (draft as a fraction of your max, 0..1),
 * cap (m²), cda (m²), fRollN, rho}. `outside`: you're on the outside (of the bunch or of your wheel) and
 * moving in doesn't pay — you'll lose ground, stay close.
 */
export function bendCue(bend, lat, ctx = {}) {
    const none = {state: null, text: '', bend, gainM: 0, lossM: 0, moveM: 0};
    if (!bend || !lat || bend.startM < BEND_LOOK_M[0] || bend.startM > BEND_LOOK_M[1] ||
        Math.abs(bend.angleDeg) < BEND_MIN_DEG) {
        return none;
    }
    const {v = 10, q = 0, cap = 0.14, cda = 0.28, fRollN = 3.5, rho = 1.225} = ctx;
    const rad = Math.abs(bend.angleDeg) * Math.PI / 180;
    const side = bend.right ? 'right' : 'left';
    const head = `${side === 'right' ? 'Right' : 'Left'} bend in ${Math.round(bend.startM)} m (${Math.round(Math.abs(bend.angleDeg))}°)`;
    const pv2 = 0.5 * rho * v * v;
    const arcM = Math.max(10, bend.endM - bend.startM) + 10;
    const perMetreJ = 3 * Math.max(0.05, cda - q * cap) * pv2 + fRollN;
    let best = null;
    const moves = [...lat.insideWheels.map(x => ({x, onWheel: true})),
                   ...[0.5, 1.0, lat.room].filter(x => x >= 0.3 && x <= lat.room).map(x => ({x, onWheel: false}))];
    for (const m of moves) {
        const qNew = m.onWheel ? q : q * insideDraftFactor(m.x);
        const lostJ = Math.max(0, q - qNew) * cap * pv2 * arcM;
        const net = m.x * rad - lostJ / perMetreJ;
        if (!best || net > best.net) {
            best = {...m, net};
        }
    }
    const behind = lat.wheelInside != null && lat.wheelInside > OUTSIDE_M ? lat.wheelInside : 0;
    const lossM = Math.max(lat.inside < -OUTSIDE_M ? -lat.inside : 0, behind) * rad;
    if (best && best.net >= BEND_MIN_GAIN_M) {
        const how = best.onWheel ? `move ${side} onto the wheel there (~${best.x.toFixed(1)} m)` :
            `move ${side} ~${best.x.toFixed(1)} m`;
        const note = !best.onWheel && q > 0.3 ? ' after the lost draft' : '';
        return {state: 'open', bend, gainM: best.net, lossM, moveM: best.x,
                text: `${head}: inside open — ${how}, worth ~${best.net.toFixed(1)} m${note}`};
    }
    if (lossM >= BEND_MIN_GAIN_M) {
        const note = q > 0.3 ? ' (holding the draft beats cutting in)' : '';
        return {state: 'outside', bend, gainM: 0, lossM, moveM: 0,
                text: `${head}: you're on the outside — you'll lose ~${lossM.toFixed(1)} m, stay close${note}`};
    }
    return none;
}
