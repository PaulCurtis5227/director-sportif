/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The road ahead from the route you are on (the user, 2026-10-16: "if we are on a route, why do you need to look
 * ahead with other riders?"). Sauce knows the route: its road sections in order, with the lead-in and the join
 * between laps (common.mjs getRoute -> computeRoutePath: distances and elevations per node), and where you are on it
 * (state.routeDistance / routeEnd). This works alone, from the first second, as far ahead as needed. The road learned
 * from other riders (engine/bend-live.mjs BendMap) stays the fallback off a route.
 *
 * Placing you: as Sauce's elevation window does, by the distance left in the lap (routeEnd − routeDistance): the
 * lap's finish line never moves, its start can (lead-in on the first lap, the join after it).
 * Pure (no Sauce imports): the loader is passed in, so this runs headless.
 * The route's roads in order (routeSections; v0.46.1): the surface ahead follows them past a junction (road-map.mjs).
 */

export const TRACE_STEP_M = 5;   // the traced profile: a point every this many meters

/*
 * The road's own curve, traced finely (Sauce's CurvePath.trace, as its supplimentPath does, but keeping every few
 * meters instead of one point per road node): [{d, alt, node}]. Sauce's per-node arrays are ~58 m apart (median,
 * up to 250 m), so a climb's foot snapped to the node before: 85–90 m (~10 s) early at Innsbruck (2026-10-16).
 */
function traceProfile(path, zToAlt) {
    const out = [];
    let d = 0, prev = null, lastPush = -Infinity, lastP = null;
    // a: the road's direction (x/y degrees) from the point before: how much it turns ahead (curvyStretch)
    const dir = p => (lastP ? Math.atan2(p[1] - lastP[1], p[0] - lastP[0]) * 180 / Math.PI : null);
    path.trace(x => {
        const p = x.stepNode;
        if (prev) d += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) / 100;
        prev = p;
        if (d - lastPush >= TRACE_STEP_M) {
            out.push({d, alt: zToAlt(p[2]), node: x.index, a: dir(p)});
            lastPush = d;
            lastP = p;
        }
    }, 1 / 64);
    if (prev && d > lastPush) out.push({d, alt: zToAlt(prev[2]), node: path.nodes.length - 1, a: dir(prev)});
    return out;
}

/*
 * The profile from a Sauce route object (common.mjs getRoute(id, {prelude: 'leadin'}), or the same built offline):
 * {first: [{d, alt}] (lead-in + lap), cycle: [{d, alt}] (join + lap, for the laps after) | null}. With r.zToAlt
 * (the world's z -> altitude, Sauce's zToAltitude) and a traceable curvePath: traced every TRACE_STEP_M; else
 * Sauce's per-node distances and elevations.
 */
export function routeProfile(r) {
    if (r && r.curvePath && typeof r.curvePath.trace === 'function' && typeof r.zToAlt === 'function') {
        return tracedProfile(r);
    }
    if (!r || !Array.isArray(r.distances) || !Array.isArray(r.elevations) || r.distances.length < 2) return null;
    const nodes = r.curvePath && r.curvePath.nodes ? r.curvePath.nodes : [];
    const sections = r.sections || [];
    const pts = r.distances.map((d, i) => ({d, alt: r.elevations[i]}));
    const first = pts.filter(p => Number.isFinite(p.d) && Number.isFinite(p.alt));
    let lapStart = nodes.findIndex(n => {
        const s = sections[n && n.index];
        return s && !s.leadin && !s.weld;
    });
    if (lapStart < 0) lapStart = 0;
    let cycle = null;
    if (r.supportedLaps) {
        const d0 = pts[lapStart].d;
        const lap = pts.slice(lapStart).map(p => ({d: p.d - d0, alt: p.alt}));
        const w = r.lapWeldData;
        const weld = w && Array.isArray(w.distances) ? w.distances.map((d, i) => ({d, alt: w.elevations[i]})) : [];
        const wLen = weld.length ? weld.at(-1).d : 0;
        cycle = [...weld, ...lap.map(p => ({d: p.d + wLen, alt: p.alt}))]
            .filter((p, i, a) => Number.isFinite(p.d) && Number.isFinite(p.alt) && (i === 0 || p.d > a[i - 1].d));
    }
    return {first, cycle};
}

