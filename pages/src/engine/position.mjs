/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Position: what your spot costs against the best-placed rider in your group (moved out of tap.mjs, v0.55.0, so the
 * Director Sportif mod computes it the same way). Pure: the gap curve (gap-curve.mjs) is passed in.
 */

import {BOXED_M} from './gap-curve.mjs';
import {gapBetween} from './wheels.mjs';

export const POSITION_TAU_S = 10;   // smoothing while the group zero isn't there yet (the group zero is smoothed already)
export const COAST_W = 30;          // below this you are coasting: draft only adds speed, Position is blank
export const NO_DRAFT_NOTE = 'no draft from this wheel (hand cycle or recumbent?): find another';

/*
 * Your spot can't be improved by a gap: the wheel in line gives no draft and is the only rider within 20 m ahead,
 * or it's just you and such a rider (beside it, or in front: "sit in" behind it saves nothing either). The rider
 * is learned from everyone's draft behind it (riders-live.mjs DraftClassifier). Position is blank then (group ride
 * 2026-10-16: "too close: ease to 4.5–5.5 m, save ~54 W" for minutes behind a hand cycle, 0 W of draft at any gap).
 * ahead = wheels.mjs wheelsAhead entry for you; layout = gap-curve.mjs groupLayout; L = your layout entry.
 * {wheel: the wheel in line is such a rider, spot: Position has nothing to offer}
 */
export function noDraftSpot(draftClass, {ahead, L, layout, entries, me, maxGapM = Infinity}) {
    const inline = ahead && ahead.inline && ahead.inline.gap <= maxGapM ? ahead.inline : null;
    const wheel = !!(inline && ahead.counts && ahead.counts[ahead.counts.length - 1] <= 1 &&
        draftClass.givesNoDraft(inline.id));
    const mate = L && L.size === 2 && layout ?
        (entries || []).find(o => o && o !== me && layout.get(o.athleteId)?.gid === L.gid) : null;
    return {wheel, spot: wheel || !!(mate && draftClass.givesNoDraft(mate.athleteId))};
}

/*
 * Your spot vs the ideal spot. expected = the real saving where you sit: Zwift's reported draft minus the pack cost of
 * your spot (pack-cost.mjs packCostW, the same number Holding and the Pack cost meter use, so the three add up;
 * v0.56.0, was the gap curve's "too close" penalty). positionW = what the ideal spot at your speed saves on top
 * (GapCurve.best: the best gap, ~4–5.5 m on a wheel): absolute, 0 = nothing left to gain (the user, 2026-10-19: "we
 * just want the absolute number … getting the wasted watts down to near 0 is something I can hang my hat on"; until
 * then it was the best-placed rider in your group, which read 0 whenever you were that rider, even 25–30 W from ideal
 * in a group of 3–5: research/2026-10-19/position-abs.mjs). Your saving is the 10 s smoothed share when known.
 * modelW = the power keeping your place needs there: your solo need minus that saving, plus matching your group's
 * speed.
 * c = physics.mjs powerComponents for you now; L = gap-curve.mjs groupLayout entry; s = your state; v in m/s.
 */
export function spotCost(gapCurve, L, c, s, v, athleteId, packW = 0) {
    const aero = c.aero;
    const inGroup = L.size >= 2;
    const draftW = s.draft || 0;
    const best = gapCurve.best(aero, v);
    const boxed = L.gapBehind != null && L.gapBehind < BOXED_M;
    const expectedW = Math.max(0, draftW - (packW || 0));
    // Your saving: the 10 s smoothed share (groupShare's mine) once known, else now (smoothed by PositionSmoother)
    const g = inGroup ? gapCurve.groupShare(athleteId, L) : null;
    const positionW = !inGroup || s.activePowerUp ? 0 : Math.max(0, best.savingW - (g ? g.mine * aero : expectedW));
    const vg = inGroup && Number.isFinite(L.vGroup) ? L.vGroup : v;
    const slope = v > 1 ? (3 * Math.max(0, aero - expectedW) + c.roll) / v : 0;
    return {expectedW, best, boxed, positionW, smoothed: !!g, modelW: c.solo - expectedW + slope * (vg - v), groupW: slope * (vg - v)};
}

/* Smooths Position over POSITION_TAU_S of world time unless the value comes smoothed (the group zero). */
export class PositionSmoother {
    constructor() {
        this.reset();
    }

    reset() {
        this.wt = null;
        this.w = 0;
    }

