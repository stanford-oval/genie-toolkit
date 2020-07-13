// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const fs = require('fs');
const Tp = require('thingpedia');

const DEFAULT_THINGPEDIA_URL = 'https://thingpedia.stanford.edu/thingpedia';

const StreamUtils = require('../lib/utils/stream-utils');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('download-snapshot', {
            addHelp: true,
            description: "Download a snapshot of Thingpedia."
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en',
            help: `BGP 47 locale tag of the natural language to download the snapshot for (defaults to 'en', English)`
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['--entities'], {
            required: true,
            type: fs.createWriteStream,
            help: `Filename where entities should be saved`
        });
        parser.addArgument('--thingpedia-url', {
            required: false,
            defaultValue: DEFAULT_THINGPEDIA_URL,
            help: `base URL of Thingpedia server to contact; defaults to '${DEFAULT_THINGPEDIA_URL}'`
        });
        parser.addArgument('--snapshot', {
            required: false,
            defaultValue: '-1',
            help: `identifier of the Thingpedia snapshot to download (or -1 for the latest snapshot)`
        });
        parser.addArgument('--developer-key', {
            required: false,
            defaultValue: '',
            help: `developer key to use when contacting Thingpedia`
        });
    },

    async execute(args) {
        let deviceUrl = args.thingpedia_url + '/api/v3/snapshot/' + args.snapshot + '?meta=1&locale=' + args.locale;
        if (args.developer_key)
            deviceUrl += '&developer_key=' + args.developer_key;
        let entityUrl = args.thingpedia_url + '/api/v3/entities/all?snapshot=' + args.snapshot + '&locale=' + args.locale;
        if (args.developer_key)
            entityUrl += '&developer_key=' + args.developer_key;

        const [devices, entities] = await Promise.all([
            Tp.Helpers.Http.get(deviceUrl, { accept: 'application/x-thingtalk' }),
            Tp.Helpers.Http.get(entityUrl, { accept: 'application/json' })
        ]);
        args.output.end(devices);
        args.entities.end(JSON.stringify(JSON.parse(entities), undefined, 2));

        await StreamUtils.waitFinish(args.output);
    }
};
