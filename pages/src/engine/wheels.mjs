/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Whose wheel am I on, and how many riders are shielding me?" from one `nearby` snapshot.
 * Shared by the live window and the analyzer.
 *
 * GAPS: Sauce gives two per rider, both relative to the WATCHED rider (sauce4zwift stats.mjs
 * _computeNearby / compareRoadPositions):
 *   gapDistance (m)  road distance between each rider's LATEST reported position. Riders' states
 *                    arrive at different moments, so a 0.5 s timestamp mismatch at 40 km/h puts
 *                    ~5.5 m of error into it — far more than the 1 m vs 3 m that matters here.
 *   gap (s)          when the rider ahead passed the spot where you are NOW, from their position
 *                    history: consistent in time. Sauce flags it `isGapEst` when it had to estimate.
 * ALIGNED (v0.43, 2026-10-03 interval ride): the timestamp mismatch is fixable. Every state carries its own
 * worldTime and speed, so move each rider to one moment: lead = −gapDistance − (worldTime − T) × speed.
 * Your own states arrive in uneven 0.8 / 1.2 s steps, so unaligned the whole bunch shifted ±2–3 m against
 * you from tick to tick at 12 m/s; 8–16 riders sit within 3 m of you in a big bunch, so your group place
 * jumped 8–14 places (17 times in 19 min). Tick-to-tick |Δ| for riders within 15 m (27k pairs): raw distance
 * P90 2.36 m (23% over 1.5 m), Sauce's time gap 2.02 m (15%), aligned 0.98 m (3.9%). So the aligned distance
 * comes first; the time gap is the fallback when a state time is missing or more than ALIGN_MAX_S off.
 * Both gaps are negative for riders ahead of the watched rider.
 *
 * Only riders on the same roadId and direction count — the nearby list mixes in riders on
 * crossing roads at intersections. `lane` is the difference in raw `state.roadPosition` (units
 * unknown; ~50,000 separates "behind" from "beside" in the draft data).
 */

// Riders ahead are counted within each of these distances (m) — the draft-quality features.
export const AHEAD_WINDOWS_M = [5, 10, 20];

// |Δ roadPosition| within which a rider ahead counts as IN LINE with you (vs beside you); the same
// ~50,000 threshold the draft data shows as "beside, not behind" (units unknown).
export const INLINE_LANE = 50000;

// States further apart than this (s) aren't moved to a common moment (stale; freshEntries drops most of them).
export const ALIGN_MAX_S = 2;

/*
 * Metres a rider is ahead of the watched rider at world time T (ms), with their position moved from their own
 * state time to T at their speed. null when it can't be aligned.
 */
export function leadAt(o, T) {
    const s = o && o.state;
    if (!s || !Number.isFinite(o.gapDistance) || !Number.isFinite(s.worldTime) || !Number.isFinite(T)) {
        return null;
    }
    const dt = (s.worldTime - T) / 1000;
    if (Math.abs(dt) > ALIGN_MAX_S) {
        return null;
    }
    return -o.gapDistance - dt * (s.speed || 0) / 3.6;
}

/*
 * One common moment for a snapshot: the watched rider's state time (gaps are relative to them), else the newest.
 */
export function snapshotTime(entries) {
    let T = null;
    for (const o of entries || []) {
        const wt = o && o.state && o.state.worldTime;
        if (!Number.isFinite(wt)) continue;
        if (o.watching) return wt;
        if (T == null || wt > T) T = wt;
    }
    return T;
}

/*
 * Metres each rider is ahead of the watched rider at one moment (Map entry -> m): aligned where possible, else the
 * time gap × speed, else the raw gapDistance; keyed by entry. Orders groups (gap-curve.mjs groupLayout, effective-draft.mjs).
 */
export function leads(entries) {
    const T = snapshotTime(entries);
    const out = new Map();
    for (const o of entries || []) {
        if (!o || !o.state) continue;
        let x = leadAt(o, T);
        if (x == null && Number.isFinite(o.gap)) x = -o.gap * Math.max(3, (o.state.speed || 0) / 3.6);
        if (x == null && Number.isFinite(o.gapDistance)) x = -o.gapDistance;
        if (x != null) out.set(o, x);
    }
    return out;
}