function tracedProfile(r) {
    const nodes = r.curvePath.nodes;
    const sections = r.sections || [];
    const pts = traceProfile(r.curvePath, r.zToAlt);
    if (pts.length < 2) return null;
    const isLap = p => {
        const s = sections[nodes[p.node] && nodes[p.node].index];
        return s && !s.leadin && !s.weld;
    };
    const first = pts.map(p => ({d: p.d, alt: p.alt, a: p.a}));
    let cycle = null;
    if (r.supportedLaps) {
        const i0 = Math.max(0, pts.findIndex(isLap));
        const d0 = pts[i0].d;
        const weld = r.lapWeldPath && typeof r.lapWeldPath.trace === 'function' ?
            traceProfile(r.lapWeldPath, r.zToAlt).map(p => ({d: p.d, alt: p.alt, a: p.a})) : [];
        const wLen = weld.length ? weld.at(-1).d : 0;
        cycle = [...weld, ...pts.slice(i0).map(p => ({d: p.d - d0 + wLen, alt: p.alt, a: p.a}))]
            .filter((p, i, a) => i === 0 || p.d > a[i - 1].d);
    }
    return {first, cycle};
}

/*
 * The profile ahead of you: [{d (m from you), alt}] out to maxM, or null when the route doesn't fit where you are
 * (unknown route, or the distance left is longer than the lap). Runs into the next lap when the route has laps.
 */
export function profileAhead(prof, s, maxM = 3000) {
    if (!prof || !s) return null;
    const left = s.routeEnd - s.routeDistance;
    if (!Number.isFinite(left) || left < 0) return null;
    const seq = s.laps > 0 && prof.cycle ? prof.cycle : prof.first;
    const len = seq.at(-1).d;
    if (left > len + 50) return null;           // not this route's lap (a different prelude, or bad data)
    const pos = Math.max(0, len - left);
    const out = [];
    let offs = -pos;
    let cur = seq;
    for (let guard = 0; guard < 3; guard++) {
        for (const p of cur) {
            const d = p.d + offs;
            if (d <= 0) continue;
            if (d > maxM) return out;
            out.push(p.a != null ? {d, alt: p.alt, a: p.a} : {d, alt: p.alt});
        }
        if (!prof.cycle) break;
        offs += cur.at(-1).d;
        cur = prof.cycle;
    }
    return out;
}

/*
 * "Cut the S" (the user, 2026-10-30: "dirt S curves. Steering through that has to be a big win"). Measured on Watopia
 * (research/2026-10-30/curve-line.mjs, line ridden per 100 m vs riders not steering there): steering gains pavement /
 * dirt +0.85 / +1.27 m through 60–120° of turning, +1.22 / +2.03 m at 120°+; the best line 4–6 m. Worth the ~10 W
 * steering costs (steer-cost.mjs) on dirt from ~90°, on pavement only at 120°+ (S curves, hairpins).
 */
export const S_CURVE = {
    winM: 100,        // the stretch: its turning summed both ways (an S counts each bend)
    dirtDeg: 90,      // on dirt / gravel from this much turning
    paveDeg: 120,     // on pavement
    fromM: 15,        // called while the stretch starts this far ahead…
    toM: 150,         // …to this far
    stepM: 10,
    sideDeg: 30,      // turns at least this much each way: an S (else one bend: a hairpin)
    callS: 10,        // no call more than this many seconds before it
    inM: 30,          // the road under you (the next 30 m) already turning this much: you're in it, no call
    inDeg: 30,        // (the 2026-10-30 bend lesson: inside a long curve the next one always seems just ahead)
    beginDeg: 10,     // the stretch starts where the road has turned this much (the seconds count to there)
};

