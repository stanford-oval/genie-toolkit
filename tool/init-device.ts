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
    parser.add_argument('name', {
        help: "The name (unique ID) of the new device, in reverse-DNS notation (e.g. com.example.foo)"
    });
}

export async function execute(args : any) {
    try {
        await pfs.rmdir(args.name);
    } catch(e) {
        if (e.code !== 'ENOENT') {
            console.error(`${args.name} already exists and is not an empty directory`);
            return;
        }
    }

    const packageInfo = JSON.parse(await pfs.readFile('./package.json', { encoding: 'utf8' }));

    await pfs.mkdir(args.name);

    await pfs.writeFile(path.resolve(args.name, 'manifest.tt'),
`class @${args.name} {
import loader from @${args.loader}();
import config from @org.thingpedia.config.none();
}
`);
    await execCommand(['git', 'add', path.resolve(args.name, 'manifest.tt')]);

    if (args.loader === 'org.thingpedia.v2') {
        await pfs.writeFile(path.resolve(args.name, 'package.json'), JSON.stringify({
            name: args.name,
            author: packageInfo.author,
            license: packageInfo.license,
            main: 'index.js'
        }));

        await pfs.writeFile(path.resolve(args.name, 'index.js'),
`// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ${args.name}
//
// Copyright ${(new Date).getFullYear()} ${packageInfo.author}
//
// See LICENSE for details
"use strict";

const Tp = require('thingpedia');

module.exports = class extends Tp.BaseDevice {
};
`);

        await execCommand(['yarn'], { cwd: args.name });

        await execCommand(['git', 'add',
            path.resolve(args.name, 'package.json'),
            path.resolve(args.name, 'yarn.lock'),
            path.resolve(args.name, 'index.js')
        ]);
    }

    await pfs.writeFile(`test/${args.name}.js`,
`// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// Copyright ${(new Date).getFullYear()} ${packageInfo.author}
//
// See LICENSE for details
"use strict";

module.exports = [
];
`);
    await execCommand(['git', 'add', `test/${args.name}.js`]);

    await execCommand(['git', 'commit', '-m', `Added ${args.name}`]);

    console.log('Success!');
}
