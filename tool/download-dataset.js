// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const Tp = require('thingpedia');

const DEFAULT_THINGPEDIA_URL = 'https://thingpedia.stanford.edu/thingpedia';

function waitFinish(stream) {
    return new Promise((resolve, reject) => {
        stream.once('finish', resolve);
        stream.on('error', reject);
    });
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('download-dataset', {
            addHelp: true,
            description: "Download primitive templates from Thingpedia."
        });
        parser.addArgument(['-l', '--language'], {
            required: false,
            defaultValue: 'en',
            help: `2-letter ISO code of natural language to download the snapshot for (defaults to 'en', English)`
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--thingpedia-url', {
            required: false,
            defaultValue: DEFAULT_THINGPEDIA_URL,
            help: `base URL of Thingpedia server to contact; defaults to '${DEFAULT_THINGPEDIA_URL}'`
        });
        parser.addArgument('--developer-key', {
            required: false,
            defaultValue: '',
            help: `developer key to use when contacting Thingpedia`
        });
    },

    async execute(args) {
        let url = args.thingpedia_url + '/api/v3/examples/all?locale=' + args.language;
        if (args.developer_key)
            url += '&developer_key=' + args.developer_key;

        args.output.end(await Tp.Helpers.Http.get(url, { accept: 'application/x-thingtalk' }));
        await waitFinish(args.output);
    }
};
