/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Teleports (joining another rider or group, pacer-bot hopping): the rider's map position jumps far beyond what their
 * speed allows, and Zwift sets their speed to the new group's in one step. The 2026-10-03 ride had four (7.4 km,
 * 4.7 km, 674 m, 4.1 km): at the jump the physics reads ±1,500–5,300 W, and for 4–10 s after it power and speed
 * don't match (±200–450 W) while Zwift settles the rider into the group. Anything that turns power into speed (the
 * analyzer's energy windows, Holding, Position, the gap curve) skips SETTLE_S after a jump.
 */

export const SLACK_M = 30;      // position noise allowed beyond speed × time
export const SETTLE_S = 15;

/* Did the rider jump between samples a and b? {wt (ms), x, y (cm, Zwift world), v (m/s)} */
export function jumped(a, b) {
    if (!a || !b || ![a.x, a.y, b.x, b.y].every(Number.isFinite)) return false;
    const dt = (b.wt - a.wt) / 1000;
    if (!(dt > 0)) return false;
    const moved = Math.hypot(b.x - a.x, b.y - a.y) / 100;
    return moved > Math.max(a.v || 0, b.v || 0) * dt + SLACK_M;
}

/*
 * Per-rider: settling(id, sample) is true at a jump and for SETTLE_S after it. With newcomers (default), a rider's
 * first sample counts too: riders join pacer-bot groups all the time and just appear in the nearby list, with no
 * earlier position to see the jump from (the user, 2026-10-03). Riders who merely ride into range lose 15 s, which costs
 * nothing.
 */
export class TeleportGuard {
    constructor({settleS = SETTLE_S, newcomers = true} = {}) {
        this.settleMs = settleS * 1000;
        this.newcomers = newcomers;
        this.last = new Map();     // id -> {wt, x, y, v}
        this.until = new Map();    // id -> wt the rider is settled again
        this.count = 0;
    }

    settling(id, sample) {
        const prev = this.last.get(id);
        if (prev && sample.wt <= prev.wt) return (this.until.get(id) || 0) > sample.wt;
        this.last.set(id, {wt: sample.wt, x: sample.x, y: sample.y, v: sample.v});
        if (!prev && this.newcomers) {
            this.until.set(id, sample.wt + this.settleMs);
        } else if (jumped(prev, sample)) {
            this.until.set(id, sample.wt + this.settleMs);
            this.count++;
        }
        return (this.until.get(id) || 0) > sample.wt;
    }

    forget(id) {
        this.last.delete(id);
        this.until.delete(id);
    }
}
