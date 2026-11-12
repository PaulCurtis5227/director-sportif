/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Road surfaces from Zwift's map, as Sauce knows it (getCourseRoads: each road's "styles", sections such as
 * COUNTRYDIRT / WOODEN / INNSBRUCKCOBBLE with their start and end along the road). The map says WHERE the surface
 * changes; Zwift Insider's Crr table (surfaces.mjs SURFACES, zwiftinsider.com/crr/) says HOW MUCH, per tyre type.
 *
 * Checked against the measured road-surface map (2026-10-01, four recordings): positions are exact (Watopia road
 * 149's bridges at 28.29–28.93% and 32.92–33.56%, Innsbruck road 7's cobbles at 94.21–96.47%); WOODEN measured
 * Crr ≈ 0.0066 (ZI wood 0.0065); INNSBRUCKCOBBLE ≈ 0.0057, i.e. brick (ZI 0.0055; the user: "on the screen it is
 * more of a patterned brick"); WET / LAVA / DESERT read as pavement. Names not recognized count as pavement.
 * The user's own solo windows (known tyres and CdA, 3 recordings): pavement 0.0042, dirt 0.0155 (ZI 0.016),
 * Watopia COBBLE 0.0055 -> every COBBLE style counts as brick (ZI's cobbles 0.0065 isn't what these roads do).
 * Surfaces ADD to your equipment's pavement Crr: crr = equipment + (ZI surface − ZI pavement) for your tyres.
 *
 * Position: Sauce's state.roadCompletion is progress in the direction of travel (roadTime − 5000 forward,
 * 1 005 000 − roadTime in reverse), so the road percent is roadTime-based: (roadTime − 5000) / 1e6.
 */

import {SURFACES} from './surfaces.mjs';

/* Extra Crr of a surface over pavement for a tyre type (Zwift Insider's table). */
export function surfaceExtraCrr(surface, tyre = 'road') {
    const pave = SURFACES.find(x => x.id === 'pavement').crr[tyre] ?? 0.004;
    const here = SURFACES.find(x => x.id === surface);
    return here && here.crr[tyre] != null ? here.crr[tyre] - pave : 0;
}

/* Map surface name -> SURFACES id (pavement, wood, brick, cobbles, dirt, gravel, grass, sand, snow). */
export function styleCategory(style) {
    const s = String(style || '').toUpperCase();
    if (/WOOD/.test(s)) {
        return 'wood';
    }
    if (/COBBLE/.test(s) || /BRICK/.test(s)) {
        return 'brick';
    }
    if (/GRAVEL/.test(s)) {
        return 'gravel';
    }
    if (/DIRT/.test(s)) {
        return 'dirt';
    }
    if (/GRASS/.test(s)) {
        return 'grass';
    }
    if (/SNOW|ICE/.test(s)) {
        return 'snow';
    }
    if (/SAND|BEACH/.test(s)) {
        return 'sand';
    }
    return 'pavement';
}

/* Road percent (0..1 along the road's own direction) of a Sauce state. */
export function roadPercent(s) {
    if (Number.isFinite(s.roadTime)) {
        return (s.roadTime - 5000) / 1e6;
    }
    if (Number.isFinite(s.roadCompletion)) {
        return s.reverse ? (1005000 - s.roadCompletion - 5000) / 1e6 : s.roadCompletion / 1e6;
    }
    return null;
}

/*
 * Roads Sauce's map has wrong (its bundled zwift-utils data can lag a Zwift rework): courseId -> roadId -> the
 * surface style to use for the whole road. Drop one once Sauce's data agrees.
 *   Watopia road 135 = Repack Rush, the only route on it: GRASS end to end in the map (the old Repack Ridge MTB
 *   singletrack); paved since the rework (the user rode it, 2026-11-07; Zwift Insider's route page: "paved").
 */
export const ROAD_STYLE_FIXES = Object.freeze({6: Object.freeze({135: 'NORMAL'})});