/*
 * The first stretch ahead that twists enough: pts [{d (m from you), a (road direction, deg)}] (profileAhead of a traced
 * route), minDegAt(startM, endM) -> the turning needed there (by surface). {startM, endM, turnDeg, s (both ways)} or null.
 */
export function curvyStretch(pts, minDegAt, o = S_CURVE) {
    const p = (pts || []).filter(x => Number.isFinite(x.a));
    if (p.length < 4) return null;
    const wrap = x => ((x + 540) % 360) - 180;
    const turning = (start, end) => {
        let turn = 0, left = 0, right = 0, prev = null;
        for (const x of p) {
            if (x.d < start) continue;
            if (x.d > end) break;
            if (prev != null) {
                const dA = wrap(x.a - prev);
                turn += Math.abs(dA);
                if (dA > 0) left += dA; else right -= dA;
            }
            prev = x.a;
        }
        return {turn, left, right};
    };
    if (turning(0, o.inM).turn >= o.inDeg) return null;
    for (let start = o.fromM; start <= o.toM; start += o.stepM) {
        const end = start + o.winM;
        const t = turning(start, end);
        if (t.turn >= minDegAt(start, end)) {
            // where the road starts turning inside the window (the window can open 40+ m before it: "in 9" meant 13 s)
            let at = start, acc = 0, prev = null;
            for (const x of p) {
                if (x.d < start) continue;
                if (prev != null && (acc += Math.abs(wrap(x.a - prev))) >= o.beginDeg) { at = x.d; break; }
                prev = x.a;
            }
            return {startM: at, endM: end, turnDeg: t.turn, s: t.left >= o.sideDeg && t.right >= o.sideDeg};
        }
    }
    return null;
}

const RHO = 1.225;
const G = 9.80665;

/* Speed (m/s) at power P on grade g: P = (½ρ·CdA·v² + m·g·(Crr + grade))·v, solved by bisection. */
export function speedAt(P, grade, {massKg, cda, crr}) {
    const need = v => (0.5 * RHO * cda * v * v + massKg * G * (crr + grade)) * v;
    let lo = 0.5, hi = 30;
    if (need(lo) > P) return lo;
    for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (need(mid) > P) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
}

export const MIN_WKG = 2.0;   // the effort floor for the speed estimate (a coasting approach is not your climbing power)

export const CLIMB_FROM = 0.02;   // steeper than this, the climb's own speed (at your effort) applies
export const DESCENT_FROM = -0.01; // down this or steeper, at least the speed your effort holds there (no draft)
export const NOW_M = 200;          // the next this many meters: at least your speed now

/*
 * The speed you'll ride at each point ahead (adds v, m/s), for seconds-to. Steady by design, not today's bump: on
 * road up to CLIMB_FROM your flat speed (vFlat: your speed smoothed while the road was flat), steeper the speed your
 * effort (power: smoothed over a minute, at least MIN_WKG) holds there without draft (you climb in the wind more than
 * you ride the flat in it), never faster than vFlat. Urumaze 2026-10-06: with the speed of the moment, 1 km to the
 * same foot read 174, 103, 73 s within 6 s (you were on a ramp, then descending).
 * v0.40.0: descents (DESCENT_FROM) at least the speed your effort holds there, and the next NOW_M at least your speed
 * now: at the flat speed a descent ran twice too long (Climber's Gambit 2026-10-24: "steep in 35" at −7.7%, the
 * climb came in 19 s; vFlat had fallen to 23 km/h on that climbing course).
 * opts: {vFlat (m/s), power (W), massKg, cda, crr, bodyKg, vNow (m/s, optional)}
 */
