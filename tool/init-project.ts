// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Thingpedia
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

import * as argparse from 'argparse';
import { promises as pfs } from 'fs';
import * as path from 'path';
import * as util from 'util';

import * as licejs from 'lice-js';

import { execCommand } from '../lib/utils/process-utils';

import { getConfig, DEFAULT_THINGPEDIA_URL } from './lib/argutils';

const LICENSES : Record<string, string> = {
    'BSD-3-Clause': 'bsd3',
    'BSD-2-Clause': 'bsd2',
    'MIT': 'mit',
    'CC0': 'cc0',
    'Apache-2.0': 'apache',
    'GPL-3.0': 'gpl3',
    'GPL-2.0': 'gpl2',
    'ISC': 'isc'
};

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('init-project', {
        add_help: true,
        description: "Initialize a repository to develop Thingpedia devices."
    });
    parser.add_argument('--thingpedia-url', {
        required: false,
        default: DEFAULT_THINGPEDIA_URL,
        help: `base URL of Thingpedia server to contact; defaults to '${DEFAULT_THINGPEDIA_URL}'`
    });
    parser.add_argument('--developer-key', {
        required: false,
        default: '',
        help: `developer key to use when contacting Thingpedia`
    });
    parser.add_argument('--description', {
        required: false,
        default: '',
        help: "A description for the repository"
    });
    parser.add_argument('--author', {
        required: false,
        help: "The name and email to use as the author and copyright owner"
    });
    parser.add_argument('--license', {
        required: false,
        default: 'BSD-3-Clause',
        choices: Object.keys(LICENSES),
        help: "The code license to use for the repository, as a SPDX identifier (defaults to BSD-3-Clause)"
    });
    parser.add_argument('output_dir', {
    });
}

async function copyTree(from : string, to : string) {
    for await (const entry of await pfs.opendir(from)) {
        if (entry.isDirectory()) {
            await pfs.mkdir(path.resolve(to, entry.name));
            await copyTree(path.resolve(from, entry.name), path.resolve(to, entry.name));
        } else if (entry.isSymbolicLink()) {
            const link = await pfs.readlink(path.resolve(from, entry.name));
            await pfs.symlink(path.relative(from, link), path.resolve(to, entry.name));
        } else {
            await pfs.copyFile(path.resolve(from, entry.name), path.resolve(to, entry.name));
        }
    }
}

export async function execute(args : any) {
    try {
        await pfs.rmdir(args.output_dir);
    } catch(e) {
        if (e.code !== 'ENOENT') {
            console.error(`${args.output_dir} already exists and is not an empty directory`);
            return;
        }
    }

    const name = path.basename(args.output_dir);

    if (!args.author)
        args.author = `${await getConfig('user.name')} <${await getConfig('user.email')}>`;

    await pfs.mkdir(args.output_dir, { recursive: true });

    console.log('Initializing Git repository...');
    await execCommand(['git', 'init'], { debug: true, cwd: args.output_dir });

    await execCommand(['git', 'config', 'thingpedia.url', args.thingpedia_url], { debug: true, cwd: args.output_dir });
    if (args.developer_key)
        await execCommand(['git', 'config', 'thingpedia.developer-key', args.developer_key], { debug: true, cwd: args.output_dir });

    console.log('Copying skeleton code...');
    await copyTree(path.resolve(path.dirname(module.filename), '../../starter/custom'), args.output_dir);

    console.log('Writing metadata...');

    const ourPackageJSON = JSON.parse(await pfs.readFile(path.resolve(path.dirname(module.filename), '../../package.json'), { encoding: 'utf8' }));

    const ourdeps : Record<string, string> = {};
    for (const dep of ['thingpedia', 'uuid', 'byline', 'seedrandom', 'argparse', 'eslint'])
        ourdeps[dep] = ourPackageJSON.dependencies[dep] || ourPackageJSON.devDependencies[dep];

    const packageJSON = {
        name: name,
        description: args.description,
        version: '0.0.1',
        author: args.author,
        license: args.license,
        devDependencies: {
            'genie-toolkit': '^' + ourPackageJSON.version,
            ...ourdeps
        }
    };
    await pfs.writeFile(path.resolve(args.output_dir, 'package.json'), JSON.stringify(packageJSON, undefined, 2));

    const license = await util.promisify(licejs.createLicense)(LICENSES[args.license], {
        year: String((new Date).getFullYear()),
        organization:  args.author,
        project: name,
        header: false
    });
    await pfs.writeFile(path.resolve(args.output_dir, 'LICENSE'), license.body!);

    console.log('Installing dependencies...');

    await execCommand(['npm', 'install'], { debug: true, cwd: args.output_dir });

    console.log('Creating initial commit...');

    await execCommand(['git', 'add', '.'], { debug: true, cwd: args.output_dir });
    await execCommand(['git', 'commit', '-m', 'Initial commit'], { debug: true, cwd: args.output_dir });

    console.log('Success!');
}