/* A road from Sauce with any fix above applied (a copy; the original is left alone). */
export function fixRoad(courseId, road) {
    const style = ROAD_STYLE_FIXES[courseId]?.[road?.id];
    return style ? {...road, defaultStyle: style, styles: []} : road;
}

/* The style at road percent p: later sections override earlier ones (e.g. CITY −1..2 with cobbles on top). */
export function styleAt(road, p) {
    let style = null;
    for (const x of road.styles || []) {
        if (p >= x.start && p < x.end) {
            style = x.style;
        }
    }
    return style || road.defaultStyle || 'NORMAL';
}

const CURVE_STEPS = 16;   // points measured along each stretch of road between two of its knots

/*
 * Cumulative length (m) along the road as Zwift lays it: a Catmull-Rom curve through its points (Sauce shared/curves.mjs
 * catmullRomPath: Bezier control points p0 + (p1 − p_1) / 6, a looped road wrapped), with percent running evenly in the
 * curve's parameter, not in distance. Straight lines between the points read up to 77 m wrong where the points are far
 * apart and unevenly spaced (SPRINT Reverse, against the odometer, 2026-11-02). cum[i × CURVE_STEPS] = at point i.
 */
function prepare(road) {
    let pts = road.path || [];
    if (road.looped && pts.length > 2) {
        pts = [pts[pts.length - 1], ...pts, pts[0], pts[1]];
    }
    const at = (k, i) => pts[i][k] || 0;
    const cum = [0];
    const zs = [pts.length ? at(2, 0) : 0];   // the road's height (world z, cm) at each measured point: zAtMeters
    const xys = [pts.length ? [at(0, 0), at(1, 0)] : [0, 0]];   // and where it is (world x, y): junctionRise
    for (let i = 0; i + 1 < pts.length; i++) {
        const c = k => {
            const p0 = at(k, i), p1 = at(k, i + 1);
            return [p0, i > 0 ? (-at(k, i - 1) + 6 * p0 + p1) / 6 : p0, i + 2 < pts.length ? (p0 + 6 * p1 - at(k, i + 2)) / 6 : p1, p1];
        };
        const cx = c(0), cy = c(1), cz = c(2);
        const point = t => [cx, cy, cz].map(([a, b, d, e]) => {
            const u = 1 - t;
            return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * e;
        });
        let last = point(0);
        for (let s = 1; s <= CURVE_STEPS; s++) {
            const next = point(s / CURVE_STEPS);
            cum.push(cum[cum.length - 1] + Math.hypot(next[0] - last[0], next[1] - last[1], next[2] - last[2]) / 100);
            zs.push(next[2]);
            xys.push([next[0], next[1]]);
            last = next;
        }
    }
    road._cum = cum;
    road._zs = zs;
    road._xys = xys;
    road._knots = pts.length;
    return road;
}

/* Meters from the road's start to road percent p (Sauce: point index = p × (n − 3) + 1). */
export function metersAt(road, p) {
    const cum = road._cum || prepare(road)._cum;
    const n = road._knots;
    if (n < 4) {
        return 0;
    }
    const i = Math.max(0, Math.min(cum.length - 1, (p * (n - 3) + 1) * CURVE_STEPS));
    const k = Math.min(cum.length - 2, Math.floor(i));
    return cum[k] + (cum[k + 1] - cum[k]) * (i - k);
}

export class RoadMap {
    /* fetchRoads(courseId) -> Promise<roads[]> (Common.rpc.getCourseRoads). */
    constructor(fetchRoads) {
        this.fetchRoads = fetchRoads;
        this.courses = new Map();   // courseId -> Map(roadId -> road) | 'loading' | 'failed'
    }

