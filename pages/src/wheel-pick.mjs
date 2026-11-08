/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Your wheel: the rider ahead giving you draft, for the Wheel gap, Position and everything that reads "the wheel in
 * line". wheels.mjs calls a rider in line only within 0.44 m sideways (INLINE_LANE), so sitting a little to the side
 * of a wheel made the Wheel gap jump to the next rider in line, often 10 m+ up the road (the user, 2026-11-07: "I will
 * be on a wheel a little to the side and all of the sudden the wheel gap is looking 30 feet up the road"; "if I am
 * getting good draft from a wheel, I should see gap to that wheel").
 * So each rider ahead is scored by the draft they'd give you: the share by gap (gap-curve's steps, smoothed) × a
 * sideways factor. Alone behind one wheel Zwift keeps 91% of the in-line draft at 0.3–0.6 m aside, 66% at 0.6–1 m,
 * 40% at 1–1.5 m (docs/FINDINGS.md, straights); in a pack the offset barely matters (99% to 1.5 m). With good draft
 * (draftQ ≥ GOOD_Q) the wheel giving it is near, so the pack factor is used and the nearest wheel within 1.5 m aside
 * wins; without it, the lone-pair factor. A rider beside you (wheels overlapping: under ASIDE_FROM_M center to
 * center) gives no draft and is no wheel unless right in line. The wheel you're on is kept while it scores within
 * KEEP of the best, so two riders side by side ahead don't swap every second.
 * Pure: fed the engine's entries each tick.
 */
import {gapBetween} from './engine/wheels.mjs';
import {UNIT_PER_M} from './engine/pack-cost.mjs';

export const WHEEL_PICK = {inlineM: 0.44, asideFromM: 1.5, maxGapM: 25, goodQ: 0.5, keep: 0.8};
// [m, value] points, linear between, 0 past the last
const SHARE_PTS = [[0, 0.49], [3.5, 0.49], [5, 0.45], [6, 0.39], [8, 0.30], [10, 0.22], [15, 0.17], [20, 0.08], [25, 0.02]];   // still a wheel at 25 m (GAP_MAX_M)
const LONE_PTS = [[0, 1], [0.3, 1], [0.45, 0.91], [0.8, 0.66], [1.25, 0.40], [2, 0]];
const PACK_PTS = [[0, 1], [1.5, 0.99], [2, 0]];

const lerp = (pts, x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        if (x <= x1) {
            const [x0, y0] = pts[i - 1];
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        }
    }
    return 0;
};
// the draft a rider `gap` m ahead and `asideM` m to the side would give you, as a share of your air drag
export const wheelDraft = (gap, asideM, pack = false) => lerp(SHARE_PTS, gap) * lerp(pack ? PACK_PTS : LONE_PTS, asideM);

export class WheelPick {
    constructor(opts = {}) {
        this.o = {...WHEEL_PICK, ...opts};
        this.prevId = null;
    }

    reset() {
        this.prevId = null;
    }

    /*
     * entries: the riders (yours among them, gapDistance relative to the watched rider); me: your entry; q: your draft
     * as a share of the most you can get (draftQ), or null.
     * Returns {id, gap (m, center to center, aligned), gapSource, lane (roadPosition units, theirs − yours), speed (m/s)}
     * or null.
     */
    update(entries, me, {q = null} = {}) {
        const o = this.o;
        if (!me || !me.state || !Number.isFinite(me.gapDistance)) { this.prevId = null; return null; }
        const pack = Number.isFinite(q) && q >= o.goodQ;
        let best = null, prev = null;
        for (const r of entries || []) {
            if (!r || r === me || r.athleteId === me.athleteId || !r.state || !Number.isFinite(r.gapDistance)) continue;
            if (r.state.roadId !== me.state.roadId || !!r.state.reverse !== !!me.state.reverse) continue;
            if (!(r.gapDistance < me.gapDistance)) continue;   // ahead of you on the road
            const g = gapBetween(me, r);
            const gap = Math.max(0, g.gap);
            if (gap > o.maxGapM) continue;
            const lane = (r.state.roadPosition ?? 0) - (me.state.roadPosition ?? 0);
            const asideM = Math.abs(lane) / UNIT_PER_M;
            if (asideM > o.inlineM && gap < o.asideFromM) continue;   // beside you
            const score = wheelDraft(gap, asideM, pack);
            if (!(score > 0)) continue;
            const w = {id: r.athleteId, gap, gapSource: g.source, lane, speed: (r.state.speed || 0) / 3.6, score};
            if (r.athleteId === this.prevId) prev = w;
            if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && gap < best.gap)) best = w;
        }
        const pick = prev && prev.score >= best.score * o.keep ? prev : best;
        this.prevId = pick ? pick.id : null;
        if (!pick) return null;
        const {score, ...out} = pick;
        return out;
    }
}