export function withSpeeds(pts, {vFlat, power, massKg, cda, crr, bodyKg, vNow = null}) {
    if (!pts) return pts;
    const v0 = Math.max(1, vFlat || 0);
    const model = {massKg, cda, crr};
    const P = Math.max(Number.isFinite(power) ? power : 0, MIN_WKG * (bodyKg || massKg - 8));
    const g = smoothGrades(pts);
    return pts.map((p, i) => {
        if (g[i] > CLIMB_FROM) return {...p, v: Math.min(v0, speedAt(P, g[i], model))};
        let v = g[i] <= DESCENT_FROM ? Math.max(v0, speedAt(P, g[i], model)) : v0;
        if (Number.isFinite(vNow) && p.d <= NOW_M) v = Math.max(v, vNow);
        return {...p, v};
    });
}

/*
 * Seconds to ride dM along the road ahead (pts with v, from withSpeeds; d = m from you): the line, a banner. Past the
 * end of pts at the last point's speed; with no pts at vNow. null when dM isn't ahead.
 */
export function secsAlong(pts, dM, vNow) {
    if (!(dM > 0)) return null;
    let t = 0, prevD = 0, prevV = null;
    for (const p of pts || []) {
        const v = Math.max(1, p.v || vNow || 1);
        const vm = prevV == null ? v : (prevV + v) / 2;
        if (p.d >= dM) return t + (dM - prevD) / vm;
        t += (p.d - prevD) / vm;
        prevD = p.d;
        prevV = v;
    }
    return t + (dM - prevD) / Math.max(1, prevV ?? vNow ?? 1);
}

/* The grade at each point over ±40 m (the profile's nodes can be a few meters apart). */
function smoothGrades(p) {
    const out = [];
    let a = 0, b = 0;
    for (let i = 0; i < p.length; i++) {
        while (a < i && p[i].d - p[a].d > 40) a++;
        while (b + 1 < p.length && p[b + 1].d - p[i].d <= 40) b++;
        const lo = a === i && i > 0 ? i - 1 : a, hi = b === i && i + 1 < p.length ? i + 1 : b;
        const dd = p[hi].d - p[lo].d;
        out.push(dd > 5 ? (p[hi].alt - p[lo].alt) / dd : (out.length ? out.at(-1) : 0));
    }
    return out;
}

/* The route's road sections for RoadMap.ahead(): {sections: [{roadId, reverse, start, end, leadin}], laps}, or null. */
export function routeSections(r) {
    const list = (r && Array.isArray(r.sections) ? r.sections : []).filter(x => x && !x.weld && x.roadId != null &&
        Number.isFinite(x.start) && Number.isFinite(x.end))
        .map(x => ({roadId: x.roadId, reverse: !!x.reverse, start: x.start, end: x.end, leadin: !!x.leadin}));
    return list.length ? {sections: list, laps: !!r.supportedLaps} : null;
}

/*
 * Routes by id, loaded once each (load(routeId) -> Promise of a Sauce route object). ahead(state, maxM) -> the
 * profile ahead, or null while the route loads or when you're not on one.
 */
export class RouteAhead {
    constructor(load) {
        this.load = load;
        this.routes = new Map();   // routeId -> profile | null (loading or none)
        this.roads = new Map();    // routeId -> routeSections()
    }

    ensure(routeId) {
        if (routeId == null || this.routes.has(routeId) || !this.load) return;
        this.routes.set(routeId, null);
        Promise.resolve().then(() => this.load(routeId))
            .then(r => {
                this.roads.set(routeId, routeSections(r));
                this.routes.set(routeId, routeProfile(r));
            })
            .catch(e => console.warn('route', routeId, e));
    }

    ahead(s, maxM = 3000) {
        if (!s || s.routeId == null || !Number.isFinite(s.routeDistance)) return null;
        this.ensure(s.routeId);
        return profileAhead(this.routes.get(s.routeId), s, maxM);
    }

    /* Your route's roads in order (routeSections), or null off a route / while it loads. */
    sections(s) {
        if (!s || s.routeId == null) return null;
        this.ensure(s.routeId);
        return this.roads.get(s.routeId) || null;
    }
}