    /* Load a course once (returns immediately; lookups answer null until it's there). */
    ensure(courseId) {
        if (!Number.isFinite(courseId) || this.courses.has(courseId) || !this.fetchRoads) {
            return;
        }
        this.courses.set(courseId, 'loading');
        Promise.resolve(this.fetchRoads(courseId)).then(roads => {
            this.courses.set(courseId, new Map((roads || []).map(r => [r.id, prepare(fixRoad(courseId, r))])));
        }).catch(e => {
            console.warn('road map unavailable for course', courseId, e);
            this.courses.set(courseId, 'failed');
        });
    }

    setRoads(courseId, roads) {
        this.courses.set(courseId, new Map((roads || []).map(r => [r.id, prepare(fixRoad(courseId, r))])));
    }

    /* The course's measured road points by 20 m square (world cm / 2000): {key -> [{road, i}]}, built once. */
    grid(courseId) {
        const c = this.courses.get(courseId);
        if (!(c instanceof Map)) return null;
        this._grids ??= new Map();
        if (!this._grids.has(courseId)) {
            const g = new Map();
            for (const r of c.values()) {
                if (!r._cum) continue;
                const lo = metersAt(r, 0) - 1, hi = metersAt(r, 1) + 1;
                for (let i = 0; i < r._cum.length; i++) {
                    if (r._cum[i] < lo || r._cum[i] > hi) continue;   // the padding knots before p 0 / after p 1
                    const k = `${Math.floor(r._xys[i][0] / 2000)},${Math.floor(r._xys[i][1] / 2000)}`;
                    if (!g.has(k)) g.set(k, []);
                    g.get(k).push({road: r, i});
                }
            }
            this._grids.set(courseId, g);
        }
        return this._grids.get(courseId);
    }

