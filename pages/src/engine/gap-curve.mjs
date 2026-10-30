/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Real draft saving by gap to the bike ahead: Zwift's reported draft (as a share of your air drag) minus a "too
 * close" penalty in watts, from a crude step curve. Its own module, not a copy of the Efficiency Meter's
 * (scripts/sync-ds-engine.mjs DS_OWN): no learning; checked against the full model over seven rides (Efficiency
 * Meter docs/PLAN.md §14).
 *
 * Position's zero is not this curve's best spot but what the best-placed rider in your group really saves
 * (groupShare): reported draft − pack cost (pack-cost.mjs), the same price Holding and the Pack cost meter put on a
 * spot. The curve places the best spot for advice and stands in until the group zero is there.
 */

import {TeleportGuard} from './teleport.mjs';
import {leads} from './wheels.mjs';
import {packSituation, packCostW} from './pack-cost.mjs';

export const GAP_EDGES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 12, 15, 20];
// [up to this gap (m), value]: steps over the bins [GAP_EDGES[i], GAP_EDGES[i + 1]); nothing at >= 20 m
const SHARE_STEPS = [[3.5, 0.49], [5, 0.45], [6, 0.39], [8, 0.30], [10, 0.22], [15, 0.17], [20, 0.08]];
const PENALTY_STEPS = [[3.5, 25], [5, 12], [20, -3]];            // W at REF_KMH
const PENALTY_BOXED_STEPS = [[3.5, 25], [5, 15], [6, 3], [20, -3]];
const steps = list => GAP_EDGES.slice(0, -1).map(e => list.find(([hi]) => e < hi)[1]);
export const PRIOR_SHARE = steps(SHARE_STEPS);
export const PRIOR_PENALTY = steps(PENALTY_STEPS);
export const PRIOR_PENALTY_BOXED = steps(PENALTY_BOXED_STEPS);
export const REF_KMH = 37.4;         // the penalty steps are watts at this speed
export const BEST_MAX_GAP = 12;      // advice never sends you further back than this
export const BEST_TOLERANCE_W = 1.5; // bins within this many watts of the best count as the best range
export const BOXED_M = 1;            // a rider this close behind you boxes you in
export const GROUP_SPLIT_S = 1.0;
export const SHARE_TAU_S = 10;       // smoothing of each rider's real saving share (Position's 10 s)
export const SHARE_PCT = 1;          // Position's zero: the best-placed rider in your group
const CAP_SAMPLES_MIN = 60;
const RHO = 1.225, CRR = 0.0042, BIKE_KG = 5, F_MAX = 0.496;
const guard = new TeleportGuard();   // other riders hop groups too (teleport.mjs)

// the penalty grows as (v/REF)² (DS 0.41.0, research/2026-10-24/descent-gap.mjs: ~v^1.6 flat, ~v^1.8–1.9 on descents;
// by v the best range at 45 km/h started at 0 m, so "back off" never came on a fast descent); clamped as before
export const PENALTY_EXP = 2;
const speedScale = v => Math.min(2 ** PENALTY_EXP, Math.max(0.5 ** PENALTY_EXP, (v * 3.6 / REF_KMH) ** PENALTY_EXP));
const center = i => (GAP_EDGES[i] + GAP_EDGES[i + 1]) / 2;
const median = a => {
    const s = [...a].sort((x, y) => x - y);
    return s.length ? s[s.length >> 1] : null;
};

/*
 * Group the riders on each road and direction (chained while consecutive gaps are <= 1 s). For every
 * rider: {size, ahead (riders in the group ahead of them), vGroup (median speed, m/s), gapAhead / gapBehind
 * (m to the rider directly ahead / behind, along the road, all placed at one moment (wheels.mjs leads); null
 * at the front / back), gid (same for everyone in the group, this snapshot only)}.
 */
