/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Saving a recording opens Sauce's save window, so none is saved during an event (v0.46.0; the user, 2026-10-26: "if
 * that thing is going to pop up a save window randomly, make sure that it doesn't happen in the race itself"). The pen
 * is part of the event: a file that ends from the pen to the finish (the warm-up's, when the event's own starts; a Stop
 * you press) waits in the window's crash-safe store and is saved once you finish or leave. Pure: meters.mjs saves.
 *
 *   holdSaves({sg, ended, lastTickMs, nowMs, openedMs}) -> true while saves wait: in an event you haven't finished,
 *       your data fresh (SAVE_STALE_S: Zwift gone, nothing to wait for), or just opened with no data yet (OPEN_WAIT_S:
 *       a window reopened mid-race saves its leftovers only once it knows)
 *   new SaveQueue(save).add({name, blob, done}); run(hold)   one at a time, in order; blob() / done() are async
 */

export const SAVE_STALE_S = 60;
export const OPEN_WAIT_S = 15;

export function holdSaves({sg = null, ended = false, lastTickMs = null, nowMs = Date.now(), openedMs = 0} = {}) {
    if (!lastTickMs) return nowMs - openedMs < OPEN_WAIT_S * 1000;
    return !!sg && !ended && nowMs - lastTickMs < SAVE_STALE_S * 1000;
}

export class SaveQueue {
    constructor(save) {
        this.save = save;     // (blob, name) -> the download
        this.jobs = [];
        this.busy = false;
    }

    get size() {
        return this.jobs.length;
    }

    add(job) {
        this.jobs.push(job);
    }

    /* Save what waits, unless held. Resolves when this run is through. */
    async run(hold) {
        if (hold || this.busy) return;
        this.busy = true;
        try {
            while (this.jobs.length) {
                const job = this.jobs.shift();
                try {
                    this.save(await job.blob(), job.name);
                    await job.done();
                } catch (e) {
                    console.error('save failed: kept for next time', job.name, e);   // left in the store: saved on the next open
                }
            }
        } finally {
            this.busy = false;
        }
    }
}