    /* Other roads' nearest points within JUNCTION_M (3D) of a world point: [{road, m}], one per road. */
    near(courseId, xy, z, not = null) {
        const g = this.grid(courseId);
        if (!g) return [];
        const best = new Map();
        const cx = Math.floor(xy[0] / 2000), cy = Math.floor(xy[1] / 2000);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            for (const {road, i} of g.get(`${cx + dx},${cy + dy}`) || []) {
                if (road === not) continue;
                const d = Math.hypot(road._xys[i][0] - xy[0], road._xys[i][1] - xy[1], road._zs[i] - z) / 100;
                if (d <= JUNCTION_M && !(best.get(road)?.d <= d)) best.set(road, {road, m: road._cum[i], d});
            }
        }
        return [...best.values()];
    }

    /*
     * Where other roads meet this one (meters along it, sorted; a run of touching points counts once, at its first),
     * cached per road. Off a route a junction ahead is a way you may or may not take (2026-11-04: road 23 left
     * mid-way onto road 31, the map's profile followed road 23 on to its end).
     */
    junctionsAlong(courseId, road) {
        this._along ??= new Map();
        const key = `${courseId}:${road.id}`;
        if (!this._along.has(key)) {
            const out = [];
            const lo = metersAt(road, 0), hi = metersAt(road, 1);
            let inside = false;
            for (let i = 0; i < road._cum.length; i++) {
                const m = road._cum[i];
                if (m < lo || m > hi) continue;
                const hit = this.near(courseId, road._xys[i], road._zs[i], road).length > 0;
                if (hit && !inside) out.push(m);
                inside = hit;
            }
            this._along.set(key, out);
        }
        return this._along.get(key);
    }

    /*
     * The most any road leaving the far end of `road` (ridden forward = its p 1 end, else its p 0 end) climbs over its
     * first JUNCTION_LOOK_M, in meters of altitude (either way along a road met mid-way), or null when nothing meets it
     * there. Cached per road end.
     */
    junctionRise(courseId, road, forward, zToAlt) {
        const c = this.courses.get(courseId);
        if (!(c instanceof Map) || !road._cum) return null;
        this._junctions ??= new Map();
        const key = `${courseId}:${road.id}:${forward ? 1 : 0}`;
        if (!this._junctions.has(key)) {
            const endM = metersAt(road, forward ? 1 : 0);
            const ways = [];   // [{road, fromM, dir}]
            for (const {road: r, m} of this.near(courseId, xyAtMeters(road, endM), zAtMeters(road, endM), road)) {
                const lo = metersAt(r, 0), hi = metersAt(r, 1);
                if (m < hi - 1) ways.push({road: r, fromM: m, dir: 1});
                if (m > lo + 1) ways.push({road: r, fromM: m, dir: -1});
            }
            this._junctions.set(key, ways);
        }
        const ways = this._junctions.get(key);
        if (!ways.length) return null;
        let most = -Infinity;
        for (const w of ways) {
            const lo = metersAt(w.road, 0), hi = metersAt(w.road, 1);
            const to = Math.max(lo, Math.min(hi, w.fromM + w.dir * JUNCTION_LOOK_M));
            let top = zToAlt(zAtMeters(w.road, w.fromM));
            const a0 = top;
            for (let m = w.fromM; w.dir > 0 ? m <= to : m >= to; m += w.dir * 10) top = Math.max(top, zToAlt(zAtMeters(w.road, m)));
            most = Math.max(most, top - a0);
        }
        return most;
    }

    road(courseId, roadId) {
        const c = this.courses.get(courseId);
        return c instanceof Map ? c.get(roadId) || null : null;
    }

    /* {style, surface} under a rider, or null when the map isn't loaded / the road isn't in it. */
    at(s) {
        const road = this.road(s.courseId, s.roadId);
        const p = roadPercent(s);
        if (!road || p == null) {
            return null;
        }
        const style = styleAt(road, p);
        return {style, surface: styleCategory(style)};
    }

    /*
     * The next non-pavement stretch ahead in the direction of travel, within maxM: {surface, style, inM, lengthM,
     * open}, or null. Off a route the walk ends with this road (where it ends is a junction: the next road isn't
     * known); with the route's road sections (route = {sections: [{roadId, reverse, start, end}] in riding order, road
     * percents, as Sauce's getRoute / the route manifest; laps: true to go round again) it follows the route onto the
     * next roads (v0.68.8; 2026-10-26: "dirt in 1 for 15" where a 285 m road's dirt ran on 1.1 km into the next road).
     * open = the stretch goes on past where the walk ended: lengthM is only its least length.
     */
    /*
     * skip: the surface you're on (brick, dirt…): passed over until it ends, then the next one is reported (v0.72.5, DS
     * 0.66.1; the user's double mark, 2026-11-11 30:18, "missed the transition at that junction to dirt": brick, then
     * Watopia road 25's cobbles and dirt, onto road 21's dirt, and no "dirt in N": the DS only looked ahead from pavement).
     */
    ahead(s, maxM = 600, route = null, {skip = null} = {}) {
        const road = this.road(s.courseId, s.roadId);
        const p = roadPercent(s);
        if (!road || p == null) {
            return null;
        }
        const legs = this.legs(s, road, p, route);
        // Walk forward in steps; later sections override earlier ones, as in styleAt().
        const stepM = 10;
        const limitM = maxM + 2000;
        let run = null;
        let base = 0;
        for (const leg of legs) {
            const span = Math.abs(leg.toM - leg.fromM);
            const dir = leg.toM >= leg.fromM ? 1 : -1;
            for (let x = stepM; x <= span; x += stepM) {
                const d = base + x;
                if (d > limitM) {
                    if (run) {
                        run.open = true;
                    }
                    return run;
                }
                const style = styleAt(leg.road, percentAtMeters(leg.road, leg.fromM + dir * x));
                const surface = styleCategory(style);
                if (skip) {   // still on the surface you're on: not news
                    if (surface === skip) continue;
                    skip = null;
                }
                if (!run) {
                    if (surface !== 'pavement' && surface !== 'sand') {
                        if (d > maxM) {
                            return null;
                        }
                        run = {surface, style, inM: d - stepM / 2, lengthM: stepM, open: false};
                    }
                } else if (surface === run.surface) {
                    run.lengthM += stepM;
                } else {
                    return run;
                }
            }
            base += span;
        }
        if (run) {
            run.open = true;   // the road (or the route) ran out first
        }
        return run;
    }

    /*
     * The stretches of road ahead: [{road, fromM, toM}] (toM < fromM: ridden in reverse). This road to its end, or
     * along the route: to the end of your section, then each next section (round the lap again with laps).
     */
    legs(s, road, p, route) {
        const here = metersAt(road, p);
        const toEnd = {road, fromM: here, toM: s.reverse ? 0 : metersAt(road, 1)};
        const list = route && Array.isArray(route.sections) ? route.sections : null;
        if (!list || !list.length) {
            return [toEnd];
        }
        const eps = 0.002;
        const i = list.findIndex(x => x.roadId === s.roadId && !!x.reverse === !!s.reverse &&
                                      p >= Math.min(x.start, x.end) - eps && p <= Math.max(x.start, x.end) + eps);
        if (i < 0) {
            return [toEnd];   // not where the route says: this road only
        }
        const sec = list[i];
        const legs = [{road, fromM: here, toM: metersAt(road, s.reverse ? Math.min(sec.start, sec.end) : Math.max(sec.start, sec.end))}];
        const lapStart = Math.max(0, list.findIndex(x => !x.leadin));
        let k = i + 1;
        for (let n = 0; n < list.length; n++, k++) {
            if (k >= list.length) {
                if (!route.laps) {
                    break;
                }
                k = lapStart;
            }
            const x = list[k];
            const r = this.road(s.courseId, x.roadId);
            if (!r) {
                break;
            }
            const lo = metersAt(r, Math.min(x.start, x.end));
            const hi = metersAt(r, Math.max(x.start, x.end));
            legs.push({road: r, fromM: x.reverse ? hi : lo, toM: x.reverse ? lo : hi});
        }
        return legs;
    }
}