export function groupLayout(entries) {
    const out = new Map();
    const roads = new Map();
    const lead = leads(entries);
    for (const o of entries || []) {
        const s = o.state;
        if (!s || !lead.has(o)) continue;
        const k = `${s.roadId}|${s.reverse ? 1 : 0}`;
        (roads.get(k) || roads.set(k, []).get(k)).push(o);
    }
    for (const list of roads.values()) {
        const x = o => lead.get(o);
        list.sort((a, b) => x(b) - x(a));
        let start = 0;
        for (let i = 1; i <= list.length; i++) {
            if (i < list.length) {
                const v = Math.max((list[i].state.speed || 0) / 3.6, 3);
                if ((x(list[i - 1]) - x(list[i])) / v <= GROUP_SPLIT_S) continue;
            }
            const grp = list.slice(start, i);
            const vGroup = median(grp.map(o => (o.state.speed || 0) / 3.6));
            const gid = `${grp[0].athleteId}`;   // the group's front rider names it (this snapshot only)
            grp.forEach((o, j) => {
                out.set(o.athleteId, {size: grp.length, ahead: j, vGroup, gid,
                                      gapAhead: j > 0 ? x(grp[j - 1]) - x(o) : null,
                                      gapBehind: j < grp.length - 1 ? x(o) - x(grp[j + 1]) : null});
            });
            start = i;
        }
    }
    return out;
}

export class GapCurve {
    constructor() {
        this.curve = {share: PRIOR_SHARE, open: PRIOR_PENALTY, boxed: PRIOR_PENALTY_BOXED};
        this.riders = new Map();   // athleteId -> {rr, w, seen, share, L}
    }

    static binOf(gap) {
        if (!(gap >= 0) || gap >= GAP_EDGES.at(-1)) return -1;
        return GAP_EDGES.findIndex((e, i) => gap >= e && gap < GAP_EDGES[i + 1]);
    }

    estimate(kind, i) {
        return this.curve[kind][i];
    }

    interp(kind, gap) {
        if (!(gap >= 0) || gap >= GAP_EDGES.at(-1)) return 0;
        const n = PRIOR_SHARE.length;
        if (gap <= center(0)) return this.estimate(kind, 0);
        for (let i = 0; i < n - 1; i++) {
            if (gap <= center(i + 1)) {
                const t = (gap - center(i)) / (center(i + 1) - center(i));
                return this.estimate(kind, i) + t * (this.estimate(kind, i + 1) - this.estimate(kind, i));
            }
        }
        const t = (gap - center(n - 1)) / (GAP_EDGES.at(-1) - center(n - 1));
        return this.estimate(kind, n - 1) * (1 - t);
    }

    /* The "too close" penalty (W) at a gap and speed v (m/s); boxed = a rider within BOXED_M behind you. */
    penalty(gap, boxed = false, v = REF_KMH / 3.6) {
        return this.interp(boxed ? 'boxed' : 'open', gap) * speedScale(v);
    }

    /* What a typical rider really saves (W) at a gap, for your air-drag power aeroW at speed v (m/s). */
    savingW(gap, aeroW, boxed = false, v = REF_KMH / 3.6) {
        return this.interp('share', gap) * aeroW - this.penalty(gap, boxed, v);
    }

    /*
     * The best spot at your air drag (with room behind): {savingW, gap, lo, hi}, chosen on a 3-bin running mean
     * and its mean saving reported.
     */
    best(aeroW, v = REF_KMH / 3.6) {
        const k = speedScale(v);
        const raw = PRIOR_SHARE.map((_, i) => this.estimate('share', i) * aeroW - this.estimate('open', i) * k);
        const sm = raw.map((_, i) => {
            const w = raw.slice(Math.max(0, i - 1), i + 2);
            return w.reduce((a, b) => a + b, 0) / w.length;
        });
        let bi = 0;
        for (let i = 0; i < sm.length; i++) {
            if (center(i) <= BEST_MAX_GAP && sm[i] > sm[bi]) bi = i;
        }
        let lo = bi, hi = bi;
        while (lo > 0 && sm[lo - 1] >= sm[bi] - BEST_TOLERANCE_W) lo--;
        while (hi < sm.length - 1 && center(hi + 1) <= BEST_MAX_GAP && sm[hi + 1] >= sm[bi] - BEST_TOLERANCE_W) hi++;
        const inRange = raw.slice(lo, hi + 1);
        return {savingW: inRange.reduce((a, b) => a + b, 0) / inRange.length, gap: center(bi),
                lo: GAP_EDGES[lo], hi: GAP_EDGES[hi + 1]};
    }

