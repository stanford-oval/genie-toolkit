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
import * as fs from 'fs';
import { promises as pfs } from 'fs';
import * as path from 'path';
import * as Tp from 'thingpedia';

import { execCommand } from '../lib/utils/process-utils';
import { waitFinish } from '../lib/utils/stream-utils';
import ProgressBar from './lib/progress_bar';

import { getConfig } from './lib/argutils';

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

    const parentDir = path.dirname(path.resolve(args.output_dir));
    await pfs.mkdir(parentDir, { recursive: true });

    console.log('Downloading skeleton...');
    const zipFile = fs.createWriteStream(path.resolve(parentDir, 'skeleton.zip'));
    const stream = await Tp.Helpers.Http.getStream('https://github.com/stanford-oval/thingpedia-common-devices/archive/skeleton.zip');

    let progbar : ProgressBar|undefined;
    if (stream.headers['content-length'])
        progbar = new ProgressBar(parseFloat(stream.headers['content-length']));

    stream.on('data', (buf) => {
        if (progbar)
            progbar.add(buf.length);
        zipFile.write(buf);
    });
    stream.on('end', () => {
        zipFile.end();
    });

    await waitFinish(zipFile);
    await execCommand(['unzip', 'skeleton.zip'], { cwd: parentDir });
    await pfs.rename(path.resolve(parentDir, 'thingpedia-common-devices-skeleton'), args.output_dir);
    await pfs.unlink(path.resolve(parentDir, 'skeleton.zip'));

    console.log('Initializing Git repository...');
    await execCommand(['git', 'init'], { cwd: args.output_dir });

    await execCommand(['git', 'config', 'thingpedia.url', args.thingpedia_url], { cwd: args.output_dir });
    if (args.developer_key)
        await execCommand(['git', 'config', 'thingpedia.developer-key', args.developer_key], { cwd: args.output_dir });

    if (process.platform === 'darwin') {
        await execCommand(['sed', '-i', '.backup',
        '-e', `s|@@name@@|${name}|`,
        '-e', `s|@@description@@|${args.description}|`,
        '-e', `s|@@author@@|${args.author}|`,
        '-e', `s|@@license@@|${args.license}|`,
        path.resolve(args.output_dir, 'package.json')]);
        await execCommand(['rm', path.resolve(args.output_dir, 'package.json.backup')]);
    }
    else {
        await execCommand(['sed', '-i',
        '-e', `s|@@name@@|${name}|`,
        '-e', `s|@@description@@|${args.description}|`,
        '-e', `s|@@author@@|${args.author}|`,
        '-e', `s|@@license@@|${args.license}|`,
        path.resolve(args.output_dir, 'package.json')]);
    }

    const licenseFD = await pfs.open(path.resolve(args.output_dir, 'LICENSE'), 'w');
    await execCommand(['licejs',
        '-o', args.author,
        '-p', name,
        '-y', String((new Date).getFullYear()),
        LICENSES[args.license]
        ], { stdio: ['ignore', licenseFD.fd, 'inherit'] });
    await licenseFD.close();

    console.log('Creating initial commit...');

    await execCommand(['git', 'add', '.'], { cwd: args.output_dir });
    await execCommand(['git', 'commit', '-m', 'Initial commit'], { cwd: args.output_dir });

    console.log('Installing dependencies...');

    await execCommand(['yarn'], { cwd: args.output_dir });

    console.log('Success!');
}
