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
import { promises as pfs } from 'fs';
import * as path from 'path';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import FormData from 'form-data';
import * as mime from 'mime';

import { getConfig, DEFAULT_THINGPEDIA_URL } from './lib/argutils';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('upload-device', {
        add_help: true,
        description: "Upload a device to Thingpedia."
    });
    parser.add_argument('--thingpedia-url', {
        required: false,
        help: `base URL of Thingpedia server to contact; defaults to '${DEFAULT_THINGPEDIA_URL}'`
    });
    parser.add_argument('--access-token', {
        required: false,
        help: `OAuth access token to use when contacting Thingpedia`
    });
    parser.add_argument('--zipfile', {
        required: false,
        help: "ZIP file to upload."
    });
    parser.add_argument('--icon', {
        required: false,
        help: "Icon file to upload."
    });
    parser.add_argument('--manifest', {
        required: true,
        help: "ThingTalk class definition file."
    });
    parser.add_argument('--dataset', {
        required: true,
        help: "ThingTalk dataset file with the class's primitive templates."
    });
    parser.add_argument('--secrets', {
        required: false,
        help: "JSON file containing secret data for the class configuration mixins."
    });
    parser.add_argument('--approve', {
        action: 'store_true',
        help: "Approve the device automatically (if possible)."
    });
}

export async function execute(args : any) {
    if (!args.thingpedia_url)
        args.thingpedia_url = await getConfig('thingpedia.url', process.env.THINGPEDIA_URL || DEFAULT_THINGPEDIA_URL);
    if (!args.access_token)
        args.access_token = await getConfig('thingpedia.access-token', process.env.THINGPEDIA_ACCESS_TOKEN || null);

    if (!args.access_token)
        throw new Error(`You must pass a valid OAuth access token to talk to Thingpedia`);

    let manifest = await pfs.readFile(args.manifest, { encoding: 'utf8' });
    let parsed;
    try {
        parsed = ThingTalk.Syntax.parse(manifest);
    } catch(e) {
        throw new Error(`Error parsing manifest.tt: ${e.message}`);
    }
    if (!(parsed instanceof ThingTalk.Ast.Library) || parsed.classes.length !== 1)
        throw new Error(`The manifest file must contain exactly one class definition`);

    const classDef = parsed.classes[0];
    const fd = new FormData();

    fd.append('primary_kind', classDef.kind);
    if (classDef.metadata.thingpedia_name)
        fd.append('name', classDef.metadata.thingpedia_name);
    else if (classDef.metadata.name)
        fd.append('name', classDef.metadata.name);
    else
        throw new Error(`Missing required class annotation #_[name]`);
    if (classDef.metadata.thingpedia_description)
        fd.append('description', classDef.metadata.thingpedia_description);
    else if (classDef.metadata.description)
        fd.append('description', classDef.metadata.description);
    else
        throw new Error(`Missing required class annotation #_[description]`);

    for (const annot of ['license', 'license_gplcompatible', 'subcategory']) {
        if (!classDef.annotations[annot])
            throw new Error(`Missing required class annotation #[${annot}]`);

        const value = classDef.annotations[annot].toJS();
        if (typeof value === 'boolean') {
            if (value)
                fd.append(annot, '1');
        } else {
            fd.append(annot, value);
        }
    }
    for (const annot of ['website', 'repository', 'issue_tracker']) {
        if (classDef.annotations[annot])
            fd.append(annot, classDef.annotations[annot].toJS());
    }

    const dataset = await pfs.readFile(args.dataset, { encoding: 'utf8' });
    // sanitiy check it locally
    try {
        ThingTalk.Syntax.parse(dataset);
    } catch(e1) {
        if (e1.name !== 'SyntaxError')
            throw e1;
        try {
            ThingTalk.Syntax.parse(dataset, ThingTalk.Syntax.SyntaxType.Legacy);
            console.log('WARNING: dataset.tt uses legacy syntax, you should migrate to ThingTalk 2.0');
        } catch(e2) {
            if (e2.name !== 'SyntaxError')
                throw e2;
            throw e1;
        }
    }

    if (args.secrets) {
        let secretfile;
        try {
            secretfile = await pfs.readFile(args.secrets, { encoding: 'utf8' });
        } catch(e) {
            // ignore if the file does not exist, even if the argument is specified
            // this helps with scripting through all devices
            if (e.code !== 'ENOENT')
                throw e;
            console.log('WARNING: --secrets file does not exist, ignored');
        }
        if (secretfile) {
            const secrets = JSON.parse(secretfile);

            for (const importstmt of classDef.imports) {
                for (const param of importstmt.in_params) {
                    if (param.value.isUndefined && secrets[param.name])
                        param.value = new ThingTalk.Ast.Value.String(secrets[param.name]);
                }
            }

            // override the manifest with the prettyprinted class
            // this unfortunately discards any comment or source formatting in the manifest
            manifest = classDef.prettyprint();
        }
    }

    fd.append('code', manifest);
    fd.append('dataset', dataset);
    if (args.approve)
        fd.append('approve', '1');

    for (const key of ['zipfile', 'icon']) {
        if (args[key]) {
            const stream = fs.createReadStream(args[key]);
            const filename = path.basename(args[key]);
            const contentType = mime.getType(args[key]);
            fd.append(key, stream, { filename, contentType: contentType || undefined });
        }
    }
    await Tp.Helpers.Http.postStream(args.thingpedia_url + '/api/v3/devices/create', fd, {
        dataContentType:  'multipart/form-data; boundary=' + fd.getBoundary(),
        auth: 'Bearer ' + args.access_token
    });

    console.log('Success!');
}
