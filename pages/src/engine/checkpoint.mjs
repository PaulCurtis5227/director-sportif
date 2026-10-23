/*
 * Efficiency Meter — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Crash-safe recording. A recording lives in the window's memory until Stop saves it to Downloads, so closing
 * Sauce first used to lose it (2026-10-01: ~50 minutes of a ride). While recording, every CHECKPOINT_S the new
 * lines are gzipped and stored in the window's IndexedDB; a successful save deletes them. When the Data Tap opens
 * and finds a stored recording, it offers to save it.
 *
 * Each chunk is its own gzip member, so the header chunk followed by the line chunks, in order, IS a valid
 * .ndjson.gz file (gunzip reads concatenated members as one stream). Delta-encoded lines depend on everything
 * before them in the file, and the chunks keep all of them in order, so the recovered file decodes like a
 * normally saved one.
 */

export const CHECKPOINT_S = 30;

/* Gzip a string to a Uint8Array (CompressionStream: browsers, Electron, Node >= 18). */
export async function gzip(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/*
 * Storage interface: putRide(ride), putChunk(id, seq, bytes), rides() -> [ride], chunks(id) -> [bytes] in seq
 * order, remove(id). memoryStore() for tests; idbStore() in the window.
 */
export function memoryStore() {
    const rides = new Map();
    const chunks = new Map();
    return {
        async putRide(r) {
            rides.set(r.id, {...r});
        },
        async putChunk(id, seq, bytes) {
            chunks.set(`${id}:${String(seq).padStart(8, '0')}`, bytes);
        },
        async rides() {
            return [...rides.values()];
        },
        async chunks(id) {
            return [...chunks.keys()].filter(k => k.startsWith(`${id}:`)).sort().map(k => chunks.get(k));
        },
        async remove(id) {
            rides.delete(id);
            for (const k of [...chunks.keys()]) {
                if (k.startsWith(`${id}:`)) {
                    chunks.delete(k);
                }
            }
        },
    };
}

const req = r => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
});

export function idbStore(name = 'effm-checkpoints') {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => {
            open.result.createObjectStore('rides', {keyPath: 'id'});
            open.result.createObjectStore('chunks');
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    }));
    const tx = async (stores, mode, fn) => {
        const t = (await db()).transaction(stores, mode);
        const out = await fn(t);
        await new Promise((resolve, reject) => {
            t.oncomplete = resolve;
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        });
        return out;
    };
    const range = id => IDBKeyRange.bound([id, 0], [id, Infinity]);
    return {
        putRide: r => tx(['rides'], 'readwrite', t => req(t.objectStore('rides').put(r))),
        putChunk: (id, seq, bytes) => tx(['chunks'], 'readwrite', t => req(t.objectStore('chunks').put(bytes, [id, seq]))),
        rides: () => tx(['rides'], 'readonly', t => req(t.objectStore('rides').getAll())),
        chunks: id => tx(['chunks'], 'readonly', t => req(t.objectStore('chunks').getAll(range(id)))),
        remove: id => tx(['rides', 'chunks'], 'readwrite', async t => {
            await req(t.objectStore('rides').delete(id));
            await req(t.objectStore('chunks').delete(range(id)));
        }),
    };
}

/*
 * Follows one Recorder (s4z-streams). It reads the recorder's encoded lines (rec._lines) and header
 * (rec._metaLine()), which the stream module keeps internal; this file is the one place that relies on them.
 */
export class Checkpoint {
    /*
     * release: once lines are stored, drop them from the recorder's memory (Recorder.releaseLines), so the window's
     * memory stays flat over a long ride (v0.53.2: the Data Tap died ~50 min into a 2-hour ride holding 614 MB of
     * lines; cause unknown). The full file is then blob(): the stored chunks plus anything not yet stored.
     */
    constructor(store, {name, rec, release = false}) {
        this.store = store;
        this.rec = rec;
        this.id = rec.startedAt;
        this.name = name;
        this.release = release && typeof rec.releaseLines === 'function';
        this.saved = 0;      // lines stored so far (counting released ones)
        this.seq = 0;
        this.busy = null;
    }

    _unsaved() {
        const lines = this.rec._lines;
        return lines.slice(this.saved - (this.rec._released || 0), lines.length);
    }

    async begin() {
        await this.store.putRide({id: this.id, name: this.name, startedAt: this.rec.startedAt,
                                  updatedAt: Date.now(), lines: 0, bytes: 0});
        await this.store.putChunk(this.id, this.seq++, await gzip(this.rec._metaLine() + '\n'));
    }

    /* Store the lines added since the last flush. Overlapping calls wait for the one in flight. */
    flush() {
        this.busy = (this.busy || Promise.resolve()).then(async () => {
            const chunk = this._unsaved();
            if (!chunk.length) {
                return;
            }
            const n = this.saved + chunk.length;
            const bytes = await gzip(chunk.join('\n') + '\n');
            await this.store.putChunk(this.id, this.seq++, bytes);
            this.saved = n;
            this.bytes = (this.bytes || 0) + bytes.length;
            if (this.release) {
                this.rec.releaseLines(n - (this.rec._released || 0));
            }
            await this.store.putRide({id: this.id, name: this.name, startedAt: this.rec.startedAt,
                                      updatedAt: Date.now(), lines: n, bytes: this.bytes});
        });
        return this.busy;
    }

    /* The whole recording as a gzip Blob: the stored chunks, then whatever isn't stored yet (if a flush failed). */
    async blob() {
        await this.busy?.catch(() => {});
        const parts = await this.store.chunks(this.id);
        const rest = this._unsaved();
        if (rest.length) {
            parts.push(await gzip(rest.join('\n') + '\n'));
        }
        return new Blob(parts, {type: 'application/gzip'});
    }

    async discard() {
        await this.busy;
        await this.store.remove(this.id);
    }
}

/* Recordings left in the store (not the one being recorded now), newest first. */
export async function leftovers(store, exceptId = null) {
    const rs = (await store.rides()).filter(r => r.id !== exceptId);
    return rs.sort((a, b) => b.startedAt - a.startedAt);
}

/* A stored recording as a gzip Blob, ready to download as <name>.ndjson.gz. */
export async function recoveredBlob(store, id) {
    return new Blob(await store.chunks(id), {type: 'application/gzip'});
}
