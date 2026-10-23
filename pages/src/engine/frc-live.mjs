/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * FRC balance (functional reserve capacity, WKO5's name for W′): how much of your above-FTP reserve is left.
 *
 * Above FTP the reserve drains at (power − FTP). Below FTP it refills in proportion to how far below FTP you are
 * (Skiba's differential W′ balance): refill rate = (FTP − power) × deficit / FRC, i.e. the deficit decays by
 * e^(−(FTP − P)·dt / FRC). Coasting at ~100 W with FTP 234 W / FRC 16 kJ refills with a ~2-minute time constant;
 * riding at 225 W barely refills at all, so over-unders around FTP drain you instead of "recovering".
 *
 * Why this model (2026-10-01): a constant refill speed (what the user's WKO5 dFRC chart behaves like; 135 s fits
 * it) refills just as fast at 230 W as when coasting, so 5 × (3 min at 250 W / 3 min at 220 W) leaves it at
 * 15.0 of 16 kJ; this model leaves 6.8 kJ. The user never trusted WKO's refill near FTP. On the Innsbruck race
 * (FTP 234 W, FRC 16 kJ) this model's climb lows are 0.9 / 4.3 / 4.0 kJ against WKO's ~2.5 / ~5 / ~4.8, a bit more
 * cautious. The Skiba-2 time-constant model refilled far too slowly for this rider: below zero on every climb.
 * Set your own FTP and FRC from WKO5 (or similar) in the Data Tap; the defaults are only placeholders.
 */

export const FRC_DEFAULT_KJ = 15;   // placeholder until the rider sets theirs
const MAX_DT_S = 3;                // a gap in the data doesn't count as minutes above or below FTP

export class FrcBalance {
    constructor() {
        this.deficitJ = 0;
        this.lowJ = null;      // lowest "left" since reset
        this.lastWt = null;
    }

    reset() {
        this.deficitJ = 0;
        this.lowJ = null;
    }

    /* wt: worldTime ms; power W; ftpW; frcJ. Returns the readout. */
    update(wt, power, {ftpW, frcJ}) {
        if (this.lastWt != null && wt > this.lastWt && Number.isFinite(power) && ftpW > 0 && frcJ > 0) {
            const dt = Math.min((wt - this.lastWt) / 1000, MAX_DT_S);
            if (power > ftpW) {
                this.deficitJ += (power - ftpW) * dt;
            } else {
                this.deficitJ *= Math.exp(-(ftpW - power) * dt / frcJ);
            }
        }
        if (this.lastWt == null || wt > this.lastWt) {
            this.lastWt = wt;
        }
        return this.read({frcJ});
    }

    read({frcJ}) {
        const leftJ = frcJ - this.deficitJ;
        if (this.lowJ == null || leftJ < this.lowJ) {
            this.lowJ = leftJ;
        }
        return {leftJ, frac: frcJ > 0 ? leftJ / frcJ : null, lowJ: this.lowJ, deficitJ: this.deficitJ};
    }

    /* Seconds you could hold `watts` from what is left (above FTP only). */
    static secondsAt(leftJ, watts, ftpW) {
        return watts > ftpW ? Math.max(0, leftJ) / (watts - ftpW) : Infinity;
    }
}