    update(wt, x, smoothed) {
        if (smoothed || this.wt == null || !(wt > this.wt) || wt - this.wt > 10000) {
            this.wt = wt;
            this.w = x;
        } else {
            const dt = (wt - this.wt) / 1000;
            this.w += (1 - Math.exp(-dt / POSITION_TAU_S)) * (x - this.w);
            this.wt = wt;
        }
        return this.w;
    }
}

/* One line: the move that saves the most from where you sit (gaps centre to centre, as "Gap"). */
/*
 * The same advice as a state code (docs/DS-DATA.md): 'alone' | 'good' | 'sit-in' | 'boxed' | 'too-close' |
 * 'close-up' | 'find-wheel'. "Drift to the back" mid-bunch is 'too-close' too (both mean: get more room).
 */
export function positionState(w, best, L, boxed) {
    if (!L || L.size < 2) return 'alone';
    if (!(w >= 5)) return 'good';
    if (L.ahead === 0) return 'sit-in';
    if (L.gapAhead != null && L.gapAhead < best.lo) return boxed ? 'boxed' : 'too-close';
    if (L.gapAhead != null && L.gapAhead > best.hi) return 'close-up';
    return 'find-wheel';
}

export function positionAdvice(w, best, L, boxed, fmt = (x, d) => x.toFixed(d)) {
    if (L.size < 2) return 'no group';
    const range = `${fmt(best.lo, 1)}–${fmt(best.hi, 1)} m`;
    if (w < 5) return 'good spot';
    const save = `save ~${fmt(w, 0)} W`;
    if (L.ahead === 0) return `front of the group: sit in at ${range}, ${save}`;
    // Mid-bunch there is nearly always someone 1–2 m ahead (protocol H: median 0.9–1.8 m in every step), so the
    // room to sit off a wheel is at the back.
    const behind = L.size - 1 - L.ahead;
    if (L.gapAhead != null && L.gapAhead < best.lo && boxed) return `boxed in: drift to the back with room, ${save}`;
    if (L.gapAhead != null && L.gapAhead < best.lo && behind > 2) return `drift to the back, sit ${range} off: ${save}`;
    if (L.gapAhead != null && L.gapAhead < best.lo) return `too close: ease to ${range} off the wheel, ${save}`;
    if (L.gapAhead != null && L.gapAhead > best.hi) return `close up to ${range}, ${save}`;
    return `get on a wheel (${range}), ${save}`;
}

/*
 * About to be gapped (the user, 2026-10-19: "at the back in good position, the wheel in front of me starts drifting
 * off the back, or the wheel in front of him. I am still getting back off messages"; group rides, races, pacer bots,
 * often a rider falling back through the pack). You sit within GAP_OPENING.wheelM of your wheel while the hole in
 * front of your wheel, or of the next wheel, is GAP_OPENING.holeM+ and has grown GAP_OPENING.rateMs+ over the last
 * GAP_OPENING.lookS. 12 recordings (research: the scan in docs/FINDINGS.md, 2026-10-19): 82 such moments, and in 64
 * (78%) you were 8+ m further behind (or out of sight of) that rider 15 s later; a 4 m / 0.4 m/s hole was right 54%.
 * It stays on GAP_OPENING.holdS after the last sight, so it doesn't flicker. Only while you ride (minKmh+): standing
 * at the roadside, riders passing you looked like a group pulling away (DS rehearsal 2026-10-19: 4 calls at 0 km/h).
 * Requiring your wheel at your speed too (±5 km/h, or not 5+ faster) dropped ~20 real gaps of 64: a wheel pulling
 * away from you is mostly you being gapped (a surge), so it stays in. Returns
 * {holeM, rateMs, which: 'wheel' | 'next', beyond (riders ahead of the hole)} or null.
 */
export const GAP_OPENING = {wheelM: 4, holeM: 6, rateMs: 1.0, lookS: 4, chainM: 25, holdS: 6, minKmh: 5};

export class GapWatch {
    constructor() {
        this.hist = [];      // [{t, gaps: Map(id -> m ahead of you)}]
        this.last = null;    // the last detection, {t, ...}
    }

    reset() {
        this.hist = [];
        this.last = null;
    }