/*
 * Gap in metres from `me` back-to-front to `o` (positive = o is ahead), and which source was used.
 * Aligned to your state time when both state times are known; else time-based when both riders have a real
 * (non-estimated) time gap; else distance-based.
 */
export function gapBetween(me, o) {
    const byDistance = me.gapDistance - o.gapDistance;
    const T = me.state && me.state.worldTime;
    const a = leadAt(o, T), b = leadAt(me, T);
    if (a != null && b != null) {
        return {gap: a - b, source: 'aligned', byDistance};
    }
    const timeOk = Number.isFinite(me.gap) && Number.isFinite(o.gap) && !me.isGapEst && !o.isGapEst;
    if (timeOk) {
        const v = Math.max(1, (me.state.speed || 0) / 3.6);
        return {gap: (me.gap - o.gap) * v, source: 'time', byDistance};
    }
    return {gap: byDistance, source: 'distance', byDistance};
}

/*
 * Gap (m) from `athleteId` back to the nearest rider BEHIND on the same road and direction, or null
 * if nobody is within `withinM`. "At the back of the bunch" = null or more than a few metres: the
 * pack data's most efficient place (last rider 2–6 m off the wheel: ~12 W less than inside riders).
 */
export function gapBehind(entries, athleteId, withinM = 25) {
    const me = entries.find(e => e && e.athleteId === athleteId);
    if (!me || !me.state || !Number.isFinite(me.gapDistance)) {
        return null;
    }
    let best = null;
    for (const o of entries) {
        if (!o || o === me || !o.state || !Number.isFinite(o.gapDistance) || o.gapDistance <= me.gapDistance) {
            continue;
        }
        if (o.state.roadId !== me.state.roadId || o.state.reverse !== me.state.reverse) {
            continue;
        }
        const g = gapBetween(o, me).gap;
        if (g >= 0 && g <= withinM && (best == null || g < best)) {
            best = g;
        }
    }
    return best;
}

/*
 * Map athleteId -> {id, gap, gapSource, gapDistance, lane, speed, counts, inline} for every rider with
 * someone ahead of them.
 * `gap` = metres to the nearest rider ahead (time-based where possible, see above).
 * `counts[i]` = riders ahead within AHEAD_WINDOWS_M[i] metres on the same road and direction.
 * `inline` = {id, gap} of the nearest rider ahead who is in line with you (null if none within reach) —
 * the wheel you actually see in front of you, which can differ from the nearest rider beside you.
 */
export function wheelsAhead(entries) {
    const out = new Map();
    const maxWindow = AHEAD_WINDOWS_M[AHEAD_WINDOWS_M.length - 1];
    const placed = entries.filter(e => e && e.state && Number.isFinite(e.gapDistance));
    placed.sort((a, b) => a.gapDistance - b.gapDistance);
    for (let i = 0; i < placed.length; i++) {
        const me = placed[i];
        let nearest = null;
        let inline = null;
        const counts = AHEAD_WINDOWS_M.map(() => 0);
        for (let j = i - 1; j >= 0; j--) {
            const o = placed[j];
            if (o.state.roadId !== me.state.roadId || o.state.reverse !== me.state.reverse) {
                continue;
            }
            const g = gapBetween(me, o);
            // Stop once well past the counting window (by the ordering distance, with slack for
            // the time-based correction).
            if (nearest && g.byDistance > maxWindow + 10) {
                break;
            }
            const gap = Math.max(0, g.gap);
            const lane = (o.state.roadPosition ?? 0) - (me.state.roadPosition ?? 0);
            if (!nearest || gap < nearest.gap) {
                nearest = {id: o.athleteId, gap, gapSource: g.source, gapDistance: g.byDistance, lane,
                           speed: (o.state.speed || 0) / 3.6};
            }
            if (Math.abs(lane) <= INLINE_LANE && (!inline || gap < inline.gap)) {
                inline = {id: o.athleteId, gap, gapSource: g.source, lane, speed: (o.state.speed || 0) / 3.6};
            }
            AHEAD_WINDOWS_M.forEach((w, k) => {
                if (gap <= w) {
                    counts[k]++;
                }
            });
        }
        if (nearest) {
            out.set(me.athleteId, {...nearest, counts, inline});
        }
    }
    return out;
}
