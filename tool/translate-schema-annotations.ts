// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Mehrad Moradshahi <mehrad@cs.stanford.edu>

import * as argparse from 'argparse';
import Gettext from 'node-gettext';
import * as gettextParser from 'gettext-parser';
import assert from 'assert';
import * as fs from 'fs';
import { promises as pfs } from 'fs';
import * as ThingTalk from 'thingtalk';

import * as StreamUtils from "../lib/utils/stream-utils";
import { processLibrary } from './lib/extract-translatable';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('translate-schema-annotations', {
        add_help: true,
        description: "Translate a thingpedia file's annotations to another language."
    });
    parser.add_argument('--po-file', {
        required: true,
        help: 'PO file containing original and translated strings'
    });
    parser.add_argument('input_file', {
        help: 'Input Thingpedia file to read'
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
}

export async function execute(args : any) {
    const code = (await pfs.readFile(args.input_file)).toString();
    const parsed = ThingTalk.Syntax.parse(code, ThingTalk.Syntax.SyntaxType.Normal, {
        locale: 'en-US',
        timezone: 'UTC'
    });
    assert(parsed instanceof ThingTalk.Ast.Library);

    const gt = new Gettext();
    gt.textdomain('schema');

    try {
        const pofile = gettextParser.po.parse(await pfs.readFile(args.po_file, { encoding: 'utf8' }));
        gt.setLocale(pofile.headers.Language);
        gt.addTranslations(pofile.headers.Language, 'schema', pofile);
    } catch(e : any) {
        if (e.code !== 'ENOENT')
            throw e;
        // ignore if the file does not exist
        // this allows using this script for languages that are not supported yet
        // e.g. in a repository where some skills are translated and some are not
        console.log(`WARNING: ${args.po_file} does not exist, no translation will be applied`);
    }

    for (const entry of processLibrary(parsed)) {
        if (entry.context)
            entry.object[entry.field] = gt.pgettext(entry.context, entry.object[entry.field]);
        else
            entry.object[entry.field] = gt.gettext(entry.object[entry.field]);
    }

    if (args.output) {
        args.output.end(parsed.prettyprint());
        await StreamUtils.waitFinish(args.output);
    }

}
