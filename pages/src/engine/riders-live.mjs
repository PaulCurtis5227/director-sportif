/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which riders to trust, and how.
 *
 * Frozen avatars: when a rider leaves, Sauce keeps their last state in the nearby list for ~15 s while you ride
 * up to and past the frozen avatar (G ride 2026-09-28: a rider stuck at 22.6 km/h, 0 W, 0 rpm, state 15 s old).
 * Within 100 m, 99% of states are under 1.1 s old; farther riders update every ~2 s and can be ~14 s old at P99.
 *
 * Draft classes, learned from everyone's data:
 * - neverDrafts: gets no draft even sitting 0.5–5 m behind a wheel (TT bikes in normal rides; Zwift's handcycle
 *   and recumbent trike are other no-draft-for-you vehicles). 2026-10-01 free ride: 5 riders, 0 of 44–747 s.
 * - givesNoDraft: riders who normally draft get nothing behind it. Per the user, the handcycle gets draft itself
 *   but nobody can draft it. Zwift Insider's sheet puts it at CdA 0.281 (slicker than a P74's 0.290) and
 *   ~12 kg heavier than a road bike, the recumbent trike ~10 kg heavier.
 * Both are left out of the surface map (a 12 kg heavier rider reads ~+8 N "rough" on a 7% climb), and a wheel
 * that gives no draft is flagged instead of being treated as shelter.
 */

export const STALE_NEAR_M = 100;
export const STALE_NEAR_S = 3;
export const STALE_FAR_S = 8;
export const BEHIND_MIN_M = 0.5;
export const BEHIND_MAX_M = 5;
export const MIN_KMH = 20;            // below this the draft is small anyway
export const DRAFT_W = 1;             // "has draft"
export const DRAFTER_S = 10;          // a rider counts as a drafter after this many seconds with draft
export const NEVER_MIN_S = 10;        // seconds behind a wheel before "never drafts" can be decided
export const NEVER_ZERO = 0.9;
export const SETTLED_MS = 1;          // a follower within this speed of the wheel is following, not passing
export const NONE_MIN_S = 10;         // drafter-seconds behind a rider before "gives no draft" can be decided
export const NONE_ZERO = 0.8;

/* The riders whose state is current enough to steer by. `me` is the self entry. */
export function freshEntries(entries, me) {
    if (!me || !me.state || !Number.isFinite(me.state.worldTime)) {
        return entries;
    }
    return entries.filter(o => {
        if (o === me || !o || !o.state || !Number.isFinite(o.state.worldTime)) {
            return o === me;
        }
        const age = (me.state.worldTime - o.state.worldTime) / 1000;
        const near = Number.isFinite(o.gapDistance) && Number.isFinite(me.gapDistance) &&
            Math.abs(o.gapDistance - me.gapDistance) <= STALE_NEAR_M;
        return age <= (near ? STALE_NEAR_S : STALE_FAR_S);
    });
}

export class DraftClassifier {
    constructor() {
        this.r = new Map();   // athleteId -> {wt, drafted, behind, behindZero, followed, followedZero}
    }

    _get(id) {
        let x = this.r.get(id);
        if (!x) {
            this.r.set(id, x = {wt: null, drafted: 0, behind: 0, behindZero: 0, followed: 0, followedZero: 0});
        }
        return x;
    }

    /* entries: fresh nearby entries; aheadMap: wheelsAhead(entries) (each rider's nearest wheel, in line). */
    update(entries, aheadMap) {
        for (const o of entries) {
            const s = o && o.state;
            if (!s || !Number.isFinite(s.worldTime)) {
                continue;
            }
            const x = this._get(o.athleteId);
            if (x.wt != null && s.worldTime <= x.wt) {
                continue;   // count each rider once per new state
            }
            x.wt = s.worldTime;
            if ((s.speed || 0) < MIN_KMH || s.activePowerUp) {
                continue;
            }
            const draft = (s.draft || 0) > DRAFT_W;
            if (draft) {
                x.drafted++;
            }
            const a = aheadMap && aheadMap.get(o.athleteId);
            const w = a && a.inline;
            if (!w || !(w.gap >= BEHIND_MIN_M && w.gap <= BEHIND_MAX_M)) {
                continue;
            }
            x.behind++;
            if (!draft) {
                x.behindZero++;
            }
            // Evidence against the wheel only from a settled follower (Zwift's draft lags while you close
            // in or pass) who normally does get draft behind wheels, and only while that wheel is the one rider
            // within 20 m ahead: with a bunch ahead the draft comes from the bunch (I ride 2026-10-05: 2 m behind a
            // trike with 4 riders ahead drew 36–110 W, which cleared its no-draft flag).
            const settled = w.speed != null && Math.abs((s.speed || 0) / 3.6 - w.speed) <= SETTLED_MS;
            const goodDrafter = x.drafted >= DRAFTER_S && x.behindZero / x.behind <= 0.5;
            const alone = !a.counts || a.counts[a.counts.length - 1] <= 1;
            if (settled && goodDrafter && alone) {
                const l = this._get(w.id);
                l.followed++;
                if (!draft) {
                    l.followedZero++;
                }
            }
        }
    }

    neverDrafts(id) {
        const x = this.r.get(id);
        return !!x && x.behind >= NEVER_MIN_S && x.behindZero / x.behind >= NEVER_ZERO && x.drafted < 3;
    }

    givesNoDraft(id) {
        const x = this.r.get(id);
        return !!x && x.followed >= NONE_MIN_S && x.followedZero / x.followed >= NONE_ZERO;
    }

    /* Leave out of the surface map: either kind may be a heavy handcycle/trike, or a TT bike. */
    excluded(id) {
        return this.neverDrafts(id) || this.givesNoDraft(id);
    }

    counts() {
        let never = 0;
        let none = 0;
        for (const id of this.r.keys()) {
            never += this.neverDrafts(id) ? 1 : 0;
            none += this.givesNoDraft(id) ? 1 : 0;
        }
        return {never, none};
    }
}
