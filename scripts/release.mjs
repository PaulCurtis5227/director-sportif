/*
 * Director Sportif — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. This program is distributed WITHOUT ANY WARRANTY;
 * see the GNU General Public License <https://www.gnu.org/licenses/> for details.
 *
 * The release download: dist/director-sportif-<version>.zip, holding one director-sportif/ folder (the same files as
 * npm run build). Riders unzip it into Documents\SauceMods.
 */
import fs from 'node:fs';
import path from 'node:path';
import {repoRoot, modId, manifest, copyTree} from './_common.mjs';
import {zipFiles} from './zip.mjs';

const stage = path.join(repoRoot, 'dist', modId);
fs.rmSync(stage, {recursive: true, force: true});
copyTree(repoRoot, stage);

const walk = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), {withFileTypes: true})
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(d => (d.isDirectory() ? walk(dir, path.join(rel, d.name)) : [path.join(rel, d.name)]));
const files = walk(stage).map(rel => ({name: path.posix.join(modId, ...rel.split(path.sep)),
                                       data: fs.readFileSync(path.join(stage, rel))}));
const out = path.join(repoRoot, 'dist', `${modId}-${manifest.version}.zip`);
fs.writeFileSync(out, zipFiles(files));
console.log(`release: ${files.length} files -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
