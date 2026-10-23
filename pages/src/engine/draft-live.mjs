/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Live draft metrics. Pure — no DOM — so it's unit-testable and reusable.
 *
 * WHAT THE CAP CAPS: not watts. Zwift's draft is a fraction of your own air drag, and that fraction
 * has a hard ceiling. In watts the draft is  r · ½ρv³, where r = draftW / (½ρv³) = fraction × CdA
 * (m²). r tops out at a per-rider value, the CAP. Draft watts still grow with v³, so 700 W of
 * draft just means a very fast bunch.
 *
 * Measured on a 1,514-rider group ride (2026-09-27; see the local notes):
 *   - cap ≈ CAP_K · height_m · weight_kg^0.42 (R² 0.88 over 335 riders); a hard ceiling (P99.9 1.004)
 *   - 5+ riders within 20 m, gap ≤ 3 m -> at the cap ~80% of the time; 1 wheel -> ~0.75 of it
 *   - fades beyond ~3 m: 4–6 m 0.91, 6–8 m 0.75, 8–10 m 0.59, 10–15 m 0.36, >15 m ≈ 0
 *   - off-line (|Δ roadPosition| > ~50,000) -> ≈ 0; below ~27 km/h only ~0.87 of the cap
 *   - ramps up over ~6 s and decays over ~11 s after losing the wheel
 *   - DRAFTBOOST multiplies the draft ×1.5–2 but clips at 1.10× the cap; AERO ×0.73; LIGHTNESS ×0.95
 *
 * The reported draft matches Zwift Insider's minimum-power TTT savings (PD 4.1.1: 24/32/39% for 1/2/3
 * riders ahead), so position cost is in reported draft. effectiveW / excessW = what riders TYPICALLY get
 * (effective-draft.mjs, for reports): the gap is riding above the floor, i.e. holding, not a wrong number.
 */

import {effectiveDraft, excessShare} from './effective-draft.mjs';
export const CAP_K = 0.01286;
export const AT_CAP = 0.97;             // fraction of cap that counts as "at max"
export const LANE_OFFLINE = 50000;      // |Δ roadPosition| beyond which you're beside, not behind
export const SLOW_KMH = 27;
const LEARN_MIN_KMH = 30;
const LEARN_SAMPLES_MIN = 60;
const LEARN_BUFFER = 900;

/*
 * DRAFTBOOST outlook. Event study of 86 activations (2026-09-27 group ride):
 *   fired at the cap (67% of uses!) -> 1.10× cap, median +9 W;  fired at 0.6–0.9 -> 1.10×, +20–30 W;
 *   fired with no draft -> half gained nothing (Zwift Insider: it only works when already in draft).
 * Model: boosted = min(BOOST_MULT · q, BOOST_CEIL · positional ceiling), where the ceiling is how
 * much draft the gap allows (≤ 4 m: the cap; further back the measured fade), and the boost lifts
 * the ceiling by 10%. BOOST_MULT: measured ×1.5–2.05 below the ceiling. The gain in WATTS is
 * (boosted − q) · cap · ½ρv³, so an at-cap boost is small at 35 km/h (~10 W) but ~30 W at 55 km/h.
 * With groupSize given (reports: what a TYPICAL rider would feel), the gain is in effective draft
 * (effective-draft.mjs); riders' shortfall vs the reported draft stays during a boost (11 clean boosts,
 * 3 rides: 25–34% before, 30–36% during). Without groupSize (the live Data Tap and the analyzer) it's in
 * reported watts: what riding at the floor gets you.
 */
export const BOOST_MULT = 2.0;
export const BOOST_CEIL = 1.10;
export const BOOST_EFFECTIVE_SEC = 34;   // ~40 s power-up minus the ~6 s draft ramp
export const BOOST_WORTH_W = 15;         // below this, save it for a better moment

// Draft ceiling (fraction of cap) the gap allows, from the 5+-rider bunch table: the cap within
// 4 m; beyond that the upper quartile (the median understates it — boosted riders exceed it).
export function gapCeiling(gap) {
    if (gap == null) return 0;
    if (gap < 4) return 1.0;
    if (gap < 6) return 0.91;
    if (gap < 8) return 0.88;
    if (gap < 10) return 0.73;
    if (gap < 15) return 0.51;
    return 0;
}

/*
 * What firing DRAFTBOOST now would gain, if you hold position:
 * {boostedQ, gainW, gainKj, verdict: 'useless'|'save'|'use', text}
 */
