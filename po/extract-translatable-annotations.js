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

const ThingTalk = require('thingtalk');
const fs = require('fs');
const util = require('util');

function stringEscape(str) {
    if (str === null || str === undefined)
        return 'null';
    return '"' + str.replace(/(["\\])/g, '\\$1').replace(/\n/g, '\\n') + '"';
    // the following comment fixes broken syntax highlighting in GtkSourceView
    //]/
}

function extract(key, str) {
    if (typeof str === 'string') {
        console.log(`/* ${key} */`);
        console.log(`var x = _(${stringEscape(str)});`);
    } else if (Array.isArray(str)) {
        for (let i = 0; i < str.length; i++)
            extract(`${key}[${i}]`, str[i]);
    } else if (typeof str === 'object') {
        for (let subkey in str) {
            if (subkey === 'type')
                continue;
            extract(`${key}.${subkey}`, str[subkey]);
        }
    } else {
        throw new TypeError(`Invalid translatable entry ${str}`);
    }
}

async function main() {
    const code = (await util.promisify(fs.readFile)(process.argv[2])).toString();
    const parsed = ThingTalk.Grammar.parse(code);

    for (let _class of parsed.classes) {
        for (let key in _class.metadata)
            extract(`${key}`, _class.metadata[key]);
        for (let what of ['queries', 'actions']) {
            for (let name in _class[what]) {
                for (let key in _class[what][name].metadata)
                    extract(`${what}.${name}.${key}`, _class[what][name].metadata[key]);

                for (let argname of _class[what][name].args) {
                    let arg = _class[what][name].getArgument(argname);

                    for (let key in arg.metadata)
                        extract(`${what}.${name}.args.${argname}.${key}`, arg.metadata[key]);
                }
            }
        }
    }
}
main();
