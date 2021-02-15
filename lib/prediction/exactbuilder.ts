// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import * as path from 'path';
import { promises as pfs } from 'fs';
import * as Tp from 'thingpedia';
import { SchemaRetriever } from 'thingtalk';
import * as seedrandom from 'seedrandom';

import { BTrieBuilder } from '../utils/btrie';
import { BasicSentenceGenerator } from '../sentence-generator/batch';
import { SentenceExample } from '../dataset-tools/parsers';

import ExactMatcher from './exact';

let TEMPLATE_FILE_PATH : string;
try {
    // try the path relative to our build location first (in dist/lib/dialogue-agent)
    TEMPLATE_FILE_PATH = require.resolve('../../../languages-dist/thingtalk/en/basic.genie');
} catch(e) {
    if (e.code !== 'MODULE_NOT_FOUND')
        throw e;
    try {
        // if that fails, try the location relative to our source directory
        // (in case we're running with ts-node)
        TEMPLATE_FILE_PATH = require.resolve('../../languages-dist/thingtalk/en/basic.genie');
    } catch(e) {
        if (e.code !== 'MODULE_NOT_FOUND')
            throw e;
        // if that still fails, we're probably in the "compile-template" call
        // in a clean build, so set ourselves empty (it will not matter)
        TEMPLATE_FILE_PATH = '';
    }
}
const SYNTHETIC_DEPTH = 8;
const TARGET_PRUNING_SIZE = 1000;

async function safeGetMTime(filename : string) : Promise<number> {
    try {
        const stat = await pfs.stat(filename);
        return stat.mtimeMs;
    } catch(e) {
        if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR')
            throw e;
        return 0;
    }
}

interface ExactMatchBuilderOptions {
    locale : string;
    timezone : string|undefined;
    cachedir : string;
    developerdir : string[];
    thingpediaClient : Tp.BaseClient;
}

/**
 * Build an exact matcher for a set of devices in the developer directory.
 *
 */
export default class ExactMatchBuilder {
    private _locale : string;
    private _timezone : string|undefined;
    private _cachefile : string;
    private _developerdir : string[];
    private _matcher : ExactMatcher;
    private _tpClient : Tp.BaseClient;
    private _rng : () => number;

    constructor(options : ExactMatchBuilderOptions) {
        this._locale = options.locale;
        this._timezone = options.timezone;
        this._cachefile = path.resolve(options.cachedir, 'exact-' + options.locale + '.btrie');
        this._developerdir = options.developerdir;
        this._tpClient = options.thingpediaClient;
        this._rng = seedrandom.alea('almond is awesome');

        this._matcher = new ExactMatcher();
    }

    private async _getDeveloperDirMTime() : Promise<[number, string[]]> {
        let mtime = 0;
        const devices : string[] = [];
        for (const dir of this._developerdir) {
            for (const device of await pfs.readdir(dir)) {
                const manifest = path.resolve(dir, device, 'manifest.tt');
                const dataset = path.resolve(dir, device, 'dataset.tt');

                const manifestmtime = await safeGetMTime(manifest);
                mtime = Math.max(mtime, manifestmtime);
                mtime = Math.max(mtime, await safeGetMTime(dataset));
                if (manifestmtime > 0)
                    devices.push(device);
            }
        }
        return [mtime, devices];
    }

    private _generateExact(forDevices : string[]) {
        const schemas = new SchemaRetriever(this._tpClient, null, true);
        const generatorOptions = {
            contextual: false,
            rootSymbol: '$root',
            flags: {
                bookkeeping: true,
                unbalanced: true,
            },
            rng: this._rng,
            locale: this._locale,
            timezone: this._timezone,
            templateFiles: [TEMPLATE_FILE_PATH],
            thingpediaClient: this._tpClient,
            schemaRetriever: schemas,
            onlyDevices: forDevices,
            maxDepth: SYNTHETIC_DEPTH,
            maxConstants: 5,
            targetPruningSize: TARGET_PRUNING_SIZE,
            debug: 1,
        };
        return new BasicSentenceGenerator(generatorOptions);
    }

    async load() : Promise<ExactMatcher> {
        this._matcher.clear();

        const [devdirmtime, devices] = await this._getDeveloperDirMTime();
        const existing = await safeGetMTime(this._cachefile);
        if (existing >= devdirmtime) {
            await this._matcher.load(this._cachefile);
            return this._matcher;
        }
        if (devdirmtime === 0) {
            // nothing in the developer directory
            return this._matcher;
        }

        console.log('Cached exact matcher is missing or stale, regenerating...');

        const builder = new BTrieBuilder((existing : string|undefined, newValue : string) => {
            if (existing === undefined)
                return newValue;
            else
                return existing + '\0' + newValue;
        });
        const sentenceStream = this._generateExact(devices);
        const tmp = new ExactMatcher();
        sentenceStream.on('data', (ex : SentenceExample) => {
            tmp.add(ex.preprocessed.split(' '), String(ex.target_code).split(' '));
        });
        await new Promise<void>((resolve, reject) => {
            sentenceStream.on('end', resolve);
            sentenceStream.on('error', reject);
        });
        for (const [key, value] of tmp)
            builder.insert(key, value);

        await pfs.writeFile(this._cachefile, builder.build());
        await this._matcher.load(this._cachefile);
        return this._matcher;
    }
}