export function boostOutlook({q, aheadGap, ahead20, v, cap, rho = 1.225, groupSize = null}) {
    if (!cap || q == null || !(v > 0)) {
        return {boostedQ: null, gainW: null, gainKj: null, verdict: null, text: 'boost value unknown (no draft cap yet)'};
    }
    const ceiling = ahead20 > 0 ? gapCeiling(aheadGap) : 0;
    if (ceiling === 0 || q < 0.02) {
        return {boostedQ: q, gainW: 0, gainKj: 0, verdict: 'useless',
                text: 'useless now — no draft to boost (it only works in the draft)'};
    }
    const boostedQ = Math.max(q, Math.min(BOOST_MULT * q, BOOST_CEIL * ceiling));
    const real = x => groupSize == null ? x : x * (1 - excessShare(x, groupSize, v));
    const gainW = Math.max(0, real(boostedQ) - real(q)) * cap * 0.5 * rho * v ** 3;
    const gainKj = gainW * BOOST_EFFECTIVE_SEC / 1000;
    const atMax = q >= AT_CAP * ceiling;
    const verdict = gainW >= BOOST_WORTH_W ? 'use' : 'save';
    const text = verdict === 'use' ?
        `worth it: +${gainW.toFixed(0)} W now (~${gainKj.toFixed(1)} kJ over the boost)` :
        `save it: only +${gainW.toFixed(0)} W${atMax ? ' — already at max draft' : ''}`;
    return {boostedQ, gainW, gainKj, verdict, text};
}

/*
 * Position cue. Pack data (2026-09-27, ~19.4k 10 s windows at MAX draft, smooth road), re-measured
 * with TIME-BASED gaps (wheels.mjs; the position-based gaps had inflated this to +22 W):
 *   - riders under ~0.6 m average ~+5 W more than riders 1.5–4 m back for the same speed and draft
 *     (a steady 4–6 W shift). Mechanism open (drag, or Zwift refusing to let you pass — the
 *     PinnedDetector in live-model.mjs flags the latter directly), so the cue reports the average.
 *   - POSITION matters more: the LAST rider(s), 2–6 m off the wheel, spent 143 W / ~13 W waste vs
 *     ~151 W / ~22 W for riders inside the bunch with the same 1–3 m of room. Being at the back
 *     ("just off the back", as the rider found in races) is the most efficient place measured.
 * The draft is at max out to ~3–4 m, so these positions keep ~99% of it. (~150 W / ~35 km/h ride.)
 */
export const CROWD_GAP_M = 1.0;
export const SWEET_SPOT_M = [2.0, 3.5];
export const AT_BACK_M = 3;          // nobody within this far behind = you're the last rider
export const AT_BACK_GAP_M = [1.5, 6];
export const CROWD_COST_W = 5;
export const BACK_SAVING_W = 8;      // last rider vs inside the bunch at the same room

export function crowdingCostW() {
    return CROWD_COST_W;
}

/*
 * {state: 'crowding'|'back'|'sweet'|'close'|null, costW, text} for the current position.
 * behindGap: metres to the nearest rider behind (null = nobody within reach).
 */
export function crowdingCue({q, aheadGap, aheadLane, ahead20, powerUp, behindGap}) {
    if (powerUp || aheadGap == null || !ahead20 || q == null) {
        return {state: null, costW: 0, text: ''};
    }
    // Beside (not behind) the nearest wheel in a thin line isn't crowding it.
    const offline = ahead20 <= 2 && aheadLane != null && Math.abs(aheadLane) > LANE_OFFLINE;
    if (offline) {
        return {state: null, costW: 0, text: ''};
    }
    const atBack = behindGap == null || behindGap > AT_BACK_M;
    if (q >= AT_CAP && aheadGap < CROWD_GAP_M) {
        const costW = crowdingCostW(ahead20);
        return {state: 'crowding', costW,
                text: `close to the wheel (${aheadGap.toFixed(1)} m): riders this close average ~+${costW} W for the same speed — 2–3 m keeps the full draft`};
    }
    if (q >= AT_CAP && atBack && aheadGap >= AT_BACK_GAP_M[0] && aheadGap <= AT_BACK_GAP_M[1]) {
        return {state: 'back', costW: 0,
                text: `at the back with room (${aheadGap.toFixed(1)} m): the most efficient place measured — full draft, ~${BACK_SAVING_W} W less than inside the bunch`};
    }
    if (q >= AT_CAP && aheadGap >= SWEET_SPOT_M[0] && aheadGap <= SWEET_SPOT_M[1]) {
        return {state: 'sweet', costW: 0,
                text: `full draft with room (${aheadGap.toFixed(1)} m) — the very back of the bunch saves ~${BACK_SAVING_W} W more`};
    }
    if (q >= AT_CAP && aheadGap < SWEET_SPOT_M[0]) {
        return {state: 'close', costW: 0, text: `close (${aheadGap.toFixed(1)} m): full draft; 2–3 m is safer from crowding`};
    }
    return {state: null, costW: 0, text: ''};
}

