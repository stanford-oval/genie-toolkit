// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Silei Xu <silei@cs.stanford.edu>

import fs from 'fs';
import util from 'util';
import * as child_process from 'child_process';
import { ParaphraseExample } from './canonical-example-constructor';

interface ParaphraserOptions {
    batch_size : number,
    debug : boolean;
}

export default class Paraphraser {
    private model : string;
    private options : ParaphraserOptions;

    constructor(model : string, options : ParaphraserOptions) {
        this.model = model;
        this.options = options;
    }

    async paraphrase(examples : ParaphraseExample[]) {
        // skip paraphrase when no input generated
        if (examples.length === 0)
            return;
        // in travis, we skip the paraphrasing step because it's too memory intensive
        if (process.env.CI || process.env.TRAVIS) 
            return;

        // output paraphrase input 
        if (this.options.debug) {
            const output = util.promisify(fs.writeFile);
            await output('./paraphraser-in.json', JSON.stringify(examples.map((e) => {
                return { utterance: e.utterance, arg: e.argument, value: e.value ?? null };
            }), null, 2));
        }

        // call genienlp to run paraphrase
        const args = [
            `run-paraphrase`,
            `--task`, `paraphrase`,
            `--input_column`, `0`,
            `--skip_heuristics`,
            `--model_name_or_path`, this.model,
            `--temperature`, `1`, `1`, `1`,
            `--num_beams`, `4`,
            `--pipe_mode`,
            `--batch_size`, this.options.batch_size.toString()
        ];
        const child = child_process.spawn(`genienlp`, args, { stdio: ['pipe', 'pipe', 'inherit'] });
        const stdout : string = await new Promise((resolve, reject) => {
            child.stdin.write(examples.map((ex) => ex.utterance).join('\n'));
            child.stdin.end();
            child.on('error', reject);
            child.stdout.on('error', reject);
            child.stdout.setEncoding('utf8');
            let buffer = '';
            child.stdout.on('data', (data) => {
                buffer += data;
            });
            child.stdout.on('end', () => resolve(buffer));
        });
        const paraphrases = JSON.parse(stdout);
        for (let i = 0; i < examples.length; i++) 
            examples[i].paraphrases = paraphrases[i];

        // output paraphrase result 
        if (this.options.debug) {
            const output = util.promisify(fs.writeFile);
            try {
                await output(`./paraphraser-out.json`, JSON.stringify(JSON.parse(stdout), null, 2));               
            } catch(e) {
                await output(`./paraphraser-out.txt`, stdout);
                throw new Error(e);
            }
        }
    }
}