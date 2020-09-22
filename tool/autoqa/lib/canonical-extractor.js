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
"use strict";

const assert = require('assert');
const fs = require('fs');
const util = require('util');
const child_process = require('child_process');

const EnglishLanguagePack = require('../../../lib/i18n/american-english');

class AnnotationExtractor {
    constructor(klass, queries, model, options) {
        this.class = klass;
        this.model = model;
        this.queries = queries;
        this.options = options;
        this._langPack = new EnglishLanguagePack();

        this._input = [];
        this._output = [];
        this.newCanonicals = {};
    }

    async run(synonyms, queries) {
        const slices = {};
        for (let qname of this.queries) {
            slices[qname] = {};
            for (let arg in synonyms[qname]) {
                if (arg === 'id' || Object.keys(synonyms[qname][arg]).length === 0)
                    continue;

                const startIndex = this._input.length;
                this.generateInput(synonyms[qname][arg]);
                const endIndex = this._input.length;
                slices[qname][arg] = [startIndex, endIndex];
            }
        }

        await this._paraphrase();
        assert.strictEqual(this._input.length, this._output.length);

        for (let qname of this.queries) {
            const query_canonical = queries[qname]['canonical'];
            for (let arg in synonyms[qname]) {
                const values = queries[qname]['args'][arg]['values'];
                const slice = slices[qname][arg];
                for (let i = slice[0]; i < slice[1]; i++)
                    this.extractCanonical(arg, i, values, query_canonical);
            }

            for (let arg in synonyms[qname]) {
                if (!(arg in this.newCanonicals))
                    continue;

                let canonicals = (this.class.queries[qname] || this.class.actions[qname]).getArgument(arg).metadata.canonical;
                for (let typeNewCanonical in this.newCanonicals[arg]) {
                    for (let newCanonical of this.newCanonicals[arg][typeNewCanonical]) {
                        if (!(newCanonical.startsWith('# ') || newCanonical.endsWith(' #') || newCanonical.includes(' # ')))
                            continue;

                        if (this.hasConflict(arg, newCanonical))
                            continue;

                        if (!canonicals[typeNewCanonical]) {
                            canonicals[typeNewCanonical] = [newCanonical];
                            continue;
                        }
                        if (canonicals[typeNewCanonical].includes(newCanonical))
                            continue;
                        if (newCanonical.endsWith(' #') && canonicals[typeNewCanonical].includes(newCanonical.slice(0, -2)))
                            continue;
                        canonicals[typeNewCanonical].push(newCanonical);
                    }
                }
            }
        }
    }

    hasConflict(currentArg, currentCanonical) {
        for (let arg in this.newCanonicals) {
            if (arg === currentArg)
                continue;
            for (let pos in this.newCanonicals[arg]) {
                for (let canonical of this.newCanonicals[arg][pos]) {
                    if (canonical.replace('#', '').trim() === currentCanonical.replace('#', '').trim())
                        return true;
                }
            }
        }
        return false;
    }

