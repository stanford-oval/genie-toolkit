// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
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

import * as child_process from 'child_process';
import { promises as pfs } from 'fs';
import byline from 'byline';

export async function safeRmdir(dir : string) {
    try {
        await pfs.rmdir(dir);
    } catch(e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
}

export async function safeMkdir(dir : string) {
    try {
        await pfs.mkdir(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

interface Job {
    id : string;
    child ?: child_process.ChildProcess|null;
}

interface ExecCommandOptions {
    debug ?: boolean,
    cwd ?: string,
    handleStderr ?: (line : string) => void
}

export function execCommand(argv : string[], options : ExecCommandOptions = {}, job ?: Job) {
    return new Promise<void>((resolve, reject) => {
        const stdio : ['ignore', 'pipe'|'ignore'|'inherit', 'pipe'|'inherit'] = ['ignore',
            job && options.debug ? 'pipe' : options.debug ? 'inherit' : 'ignore',
            job ? 'pipe' : 'inherit'];

        if (options.debug)
            console.log(argv.map((a) => "'" + a + "'").join(' '));

        const [argv0, ...args] = argv;
        const child = child_process.spawn(argv0, args, { stdio, cwd: options.cwd });
        if (job)
            job.child = child;
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (job)
                job.child = null;
            if (signal) {
                if (signal === 'SIGINT' || signal === 'SIGTERM')
                    reject(new Error(`Killed`));
                else
                    reject(new Error(`Command crashed with signal ${signal}`));
            } else {
                if (code !== 0)
                    reject(new Error(`Command exited with code ${code}`));
                else
                    resolve();
            }
        });

        if (job) {
            if (options.debug) {
                child.stdout!.setEncoding('utf-8');
                const stdout = byline(child.stdout!);
                stdout.on('data', (line) => {
                    if (job.id !== undefined)
                        process.stdout.write(`job ${job.id}: ${line}\n`);
                    else
                        process.stdout.write(line + '\n');
                });
            }

            child.stderr!.setEncoding('utf-8');
            const stderr = byline(child.stderr!);
            stderr.on('data', (line) => {
                if (options.debug) {
                    if (job.id !== undefined)
                        process.stderr.write(`job ${job.id}: ${line}\n`);
                    else
                        process.stderr.write(line + '\n');
                }
                if (options.handleStderr)
                    options.handleStderr(line);
            });
        }
    });
}
