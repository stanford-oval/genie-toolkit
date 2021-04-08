// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as argparse from 'argparse';
import * as fs from 'fs';
import * as Tp from 'thingpedia';
import * as path from 'path';
import * as util from 'util';
import csvstringify from 'csv-stringify';
import * as JSONStream from 'JSONStream';

import * as StreamUtils from '../lib/utils/stream-utils';

import ProgressBar from './lib/progress_bar';
import { getConfig, DEFAULT_THINGPEDIA_URL } from './lib/argutils';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('download-string-values', {
        add_help: true,
        description: "Download one or more string dataset from Thingpedia."
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language to download the snapshot for (defaults to 'en-US', American English)`
    });
    parser.add_argument('--thingpedia-url', {
        required: false,
        help: `base URL of Thingpedia server to contact; defaults to '${DEFAULT_THINGPEDIA_URL}'`
    });
    parser.add_argument('--developer-key', {
        required: false,
        default: '',
        help: `developer key to use when contacting Thingpedia`
    });
    parser.add_argument('-d', '--output-dir', {
        required: true,
    });
    parser.add_argument('--type', {
        required: false,
        action: 'append',
        default: [],
        help: `identifier of the Thingpedia string datasets to download (if omitted, all string datasets are downloaded)`
    });
    parser.add_argument('--manifest', {
        required: false,
        help: `write a parameter dataset manifest to this location (suitable for Genie)`
    });
    parser.add_argument('--append-manifest', {
        required: false,
        action: 'store_true',
        help: `append to the manifest instead of replacing`
    });

    parser.add_argument('--debug', {
        action: 'store_true',
        help: 'Enable debugging.',
        default: false
    });
    parser.add_argument('--no-debug', {
        action: 'store_false',
        dest: 'debug',
        help: 'Disable debugging.',
    });
}

export async function execute(args : any) {
    if (!args.thingpedia_url)
        args.thingpedia_url = await getConfig('thingpedia.url', process.env.THINGPEDIA_URL || DEFAULT_THINGPEDIA_URL);
    if (!args.developer_key)
        args.developer_key = await getConfig('thingpedia.developer-key', process.env.THINGPEDIA_DEVELOPER_KEY || null);

    await util.promisify(fs.mkdir)(args.output_dir, { recursive: true });

    if (args.type.length === 0) {
        let listUrl = args.thingpedia_url + '/api/v3/strings/all?locale=' + args.locale;
        if (args.developer_key)
            listUrl += '&developer_key=' + args.developer_key;

        args.type = JSON.parse(await Tp.Helpers.Http.get(listUrl, { accept: 'application/json' }))
            .data.map((e : { type : string }) => e.type);
    }

    let progbar : ProgressBar|undefined;
    if (!args.debug) {
        progbar = new ProgressBar(args.type.length);
        // issue an update now to show the progress bar
        progbar.update(0);
    }

    let manifest;
    if (args.manifest)
        manifest = fs.createWriteStream(args.manifest, { flags: args.append_manifest ? 'a' : 'w' });

    let progress = 0;
    for (const type of args.type) {
        let url = args.thingpedia_url + '/api/v3/strings/list/' + type + '?locale=' + args.locale;
        if (args.developer_key)
            url += '&developer_key=' + args.developer_key;

        const outputpath = path.resolve(args.output_dir, type + '.tsv');
        const output = fs.createWriteStream(outputpath);

        if (manifest)
            manifest.write(`string\t${args.locale}\t${type}\t${path.relative(path.dirname(args.manifest), outputpath)}\n`);

        const stream = await Tp.Helpers.Http.getStream(url);

        if (stream.headers['content-length']) {
            const total = parseInt(stream.headers['content-length']);
            let current = 0;
            stream.on('data', (buf) => {
                current += buf.length;
                current = Math.min(current, total);
                if (progbar)
                    progbar.update(progress + (current/total));
            });
        }

        stream
        .pipe(JSONStream.parse('data.*'))
        .pipe(csvstringify({ columns: ['value', 'preprocessed', 'weight'], delimiter:'\t', header: false }))
        .pipe(output);
        await StreamUtils.waitFinish(output);

        progress++;
        if (progbar)
            progbar.update(progress);
    }

    if (manifest) {
        manifest.end();
        await StreamUtils.waitFinish(manifest);
    }
}