/* Meters left of the surface you're on, along this road in the direction of travel (null if unknown). */
export function remainingOnSurface(roadMap, s, maxM = 5000) {
    const road = roadMap.road(s.courseId, s.roadId);
    const p = roadPercent(s);
    if (!road || p == null) {
        return null;
    }
    const surface = styleCategory(styleAt(road, p));
    const here = metersAt(road, p);
    const totalM = metersAt(road, 1);
    const dir = s.reverse ? -1 : 1;
    let d = 0;
    for (; d < maxM; d += 10) {
        const m = here + dir * d;
        if (m < 0 || m > totalM) {
            return {surface, leftM: d, endsWithRoad: true};
        }
        if (styleCategory(styleAt(road, percentAtMeters(road, m))) !== surface) {
            break;
        }
    }
    return {surface, leftM: d, endsWithRoad: false};
}

/* A road's measured value (z, or [x, y]) m meters from its start, along the same curve as metersAt. */
function alongRoad(road, m, key) {
    const cum = road._cum || prepare(road)._cum;
    const vals = road[key];
    const mix = (a, b, f) => (Array.isArray(a) ? a.map((v, i) => v + f * (b[i] - v)) : a + f * (b - a));
    if (cum.length < 2 || m <= 0) return vals[0];
    let lo = 0, hi = cum.length - 1;
    if (m >= cum[hi]) return vals[hi];
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= m) lo = mid;
        else hi = mid;
    }
    return mix(vals[lo], vals[hi], cum[hi] > cum[lo] ? (m - cum[lo]) / (cum[hi] - cum[lo]) : 0);
}

/* The road's height (world z, cm) m meters from its start. */
export const zAtMeters = (road, m) => alongRoad(road, m, '_zs');
/* Where the road is (world [x, y]) m meters from its start. */
export const xyAtMeters = (road, m) => alongRoad(road, m, '_xys');