    async _paraphrase() {
        // skip paraphrase when no input generated
        if (this._input.length === 0) {
            this._output = [];
            return;
        }

        // in travis, we skip the paraphrasing step because it's too memory intensive
        if (process.env.CI || process.env.TRAVIS) {
            this._output = this._input.slice();
            return;
        }

        // if debug file exists, use them directly
        if (fs.existsSync(`./paraphraser-out.json`))
            this._output = JSON.parse(fs.readFileSync(`./paraphraser-out.json`, 'utf-8'));

        // genienlp run-paraphrase --input_column 0 --skip_heuristics --model_name_or_path xxx --temperature 1 1 1 --num_beams 4 --pipe_mode
        const args = [
            `run-paraphrase`,
            `--task`, `paraphrase`,
            `--input_column`, `0`,
            `--skip_heuristics`,
            `--model_name_or_path`, this.model,
            `--temperature`, `1`, `1`, `1`,
            `--num_beams`, `4`,
            `--pipe_mode`,
            `--batch_size`, this.options.batch_size
        ];
        const child = child_process.spawn(`genienlp`, args, { stdio: ['pipe', 'pipe', 'inherit'] });

        const output = util.promisify(fs.writeFile);
        if (this.options.debug)
            await output(`./paraphraser-in.tsv`, this._input.join('\n'));

        const stdout = await new Promise((resolve, reject) => {
            child.stdin.write(this._input.join('\n'));
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

        if (this.options.debug)
            await output(`./paraphraser-out.json`, JSON.stringify(JSON.parse(stdout), null, 2));

        this._output = JSON.parse(stdout);
    }

    generateInput(candidates) {
        for (let category in candidates) {
            if (category === 'base')
                continue;
            let canonical = Object.keys(candidates[category])[0];
            for (let sentence of candidates[category][canonical])
                this._input.push(`${sentence}`);
        }
    }

    extractCanonical(arg, index, values, query_canonical) {
        const origin = this._input[index];
        const paraphrases = this._output[index];

        if (!(arg in this.newCanonicals))
            this.newCanonicals[arg] = {};

        const canonical = this.newCanonicals[arg];
        // In case of boolean parameter, values field is empty, skip for now
        if (!values)
            return;
        let value = values.find((v) => origin.includes(v));
        if (!value) {
            // base canonical, do nothing
            return;
        }
        value = value.toLowerCase();

        for (let paraphrase of paraphrases) {
            paraphrase = paraphrase.toLowerCase();

            if (!paraphrase.includes(value))
                continue;

            if (paraphrase.endsWith('.') || paraphrase.endsWith('?') || paraphrase.endsWith('!'))
                paraphrase = paraphrase.slice(0, -1);

            let tags = this._langPack.posTag(paraphrase.split(' '));

            let prefixes = [];
            if (origin.startsWith('who ')) {
                prefixes.push('who ');
                prefixes.push('who\'s ');
            } else {
                let standard_prefix = origin.slice(0, origin.indexOf(query_canonical) + query_canonical.length + 1);
                prefixes.push(standard_prefix);
                let to_replace = origin.includes(`a ${query_canonical}`) ? `a ${query_canonical}` : query_canonical;
                prefixes.push(standard_prefix.replace(to_replace, `${query_canonical}s`));
                prefixes.push(standard_prefix.replace(to_replace, `some ${query_canonical}s`));
                prefixes.push(standard_prefix.replace(to_replace, `all ${query_canonical}s`));
                prefixes.push(standard_prefix.replace(to_replace, `any ${query_canonical}s`));
                prefixes.push(standard_prefix.replace(to_replace, `any ${query_canonical}`));
                prefixes.push(standard_prefix.replace(to_replace, `an ${query_canonical}`));
                prefixes.push(standard_prefix.replace(to_replace, `the ${query_canonical}`));
            }

            for (let prefix of new Set(prefixes)) {
                if (!paraphrase.startsWith(prefix))
                    continue;

                let clause = paraphrase.slice(prefix.length);
                let length = prefix.trim().split(' ').length;

                if (prefix === 'who\'s' || clause.startsWith('is ') || clause.startsWith('are ')) {
                    if (clause.startsWith('is ') || clause.startsWith('are ')) {
                        clause = clause.slice(clause.indexOf(' ') + 1);
                        length += 1;
                    }
                    if (clause.startsWith('a ') || clause.startsWith('an ') || clause.startsWith('the ') ||
                        ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[length + 1])) {
                        canonical['reverse_property'] = canonical['reverse_property'] || [];
                        canonical['reverse_property'].push(clause.replace(value, '#'));
                    } else if (['IN', 'VBN', 'VBG'].includes(tags[length + 1])) {
                        canonical['passive_verb'] = canonical['passive_verb'] || [];
                        canonical['passive_verb'].push(clause.replace(value, '#'));
                    }
                } if (clause.startsWith('with ') || clause.startsWith('has ') || clause.startsWith('have ')) {
                    canonical['property'] = canonical['property'] || [];
                    canonical['property'].push(clause.slice(clause.indexOf(' ') + 1).replace(value, '#'));
                } else if ((clause.startsWith('that ') || clause.startsWith('who ')) && ['VBP', 'VBZ', 'VBD'].includes(tags[length + 1])) {
                    canonical['verb'] = canonical['verb'] || [];
                    canonical['verb'].push(clause.slice(clause.indexOf(' ' + 1)).replace(value, '#'));
                } else if (['VBP', 'VBZ', 'VBD'].includes(tags[length])) {
                    canonical['verb'] = canonical['verb'] || [];
                    canonical['verb'].push(clause.replace(value, '#'));
                }
                break;
            }
        }
    }
}


module.exports = AnnotationExtractor;
