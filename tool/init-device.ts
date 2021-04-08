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
import { promises as pfs } from 'fs';
import * as path from 'path';

import { execCommand } from '../lib/utils/process-utils';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('init-device', {
        add_help: true,
        description: "Initialize the skeleton for a new Thingpedia device."
    });
    parser.add_argument('--loader', {
        required: false,
        default: 'org.thingpedia.v2',
        help: "The loader to use for the new device (defaults to org.thingpedia.v2)"
    });
    parser.add_argument('--description', {
        help: "The human-readable description of the new device",
        default: 'TODO add description'
    });
    parser.add_argument('--name', {
        help: "The human-readable name of the new device",
    });
    parser.add_argument('class_name', {
        help: "The name (unique ID) of the new device, in reverse-DNS notation (e.g. com.example.foo)"
    });
}

export async function execute(args : any) {
    try {
        await pfs.rmdir(args.class_name);
    } catch(e) {
        if (e.code !== 'ENOENT') {
            console.error(`${args.class_name} already exists and is not an empty directory`);
            return;
        }
    }

    const packageInfo = JSON.parse(await pfs.readFile('./package.json', { encoding: 'utf8' }));

    await pfs.mkdir(args.class_name);

    await pfs.writeFile(path.resolve(args.class_name, 'manifest.tt'),
`class @${args.class_name}
#_[name="${args.name || args.class_name}"]
#_[description="${args.description}"]
#_[thingpedia_name="${args.name || args.class_name}"]
#_[thingpedia_description="${args.description}"]
#[license="${packageInfo.license}"]
#[license_gplcompatible=${packageInfo.license !== 'Proprietary'}]
#[subcategory="service"] {
import loader from @${args.loader}();
import config from @org.thingpedia.config.none();
}
`);

    await pfs.writeFile(path.resolve(args.class_name, 'dataset.tt'),
`dataset @${args.class_name} {
}
`);

    await pfs.mkdir(path.resolve(args.class_name, 'eval'));
    await pfs.mkdir(path.resolve(args.class_name, 'eval/dev'));
    await pfs.writeFile(path.resolve(args.class_name, 'eval/dev/annotated.txt'), '');
    await pfs.mkdir(path.resolve(args.class_name, 'eval/train'));
    await pfs.writeFile(path.resolve(args.class_name, 'eval/train/annotated.txt'), '');
    await pfs.writeFile(path.resolve(args.class_name, 'eval/paraphrase.tsv'), '');

    if (args.loader === 'org.thingpedia.v2') {
        await pfs.writeFile(path.resolve(args.class_name, 'package.json'), JSON.stringify({
            name: args.class_name,
            description: args.name||'',
            author: packageInfo.author,
            license: packageInfo.license,
            main: 'index.js'
        }));

        await pfs.writeFile(path.resolve(args.class_name, 'index.js'),
`// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ${args.class_name}
//
// Copyright ${(new Date).getFullYear()} ${packageInfo.author}
//
// See LICENSE for details
"use strict";

const Tp = require('thingpedia');

module.exports = class extends Tp.BaseDevice {
};
`);

        await execCommand(['npm', 'install'], { debug: true, cwd: args.class_name });
    }

    await execCommand(['git', 'add', args.class_name], { debug: true, });

    await pfs.writeFile(`test/unit/${args.class_name}.js`,
`// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// Copyright ${(new Date).getFullYear()} ${packageInfo.author}
//
// See LICENSE for details
"use strict";

module.exports = [
];
`);
    await execCommand(['git', 'add', `test/unit/${args.class_name}.js`], { debug: true, });

    await execCommand(['git', 'commit', '-m', `Added ${args.class_name}`], { debug: true, });

    console.log('Success!');
}