/*
 * The road's own profile ahead, from Zwift's map (2026-11-04, Tour of Watopia stage 5: Sauce had no route for the
 * event, the road learned from the riders ahead stopped where the leaders were, ~650 m up a 6.8 km climb, and the
 * feather fired three times on 4% under the 9.9% near the top). [{d (m from you), alt (m)}] every stepM out to maxM,
 * along this road to its end or, with the route's sections, onto the next roads (RoadMap.legs). zToAlt: world z (cm)
 * -> altitude (m); grades only need its scale (Sauce: (z − seaLevel) / 100 × physicsSlopeScale; Watopia 0.5).
 * open: the walk ended before maxM with the road past its last point unknown, so the end is not a top.
 *
 * Off a route the way at each junction is the riders' (traffic = RoadTraffic.on(courseId): count = riders seen at a
 * road percent riding it that way, moved = riders who went from one road straight onto another). At a junction ahead
 * the walk takes the way most of them went (on along this road, or onto another road from it); when nobody ahead has
 * been through, it stops there (open). Where a road ends and nobody has been through, a junction whose roads all stay
 * flat or go down is the top (JUNCTION_FLAT_M), else open.
 */
export function profileAheadOnMap(roadMap, s, maxM, zToAlt, {route = null, stepM = 10, traffic = null} = {}) {
    const road = roadMap.road(s.courseId, s.roadId);
    const p = roadPercent(s);
    if (!road || p == null || typeof zToAlt !== 'function') return null;
    const pts = [];
    const offRoute = !route || !Array.isArray(route.sections) || !route.sections.length;
    // riders seen around meters m (± 10 m: a rider ticks every 10–15 m, the bins are ~4 m)
    const seen = (r, rev, m) => (traffic ? Math.max(...[-10, -5, 0, 5, 10].map(o => traffic.count(r.id, rev, percentAtMeters(r, m + o)))) : 0);
    // how many rode on along road r from meters m that way: the fewer seen JUNCTION_PAST_M and twice that along it
    const went = (r, m, dir) => Math.min(...[JUNCTION_PAST_M, 2 * JUNCTION_PAST_M].map(a => {
        const at = m + dir * a;
        return at >= metersAt(r, 0) && at <= metersAt(r, 1) ? seen(r, dir < 0, at) : 0;
    }));
    // the road most riders on road `from` (that way) moved onto at a junction (world point): {road, fromM, toM, n}
    const branch = (xy, z, from, fromRev) => {
        let best = null;
        for (const {road: r, m} of roadMap.near(s.courseId, xy, z, from)) {
            for (const dir of [1, -1]) {
                const n = traffic ? traffic.moved(from.id, fromRev, r.id, dir < 0) : 0;
                if (n > 0 && (!best || n > best.n)) best = {road: r, fromM: m, toM: dir > 0 ? metersAt(r, 1) : metersAt(r, 0), n};
            }
        }
        return best;
    };
    let legs = roadMap.legs(s, road, p, route);
    let base = 0, last = null;
    for (let hop = 0; hop < 12 && legs.length; hop++) {
        const leg = legs.shift();
        const dir = leg.toM >= leg.fromM ? 1 : -1;
        let span = Math.abs(leg.toM - leg.fromM);
        let next = null, blind = false;
        if (offRoute) {
            for (const x of roadMap.junctionsAlong(s.courseId, leg.road).map(m => (m - leg.fromM) * dir)
                .filter(x => x > JUNCTION_SKIP_M && x < span - 1).sort((a, b) => a - b)) {
                const m = leg.fromM + dir * x;
                const on = went(leg.road, m, dir);
                const off = branch(xyAtMeters(leg.road, m), zAtMeters(leg.road, m), leg.road, dir < 0);
                if (on > 0 && on >= (off ? off.n : 0)) continue;   // most rode on along this road
                next = off;
                span = x;
                blind = !next;
                break;
            }
        }
        for (let x = 0; x <= span; x += stepM) {
            const d = base + x;
            if (d > maxM) return {pts, open: false};
            if (!pts.length || d > pts.at(-1).d) pts.push({d, alt: zToAlt(zAtMeters(leg.road, leg.fromM + dir * x))});
        }
        base += span;
        last = {...leg, toM: leg.fromM + dir * span};
        if (blind) return {pts, open: true, fork: true};
        if (next) {
            legs = [next];
            continue;
        }
        if (!legs.length && offRoute) {
            // the road's end: where the riders went from it, else a top if nothing leaving it climbs
            const endM = last.toM;
            const on = branch(xyAtMeters(leg.road, endM), zAtMeters(leg.road, endM), leg.road, dir < 0);
            if (on) legs = [on];
        }
    }
    const rise = last ? roadMap.junctionRise(s.courseId, last.road, last.toM >= last.fromM, zToAlt) : null;
    return {pts, open: rise == null || rise > JUNCTION_FLAT_M};
}

