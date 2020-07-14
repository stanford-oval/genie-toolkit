// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

const child_process = require('child_process');
const util = require('util');
const fs = require('fs');
const byline = require('byline');

async function safeRmdir(dir) {
    try {
        await util.promisify(fs.rmdir)(dir);
    } catch(e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
}

async function safeMkdir(dir) {
    try {
        await util.promisify(fs.mkdir)(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

function execCommand(job, script, argv, handleStderr = null) {
    return new Promise((resolve, reject) => {
        const stdio = ['ignore', job.debug ? 'pipe' : 'ignore', 'pipe'];

        if (job.debug)
            console.log(`${script} ${argv.map((a) => "'" + a + "'").join(' ')}`);
        const env = {};
        Object.assign(env, process.env);
        env.THINGPEDIA_URL = job.thingpediaUrl;
        
        const child = child_process.spawn(script, argv, { stdio, env });
        job.child = child;
        child.on('error', reject);
        child.on('exit', (code, signal) => {
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

        if (job.debug) {
            child.stdio[1].setEncoding('utf-8');
            let stdout = byline(child.stdio[1]);
            stdout.on('data', (line) => {
                if (job.id !== undefined)
                    process.stdout.write(`job ${job.id}: ${line}\n`);
                else
                    process.stdout.write(line + '\n');
            });
        }

        child.stdio[2].setEncoding('utf-8');
        let stderr = byline(child.stdio[2]);
        stderr.on('data', (line) => {
            if (job.debug) {
                if (job.id !== undefined)
                    process.stderr.write(`job ${job.id}: ${line}\n`);
                else
                    process.stderr.write(line + '\n');
            }
            if (handleStderr)
                handleStderr(line);
        });
    });
}

module.exports = {
    safeRmdir,
    safeMkdir,
    execCommand
};
