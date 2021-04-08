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
// Author: Silei Xu <silei@cs.stanford.edu>

import * as argparse from 'argparse';
import * as Tp from 'thingpedia';
import * as fs from 'fs';
import FormData from 'form-data';

import { getConfig, DEFAULT_THINGPEDIA_URL } from './lib/argutils';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('upload-string-values', {
        add_help: true,
        description: "Upload a string value dataset to Thingpedia."
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language (defaults to 'en-US', American English)`
    });
    parser.add_argument('--thingpedia-url', {
        required: false,
        help: `base URL of Thingpedia server to contact; defaults to '${DEFAULT_THINGPEDIA_URL}'`
    });
    parser.add_argument('--access-token', {
        required: false,
        help: `OAuth access token to use when contacting Thingpedia`
    });
    parser.add_argument('input_file', {
        help: "The .tsv file of the string values to upload."
    });
    parser.add_argument('--type-name', {
        required: true,
        help: "The id (type) of the string dataset."
    });
    parser.add_argument('--name', {
        required: true,
        help: "The name of the string dataset."
    });
    parser.add_argument('--license', {
        required: false,
        choices: ['public-domain', 'free-permissive', 'free-copyleft', 'non-commercial', 'proprietary'],
        default: "public-domain",
        help: "The license of the string dataset."
    });
    parser.add_argument('--preprocessed', {
        action: 'store_true',
        help: 'If the values are already tokenized.',
        default: false
    });
}

function createUpload(args : any) {
    const fd = new FormData();
    fd.append('upload', fs.createReadStream(args.input_file), {
        filename: 'strings.tsv',
        contentType: 'text/tab-separated-values;charset=utf8'
    });
    for (const key of ['type_name', 'name', 'license', 'preprocessed'])
        fd.append(key, args[key]);
    return fd;
}

export async function execute(args : any) {
    if (!args.thingpedia_url)
        args.thingpedia_url = await getConfig('thingpedia.url', process.env.THINGPEDIA_URL || DEFAULT_THINGPEDIA_URL);
    if (!args.access_token)
        args.access_token = await getConfig('thingpedia.access-token', process.env.THINGPEDIA_ACCESS_TOKEN || null);

    if (!args.access_token)
        throw new Error(`You must pass a valid OAuth access token to talk to Thingpedia`);

    args.preprocessed = args.preprocessed ? '1' : '';
    const fd = createUpload(args);
    await Tp.Helpers.Http.postStream(args.thingpedia_url + '/api/v3/strings/upload', fd, {
        dataContentType:  'multipart/form-data; boundary=' + fd.getBoundary(),
        auth: 'Bearer ' + args.access_token
    });

    console.log('Success!');
}
