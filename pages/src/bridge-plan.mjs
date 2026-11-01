/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Planning a bridge to the riders up the road for the least FRC (v0.53.0; the user, 2026-10-31: "a call to warn that the
 * opportunity to bridge is going away. It should take FRC, speed, power of the group ahead, hills, to predict if it is
 * possible, and where the best place would be. If a hill is coming up, that is a natural place to bridge, whereas a
 * descent is a bad place"; "a bridge usually starts with an attack to make sure you don't drag the pack with you";
 * "the goal is to bridge with the least amount of FRC spent").
 *
 * The model, a second at a time along the road ahead (route-ahead.mjs points {d, alt}):
 *   - the riders up the road keep their effort: the power their speed needs now (your body, sheltered by
 *     BRIDGE_PLAN.packDraft), so their speed on each grade follows from it. The gap is kept in SECONDS: equal efforts
 *     keep the time gap, so on a climb the same gap is fewer meters (the climb is where it's cheap), on a descent more
 *   - until you go, you sit in your group: the time gap grows (or shrinks) at today's rate
 *   - you go: an attack of BRIDGE_PLAN.attackS at BRIDGE_PLAN.attackKmh more than your bridge speed (so your group
 *     doesn't come with you), then their speed + dv, alone, until you're on (the gap in meters closed)
 *   - FRC spent = the watts above FTP (no refill: you're above it or close), plus the attack's kinetic energy
 *   - what you can still put out falls as FRC goes (the 3-parameter model's ceiling): FTP + (max power − FTP) × the
 *     share of FRC left, each second. A plan above it is out (the user, 2026-10-31: a "hold 870" in the sprint while
 *     418 W was all there was; with ~5 of 16 kJ left the ceiling is ~500 W)
 *   - toLineM: on before the line, or it isn't a bridge (the finish)
 * Every start every BRIDGE_PLAN.stepM up to BRIDGE_PLAN.lookM ahead × every dv from BRIDGE_PLAN.dvKmh: the cheapest
 * plan that leaves BRIDGE_PLAN.reserveJ, and the furthest start that still works (its window closes there).
 *
 *   planBridge({gapS, rateSps, vGroup, grade, profile, model: {massKg, cda, crr}, ftpW, frcLeftJ, attack (false: already
 *   going, no new attack), pMaxW (your max power), frcCapJ (your whole FRC), toLineM (meters to the finish, or null)})
 *     -> {best, now, lastStartM, lastStartS (null: not enough road ahead to tell)} (best / now: {startM, startS, dvKmh, powerW, attackW, secs, frcJ,
 *        climb (the grade at the start)}) or null when no start works
 */
import {powerComponents, speedForPower} from './engine/physics.mjs';

export const BRIDGE_PLAN = {
    packDraft: 0.3,      // the riders up the road: their air drag × (1 − this) (a small group's shelter)
    attackS: 8, attackKmh: 4,
    dvKmh: [2, 3, 4, 5, 6, 8, 10, 12],   // 1 km/h more "bridged" in 4 min below FTP (10-31 replay): not a bridge
    stepM: 50, lookM: 2000,
    maxS: 120,           // a bridge longer than this isn't one: their pace won't hold that long
    reserveJ: 3000,      // FRC kept back (the sprint window keeps the same)
    onM: 3,              // on their wheel
    pMaxFtp: 4.5,        // your max power when not set: 4.5 × FTP (the user: ~1,050–1,100 W at FTP 234)
    minLookM: 500,       // less road ahead than this: no "last chance" (we can't see when the window closes)
};

// grade at d along the profile (pts {d, alt}, d from you), over ±20 m
function gradeAt(pts, d) {
    if (!pts || pts.length < 2) return null;
    const alt = x => {
        if (x <= pts[0].d) return pts[0].alt;
        for (let i = 1; i < pts.length; i++) {
            if (pts[i].d >= x) {
                const a = pts[i - 1], b = pts[i];
                return a.alt + (b.alt - a.alt) * (x - a.d) / Math.max(1e-6, b.d - a.d);
            }
        }
        return pts.at(-1).alt;
    };
    const gr = (alt(d + 20) - alt(d - 20)) / 40;
    return Number.isFinite(gr) ? gr : null;
}

function simulate(startM, dvKmh, x) {
    const {gapS, rateSps, ftpW, model} = x;
    const P = BRIDGE_PLAN, dv = dvKmh / 3.6, g = x.g, vg = x.vg;
    // until you go: you ride with your group at their speed; the time gap moves at today's rate
    let d = 0, tau = gapS, t = 0;
    while (d < startM) {
        const v = vg(d);
        d += v;
        t += 1;
        tau += rateSps;
        if (tau <= 0 || t > P.lookM) return null;   // they came back to you anyway / never got there
    }
    const startS = t;
    // go: the gap in meters at their speed here, closed at dv (the attack: + attackKmh for attackS)
    let gapM = tau * vg(d), frcJ = 0, secs = 0, attackW = 0, sumW = 0, nW = 0;
    const attackS = x.attack ? P.attackS : 0;
    const v0 = vg(d), vTop = v0 + dv + (attackS ? P.attackKmh / 3.6 : 0);
    if (attackS) frcJ += Math.max(0, 0.5 * model.massKg * (vTop ** 2 - v0 ** 2));   // the jump itself, all from FRC
    while (gapM > P.onM) {
        const vG = vg(d), attacking = secs < attackS;
        const v = vG + dv + (attacking ? P.attackKmh / 3.6 : 0);
        const w = powerComponents({v, grade: g(d), ...model}).solo;
        if (attacking) attackW = Math.max(attackW, w); else { sumW += w; nW++; }
        const cap = ftpW + (x.pMaxW - ftpW) * Math.max(0, x.frcLeftJ - frcJ) / x.frcCapJ;
        if (w > cap) return null;   // more than you have left at that moment
        frcJ += Math.max(0, w - ftpW);
        gapM -= v - vG;
        d += v;
        secs++;
        if (x.toLineM > 0 && d > x.toLineM) return null;   // not on before the line
        if (secs > P.maxS) return null;
    }
    return {startM, startS, dvKmh, secs, frcJ, attackW: Math.round(attackW), powerW: Math.round(nW ? sumW / nW : attackW),
            climb: g(startM)};
}

export function planBridge({gapS, rateSps = 0, vGroup, grade = 0, profile = null, model, ftpW, frcLeftJ, attack = true,
                            pMaxW = null, frcCapJ = null, toLineM = null}) {
    if (!(gapS > 0) || !(vGroup > 1) || !model || !(ftpW > 0) || !Number.isFinite(frcLeftJ)) return null;
    // the riders up the road: the power their speed needs on this grade, sheltered
    const pGroup = powerComponents({v: vGroup, grade, ...model, cda: model.cda * (1 - BRIDGE_PLAN.packDraft)}).solo;
    // grade and their speed by 10 m of road, worked out once
    const gs = new Map(), vs = new Map();
    const g = d => {
        const k = Math.round(d / 10);
        if (!gs.has(k)) { const gr = gradeAt(profile, k * 10); gs.set(k, gr == null ? grade : gr); }
        return gs.get(k);
    };
    const vg = d => {
        const k = Math.round(d / 10);
        if (!vs.has(k)) vs.set(k, speedForPower({power: pGroup, grade: g(d), ...model, draftFraction: BRIDGE_PLAN.packDraft}));
        return vs.get(k);
    };
    const x = {gapS, rateSps, model, ftpW, g, vg, attack, frcLeftJ, toLineM,
               pMaxW: pMaxW > ftpW ? pMaxW : ftpW * BRIDGE_PLAN.pMaxFtp, frcCapJ: frcCapJ > 0 ? frcCapJ : Math.max(frcLeftJ, 1)};
    const budget = frcLeftJ - BRIDGE_PLAN.reserveJ;
    let best = null, now = null, last = null;
    const maxM = Math.min(profile && profile.length ? Math.min(BRIDGE_PLAN.lookM, profile.at(-1).d) : 0, toLineM > 0 ? toLineM : Infinity);
    for (let startM = 0; startM <= maxM; startM += BRIDGE_PLAN.stepM) {
        let here = null;
        for (const dv of BRIDGE_PLAN.dvKmh) {
            const r = simulate(startM, dv, x);
            if (r && r.frcJ <= budget && (!here || r.frcJ < here.frcJ)) here = r;
        }
        if (!here) continue;
        if (startM === 0) now = here;
        if (!best || here.frcJ < best.frcJ - 200) best = here;   // a later start must save 0.2 kJ+ to win
        last = here;
    }
    if (!best) return null;
    // no road ahead to look along (no route, or a road Sauce has no map for): later starts are unknown, not ruled out
    const looked = maxM >= BRIDGE_PLAN.minLookM;
    return {best, now, lastStartM: looked ? last.startM : null, lastStartS: looked ? last.startS : null};
}