    /*
     * Feed one nearby snapshot (fresh entries): each rider's draft cap (their CdA) and their real saving share, for
     * Position's group zero.
     */
    ingest(entries, layout = groupLayout(entries)) {
        const now = Date.now();
        const lead = leads(entries || []);
        for (const o of entries || []) {
            const s = o.state;
            if (!s || !Number.isFinite(s.worldTime)) continue;
            let r = this.riders.get(o.athleteId);
            if (!r) this.riders.set(o.athleteId, r = {rr: [], w: o.athlete?.weight});
            r.seen = now;
            if (r.wt != null && s.worldTime <= r.wt) continue;
            r.wt = s.worldTime;
            const v = (s.speed || 0) / 3.6;
            const L = layout.get(o.athleteId);
            if (v > 8.3 && s.draft > 5 && !s.activePowerUp) {
                r.rr.push(s.draft / (0.5 * RHO * v ** 3));
                if (r.rr.length > 600) r.rr.shift();
            }
            const settling = guard.settling(o.athleteId, {wt: s.worldTime, x: s.x, y: s.y, v});
            r.L = L || null;
            const cda = L && L.size >= 3 ? this.cdaOf(o.athleteId) : null;
            const packW = cda ? packCostW(packSituation(entries, o, lead), L, v,
                                          {massKg: (r.w || 75) + BIKE_KG, cda, crr: CRR}) : 0;
            this.trackShare(r, o.athleteId, s, v, L, settling, packW);
        }
        for (const [id, r] of this.riders) {
            if (now - r.seen > 60000) this.riders.delete(id);
        }
    }

    /*
     * Each rider's real saving as a share of their own air drag (reported draft minus the pack cost of their spot,
     * pack-cost.mjs), smoothed over SHARE_TAU_S. Power-up and teleport seconds are left out.
     */
    trackShare(r, id, s, v, L, settling, packW) {
        const cda = this.cdaOf(id);
        if (!cda || !L || v <= 8.3 || s.activePowerUp || settling) return;
        const real = Math.max(0, (s.draft || 0) - packW) / (cda * 0.5 * RHO * v ** 3);
        const x = r.share;
        if (!x || !(s.worldTime > x.wt) || s.worldTime - x.wt > 10000) {
            r.share = {wt: s.worldTime, v: real};
        } else {
            x.v += (1 - Math.exp(-(s.worldTime - x.wt) / 1000 / SHARE_TAU_S)) * (real - x.v);
            x.wt = s.worldTime;
        }
    }

    /* A rider's smoothed share starts over (Position after a gap opening: the old share still held the gap's cost). */
    resetShare(athleteId) {
        const r = this.riders.get(athleteId);
        if (r) r.share = null;
    }

    /*
     * The group-relative zero for Position: what the best-placed rider in your group really saves right now
     * (SHARE_PCT of the smoothed shares of riders in your group, its front rider left out), and your own share.
     * Null until 2+ of them have a share.
     */
    groupShare(athleteId, L) {
        const me = this.riders.get(athleteId);
        if (!L || !me || !me.share) return null;
        const shares = [];
        for (const r of this.riders.values()) {
            if (r.L && r.L.gid === L.gid && r.L.ahead > 0 && r.share && r.seen === me.seen) shares.push(r.share.v);
        }
        if (shares.length < 2) return null;
        shares.sort((a, b) => a - b);
        return {ref: shares[Math.round(SHARE_PCT * (shares.length - 1))], mine: me.share.v, n: shares.length};
    }

    /* A rider's CdA from their own draft cap (P90 of draft/½ρv³ ÷ 0.496), once enough samples; else null. */
    cdaOf(athleteId) {
        const r = this.riders.get(athleteId);
        if (!r || r.rr.length < CAP_SAMPLES_MIN) return null;
        const s = [...r.rr].sort((a, b) => a - b);
        return s[Math.floor(s.length * 0.9)] / F_MAX;
    }
}