    /* entries = Sauce's nearby list; now = ms (wall or world time, rising). */
    update(entries, me, now) {
        const s = me && me.state;
        if (!s) return null;
        const ahead = [];
        for (const o of entries || []) {
            const t = o.state;
            if (o === me || !t || t.roadId !== s.roadId || !!t.reverse !== !!s.reverse) continue;
            if (s.eventSubgroupId && t.eventSubgroupId !== s.eventSubgroupId) continue;
            const g = gapBetween(me, o).gap;
            if (Number.isFinite(g) && g > 0.3 && g < 150) ahead.push({id: o.athleteId, g});
        }
        ahead.sort((a, b) => a.g - b.g);
        this.hist.push({t: now, gaps: new Map(ahead.map(a => [a.id, a.g]))});
        while (this.hist.length && this.hist[0].t < now - (GAP_OPENING.lookS + 2) * 1000) this.hist.shift();
        // your group ahead: chained from you
        const chain = [];
        let prev = 0;
        for (const a of ahead) {
            if (a.g - prev > GAP_OPENING.chainM) break;
            chain.push(a);
            prev = a.g;
        }
        let found = null;
        const old = this.hist.find(h => h.t >= now - GAP_OPENING.lookS * 1000);
        if ((s.speed || 0) >= GAP_OPENING.minKmh && chain.length >= 2 && chain[0].g <= GAP_OPENING.wheelM && old && now - old.t >= 2000) {
            for (let i = 0; i < Math.min(chain.length - 1, 2) && !found; i++) {
                const hole = chain[i + 1].g - chain[i].g;
                const a = old.gaps.get(chain[i].id), b = old.gaps.get(chain[i + 1].id);
                if (hole < GAP_OPENING.holeM || a == null || b == null) continue;
                const rate = (hole - (b - a)) / ((now - old.t) / 1000);
                if (rate >= GAP_OPENING.rateMs) {
                    found = {holeM: hole, rateMs: rate, which: i === 0 ? 'wheel' : 'next', beyond: chain.length - i - 1};
                }
            }
        }
        if (found) this.last = {t: now, ...found};
        // on until holdS after the last sight, unless you've left your wheel (closed up past it, or gone)
        if (this.last && (now - this.last.t > GAP_OPENING.holdS * 1000 || !chain.length || chain[0].g > GAP_OPENING.wheelM * 2)) {
            this.last = null;
        }
        if (!this.last) return null;
        const {t, ...out} = this.last;
        return out;
    }
}

/*
 * The pack's demand (the user, 2026-10-19: "what is the power output needed to hold this pack (30 sec average?)" …
 * "isn't it the calculated power of the ideal spot?"): the power the ideal spot needs to stay with your group, your
 * solo need (air, rolling, climbing: physics.mjs powerComponents.solo) minus what the ideal spot saves
 * (GapCurve.best) plus matching your group's speed (spotCost groupW). So your power = the demand + Position (what your
 * spot costs on top) + Holding (what you spent beyond your spot's need). Averaged over DEMAND_S; shown once DEMAND_MIN_S
 * of it is there. Reports only: no colors, no calls (wasting watts is wasting watts; how hard the race is is yours).
 * Speeding up / slowing down counts over the window, as the change in ½mv² / time (2026-10-21, user: "wacky at ~13:48"):
 * per tick it asked what HOLDING the speed costs, so a bunch coasting 78 -> 44 km/h after a descent read 490 W while
 * they rode 100. Per-tick values are signed (a descent gives energy back); only the window's mean stops at 0.
 */
export const DEMAND_S = 30;
export const DEMAND_MIN_S = 10;
// the demand now without speeding up (DemandMeter adds that over its window); signed
export const packDemandW = (c, spot) => c.solo - (c.kinetic || 0) - spot.best.savingW + (spot.groupW || 0);

export class DemandMeter {
    constructor({windowS = DEMAND_S, minS = DEMAND_MIN_S} = {}) {
        this.windowMs = windowS * 1000;
        this.minMs = minS * 1000;
        this.pts = [];
    }

    reset() {
        this.pts = [];
    }

    /*
     * wt: world time ms; w: packDemandW now (null: not in a group, or settling: starts over); v (m/s) and massKg for the
     * change in speed (left out: none counted). The window's demand (≥ 0), or null.
     */
    update(wt, w, {v = null, massKg = null} = {}) {
        if (!Number.isFinite(w)) {
            this.reset();
            return null;
        }
        if (this.pts.length && wt <= this.pts.at(-1).wt) return this.value();
        this.pts.push({wt, w, v, massKg});
        while (this.pts.length && this.pts[0].wt < wt - this.windowMs) this.pts.shift();
        return this.value();
    }

    value() {
        if (this.pts.length < 2) return null;
        const a = this.pts[0], b = this.pts.at(-1), dT = (b.wt - a.wt) / 1000;
        if (dT * 1000 < this.minMs) return null;
        const mean = this.pts.reduce((s, x) => s + x.w, 0) / this.pts.length;
        const speedUp = Number.isFinite(a.v) && Number.isFinite(b.v) && b.massKg > 0 ? 0.5 * b.massKg * (b.v ** 2 - a.v ** 2) / dT : 0;
        return Math.max(0, mean + speedUp);
    }
}
