// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import * as argparse from 'argparse';
import * as gettextParser from 'gettext-parser';
import { promises as pfs } from 'fs';
import * as path from 'path';

import * as I18n from '../lib/i18n';
import {
    FlagSelect,
    Placeholder,
    Plural,
    Replaceable,
    ValueSelect
} from '../lib/utils/template-string';

function getNonTermNames(tmpl : string) {
    const names : string[] = [];
    const parsed = Replaceable.parse(tmpl);
    parsed.visit((elem) => {
        if (elem instanceof Placeholder ||
            elem instanceof ValueSelect ||
            elem instanceof FlagSelect ||
            elem instanceof Plural) {
            const param = elem.param;
            if (names.includes(param))
                return true;
            names.push(param);
        }
        return true;
    });
    return names;
}

export function initArgparse(subparsers : argparse.SubParser) {
    subparsers.add_parser('lint-po-files', {
        add_help: true,
        description: "Check the syntax of translations in a PO directory."
    });
}

export async function execute() {
    let anyError = false;
    for (const filename of await pfs.readdir('./po')) {
        if (!filename.endsWith('.po'))
            continue;

        const pathname = path.resolve('./po', filename);
        const locale = path.basename(filename, '.po').replace(/[-_.@]/g, '-');
        console.log();
        console.log('##########');
        console.log(`Validating ${locale}`);

        const langPack = I18n.get(locale);
        const pofile = gettextParser.po.parse(await pfs.readFile(pathname, { encoding: 'utf8' }));

        for (const msgctx in pofile.translations) {
            const msgctxtranslation = pofile.translations[msgctx];
            for (const msgid in msgctxtranslation) {
                const translation = msgctxtranslation[msgid];

                // get the placeholder names from the english string
                let names : string[];
                try {
                    names = getNonTermNames(msgid);
                } catch(e) {
                    console.error(`WARNING: failed to parse English string "${msgid}": ${e.message}`);
                    continue;
                }
                if (translation.comments && translation.comments.flag === 'fuzzy')
                    continue;

                for (const msgstr of translation.msgstr) {
                    try {
                        Replaceable.parse(msgstr).preprocess(langPack, names);
                    } catch(e) {
                        console.error(`Failed to validate translation "${msgstr}" for "${msgid}": ${e.message}`);
                        anyError = true;
                    }
                }
            }
        }
    }

    if (anyError)
        process.exit(1);
}
