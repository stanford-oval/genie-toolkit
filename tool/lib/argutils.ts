// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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

import * as fs from 'fs';
import * as stream from 'stream';
import byline from 'byline';
import * as argparse from 'argparse';
import * as child_process from 'child_process';
import * as util from 'util';

import * as StreamUtils from '../../lib/utils/stream-utils';

export function maybeCreateReadStream(filename : string) : stream.Readable {
    if (filename === '-')
        return process.stdin;
    else
        return fs.createReadStream(filename);
}

export function readAllLines(files : stream.Readable[], separator = '') : stream.Readable {
    return StreamUtils.chain(files.map((s) => s.setEncoding('utf8').pipe(byline())), { objectMode: true, separator });
}

export class ActionSetFlag extends argparse.Action {
    'const' ! : boolean;

    call(parser : argparse.ArgumentParser,
         namespace : any,
         values : string[]) : void {
        if (!namespace.flags)
            namespace.flags = {};
        for (const value of values)
            namespace.flags[value] = this.const;
    }
}

export async function getConfig<T>(key : string, _default ?: T) : Promise<string|T|undefined> {
    try {
        const args = ['config', '--get', key];
        const { stdout, stderr } = await util.promisify(child_process.execFile)('git', args);
        process.stderr.write(stderr);
        return stdout.trim() || _default;
    } catch(e) {
        // ignore error if git is not installed
        // also ignore error if the key is not present
        if (e.code !== 'ENOENT' && e.code !== 1)
            throw e;
        return _default;
    }
}

export const DEFAULT_THINGPEDIA_URL = 'https://dev.almond.stanford.edu/thingpedia';
