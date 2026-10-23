/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The release zip writer: read back with a tiny reader (central directory -> inflate), names and bytes intact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {zipFiles, crc32} from '../scripts/zip.mjs';

function unzip(buf) {
    const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const n = buf.readUInt16LE(end + 10);
    let p = buf.readUInt32LE(end + 16);
    const out = [];
    for (let i = 0; i < n; i++) {
        assert.equal(buf.readUInt32LE(p), 0x02014b50);
        const csize = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
        const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
        const dataAt = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
        const data = zlib.inflateRawSync(buf.subarray(dataAt, dataAt + csize));
        assert.equal(crc32(data), buf.readUInt32LE(p + 16));
        out.push({name, data});
        p += 46 + nameLen;
    }
    return out;
}

test('zip round trip: names (UTF-8) and contents', () => {
    const files = [{name: 'director-sportif/manifest.json', data: Buffer.from('{"id":"x"}')},
                   {name: 'director-sportif/pages/grid — ü.css', data: Buffer.alloc(5000, 'a')},
                   {name: 'director-sportif/empty.txt', data: Buffer.alloc(0)}];
    const back = unzip(zipFiles(files));
    assert.deepEqual(back.map(f => f.name), files.map(f => f.name));
    back.forEach((f, i) => assert.ok(f.data.equals(files[i].data)));
});

test('crc32 matches the standard check value', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});