/*
 * Where the riders have been (for profileAheadOnMap's way at a junction): ticks seen per road × direction × 0.25% of
 * road (Sauce's roadCompletion, which runs the way each rider rides). In an event only your subgroup counts (where
 * your race goes), else everyone. update(entries, me) each tick; count(courseId, roadId, reverse, p) with p the
 * road's own percent (0..1, as roadPercent).
 */
export const TRAFFIC_BIN = 2500;
export class RoadTraffic {
    constructor() {
        this.seen = new Map();
        this.moves = new Map();   // 'course:A:revA>B:revB' -> riders who went from road A onto road B
        this.last = new Map();    // athleteId -> 'roadId:rev'
    }

    update(entries, me) {
        const sg = me?.state?.eventSubgroupId || null;
        for (const e of entries || []) {
            const s = e && e.state;
            if (!s || e === me || !Number.isFinite(s.roadCompletion) || !(s.speed > 2)) continue;
            if (sg && s.eventSubgroupId !== sg) continue;
            const c = s.courseId ?? me?.state?.courseId;
            const here = `${s.roadId}:${s.reverse ? 1 : 0}`;
            const k = `${c}:${here}:${Math.floor(s.roadCompletion / TRAFFIC_BIN)}`;
            const id = e.athleteId ?? s.athleteId;
            if (!this.seen.has(k)) this.seen.set(k, new Set());
            this.seen.get(k).add(id);
            const before = this.last.get(id);
            if (before && before !== here) {
                const m = `${c}:${before}>${here}`;
                this.moves.set(m, (this.moves.get(m) || 0) + 1);
            }
            this.last.set(id, here);
        }
    }

    /* Riders seen at road percent p riding it that way. */
    count(courseId, roadId, reverse, p) {
        const rc = reverse ? 1e6 - p * 1e6 : p * 1e6;
        return this.seen.get(`${courseId}:${roadId}:${reverse ? 1 : 0}:${Math.floor(rc / TRAFFIC_BIN)}`)?.size || 0;
    }

    /* For profileAheadOnMap on one course. */
    on(courseId) {
        return {count: (r, rev, p) => this.count(courseId, r, rev, p), moved: (a, ar, b, br) => this.moved(courseId, a, ar, b, br)};
    }

    /* Riders who went from road a (that way) straight onto road b (that way). */
    moved(courseId, a, aRev, b, bRev) {
        return this.moves.get(`${courseId}:${a}:${aRev ? 1 : 0}>${b}:${bRev ? 1 : 0}`) || 0;
    }
}

export const JUNCTION_M = 15;        // a road within this (3D, m) of a road's end leaves from that junction
export const JUNCTION_SKIP_M = 20;   // the junction you're in (or just past) isn't one ahead
export const JUNCTION_PAST_M = 40;   // riders seen this far and twice this far past a junction: the road goes on there
export const JUNCTION_LOOK_M = 300;  // how far along it to look
export const JUNCTION_FLAT_M = 2;    // rising no more than this over JUNCTION_LOOK_M: not a climb going on

/* Inverse of metersAt (bisection; roads are a few thousand points at most). */
export function percentAtMeters(road, m) {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        if (metersAt(road, mid) < m) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return (lo + hi) / 2;
}