export function predictedCap({heightCm, weightKg}) {
    if (!heightCm || !weightKg) {
        return null;
    }
    return CAP_K * (heightCm / 100) * weightKg ** 0.42;
}

/* r = draftW / (½ρv³): draft expressed as m² of drag area removed. */
export function draftArea(draftW, v, rho = 1.225) {
    return v > 1 ? (draftW || 0) / (0.5 * rho * v ** 3) : 0;
}

function percentile(values, p) {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

/*
 * Tracks one rider's draft. Feed update() one sample per state tick; it returns the live metrics.
 * The cap is learned from the rider's own at-cap moments (deep in a bunch, fast, no power-up) and
 * falls back to the size prediction until enough of those are seen. Pass a previously learned cap
 * via `cap` to start warm.
 */
export class DraftTracker {
    constructor({cap = null, rho = 1.225} = {}) {
        this.rho = rho;
        this.savedCap = cap;
        this.buffer = [];
        this.prevQ = null;
        this.totals = {sec: 0, groupSec: 0, atCapSec: 0, savedJ: 0, missedJ: 0, crowdSec: 0, sweetSec: 0, backSec: 0,
                       crowdJ: 0};
        this.lastWt = null;
    }

    /*
     * The bike changed mid-ride (a swap to a climbing or gravel bike): the cap is f_max × CdA, so scale what has
     * been learned by newCdA / oldCdA instead of starting over.
     */
    rescale(factor) {
        if (!(factor > 0) || !Number.isFinite(factor)) {
            return;
        }
        this.buffer = this.buffer.map(r => r * factor);
        if (this.savedCap) {
            this.savedCap *= factor;
        }
    }

    get learnedCap() {
        return this.buffer.length >= LEARN_SAMPLES_MIN ? percentile(this.buffer, 0.9) : null;
    }

    capFor(athlete) {
        const learned = this.learnedCap;
        if (learned) {
            return {cap: learned, source: 'learned'};
        }
        if (this.savedCap) {
            return {cap: this.savedCap, source: 'saved'};
        }
        const p = predictedCap(athlete || {});
        return p ? {cap: p, source: 'predicted'} : {cap: null, source: 'none'};
    }

    /*
     * s: {wt (ms), v (m/s), draft (W), powerUp (active), heldPowerUp (in your pocket, self only),
     *     ahead20, aheadGap (m|null), aheadLane (|null), behindGap (m|null = nobody close behind),
     *     groupSize (riders in your group incl. you; groupSizeAround),
     *     noDraftWheel (the only rider within 20 m ahead gives no draft: riders-live.mjs givesNoDraft)}
     * athlete: {heightCm, weightKg}; cda: the rider's CdA (for "% of drag"), optional.
     */
    update(s, athlete, cda = null) {
        const kmh = s.v * 3.6;
        const r = draftArea(s.draft, s.v, this.rho);
        const inBunch = s.ahead20 >= 5 && s.aheadGap != null && s.aheadGap < 3;
        if (!s.powerUp && kmh >= LEARN_MIN_KMH && s.draft > 5 && inBunch) {
            this.buffer.push(r);
            if (this.buffer.length > LEARN_BUFFER) {
                this.buffer.shift();
            }
        }
        const {cap, source} = this.capFor(athlete);
        const q = cap ? r / cap : null;
        const solo = 0.5 * this.rho * s.v ** 3;  // W per m² of drag area
        const inGroup = s.ahead20 > 0;
        const groupSize = s.groupSize ?? (inGroup ? Math.max(2, s.ahead20 + 1) : 1);
        const {effectiveW, excessW} = s.powerUp ? {effectiveW: s.draft || 0, excessW: 0} :
            effectiveDraft({draftW: s.draft || 0, q, groupSize, v: s.v});
        // Behind a wheel that gives no draft (recumbent trike, handcycle) with nobody else close ahead there is no
        // draft to miss: don't count it (the user, 2026-10-05: "missed" kept climbing behind a trike).
        const missedW = cap && inGroup && !s.powerUp && !s.noDraftWheel ? Math.max(0, (cap - r) * solo) : 0;

        const dt = this.lastWt != null && s.wt > this.lastWt && s.wt - this.lastWt < 5000 ? (s.wt - this.lastWt) / 1000 : 0;
        if (s.wt != null && (this.lastWt == null || s.wt > this.lastWt)) {
            this.lastWt = s.wt;
        }
        const t = this.totals;
        t.sec += dt;
        t.savedJ += (s.draft || 0) * dt;
        if (inGroup) {
            t.groupSec += dt;
            t.missedJ += missedW * dt;
            if (q != null && q >= AT_CAP) {
                t.atCapSec += dt;
            }
        }
        const crowd = crowdingCue({q, aheadGap: s.aheadGap, aheadLane: s.aheadLane, ahead20: s.ahead20, powerUp: s.powerUp,
                                   behindGap: s.behindGap});
        if (crowd.state === 'crowding') {
            t.crowdSec += dt;
            t.crowdJ += crowd.costW * dt;
        } else if (crowd.state === 'sweet') {
            t.sweetSec += dt;
        } else if (crowd.state === 'back') {
            t.backSec += dt;
        }
        const reason = this.reason(s, q, kmh);
        this.prevQ = q;
        // Boost outlook (only meaningful when no power-up is running; held = what you could fire).
        let boost;
        if (s.powerUp === 'DRAFTBOOST') {
            boost = {verdict: 'active', text: `boost active: ${q == null ? '' : `${(q * 100).toFixed(0)}% of max draft`}`};
        } else if (s.powerUp) {
            boost = {verdict: null, text: `${s.powerUp} active`};
        } else {
            boost = boostOutlook({q, aheadGap: s.aheadGap, ahead20: s.ahead20, v: s.v, cap, rho: this.rho});
        }
        boost.held = s.heldPowerUp === 'DRAFTBOOST';
        return {
            draftW: s.draft || 0,
            area: r,
            cap,
            capSource: source,
            quality: q,
            pctOfDrag: cda ? r / cda : null,
            missedW,
            effectiveW,
            excessW,
            groupSize,
            reason,
            boost,
            crowd,
            // shares of the time spent AT max draft: crowding the wheel vs in the 2–3.5 m sweet spot
            crowdPct: t.atCapSec > 0 ? t.crowdSec / t.atCapSec * 100 : null,
            sweetPct: t.atCapSec > 0 ? t.sweetSec / t.atCapSec * 100 : null,
            backPct: t.atCapSec > 0 ? t.backSec / t.atCapSec * 100 : null,
            crowdKj: t.crowdJ / 1000,
            timeAtCapPct: t.groupSec > 0 ? t.atCapSec / t.groupSec * 100 : null,
            savedKj: t.savedJ / 1000,
            missedKj: t.missedJ / 1000,
        };
    }

    /* Why you're not at the cap, most important first (null when you are). */
    reason(s, q, kmh) {
        if (s.powerUp) {
            return `${s.powerUp} active`;
        }
        if (q != null && q >= AT_CAP) {
            return null;
        }
        if (s.noDraftWheel) {
            return 'the wheel ahead gives no draft (recumbent or handcycle?)';
        }
        if (!s.ahead20) {
            return s.aheadGap == null ? 'no wheel ahead' : `no wheel within 20 m (${s.aheadGap.toFixed(0)} m)`;
        }
        // Beside the nearest rider only costs draft when there are just 1–2 wheels; in a bunch the
        // riders further ahead still shelter you (off-line nearest wheel, 5+ ahead: median 0.99).
        if (s.ahead20 <= 2 && s.aheadGap != null && s.aheadGap < 3 && s.aheadLane != null &&
            Math.abs(s.aheadLane) > LANE_OFFLINE) {
            return 'beside the wheel, not behind it';
        }
        if (s.aheadGap != null && s.aheadGap > 4) {
            return `too far back (${s.aheadGap.toFixed(1)} m)`;
        }
        if (kmh < SLOW_KMH) {
            return `slow — draft is weaker below ~${SLOW_KMH} km/h`;
        }
        if (s.ahead20 <= 2) {
            return `only ${s.ahead20} wheel${s.ahead20 === 1 ? '' : 's'} — 3+ reaches max`;
        }
        if (this.prevQ != null && q != null && q > this.prevQ + 0.01) {
            return 'ramping up (takes ~6 s)';
        }
        if (this.prevQ != null && q != null && q < this.prevQ - 0.01) {
            return 'fading (draft lingers ~11 s after losing shelter)';
        }
        return 'below max';
    }
}
