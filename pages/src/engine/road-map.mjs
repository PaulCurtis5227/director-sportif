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

/* Cumulative length (m) along the road's points, and Sauce's percent -> point index mapping. */
function prepare(road) {
    const pts = road.path || [];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0)) / 100);
    }
    road._cum = cum;
    return road;
}

/* Meters from the road's start to road percent p (Sauce: point index = p × (n − 3) + 1). */
export function metersAt(road, p) {
    const cum = road._cum || prepare(road)._cum;
    const n = cum.length;
    if (n < 4) {
        return 0;
    }
    const i = Math.max(0, Math.min(n - 1, p * (n - 3) + 1));
    const k = Math.min(n - 2, Math.floor(i));
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
            this.courses.set(courseId, new Map((roads || []).map(r => [r.id, prepare(r)])));
        }).catch(e => {
            console.warn('road map unavailable for course', courseId, e);
            this.courses.set(courseId, 'failed');
        });
    }

    setRoads(courseId, roads) {
        this.courses.set(courseId, new Map((roads || []).map(r => [r.id, prepare(r)])));
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
     * The next non-pavement stretch ahead on this road in the direction of travel, within maxM:
     * {surface, style, inM, lengthM}, or null. (Only the current road: where it ends is a junction.)
     */
    ahead(s, maxM = 600) {
        const road = this.road(s.courseId, s.roadId);
        const p = roadPercent(s);
        if (!road || p == null) {
            return null;
        }
        const here = metersAt(road, p);
        const dir = s.reverse ? -1 : 1;
        // Walk forward in steps; later sections override earlier ones, as in styleAt().
        const stepM = 10;
        const totalM = metersAt(road, 1);
        let run = null;
        for (let d = stepM; d <= maxM + 2000; d += stepM) {
            const m = here + dir * d;
            if (m < 0 || m > totalM) {
                break;
            }
            const q = percentAtMeters(road, m);
            const style = styleAt(road, q);
            const surface = styleCategory(style);
            if (!run) {
                if (surface !== 'pavement' && surface !== 'sand') {
                    if (d > maxM) {
                        return null;
                    }
                    run = {surface, style, inM: d - stepM / 2, lengthM: stepM};
                }
            } else if (surface === run.surface) {
                run.lengthM += stepM;
            } else {
                break;
            }
        }
        return run;
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
