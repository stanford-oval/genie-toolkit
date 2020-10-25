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

import assert from 'assert';
import * as fs from 'fs';
import * as util from 'util';
import * as child_process from 'child_process';
import stemmer from 'stemmer';

import EnglishLanguagePack from '../../../lib/i18n/american-english';

const VALUE_MAP = {
    "1": ["one"],
    "2": ["two"],
    "3": ["three"],
    "4": ["four"],
    "feb 14 2017": ["february 14 2017", "february 14, 2017", "feb 14, 2017", "14 february 2017", "14 february, 2017", "14 feb 2017", "14 feb, 2017"],
    "may 4th, 2016": ["may 4 2016", "may 4, 2016", "may 4th 2016", "4th may 2016", "4th may, 2016", "4 may 2016", "4 may, 2016"],
    "august 2nd 2017": ["august 2, 2017", "august 2 2017", "august 2nd, 2017", "2 august 2017", "2nd august 2017", "2 august, 2017", "2nd august, 2017"]
};

export default class AnnotationExtractor {
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
            const query_canonical = Array.isArray(queries[qname]['canonical']) ? queries[qname]['canonical'][0] : queries[qname]['canonical'];
            for (let arg in synonyms[qname]) {
                const values = queries[qname]['args'][arg]['values'];
                const slice = slices[qname][arg];
                for (let i = slice[0]; i < slice[1]; i++)
                    this.extractCanonical(arg, i, values, query_canonical);
            }

            for (let arg in synonyms[qname]) {
                if (!(arg in this.newCanonicals))
                    continue;

                const wordCounter = this.countWords(this.newCanonicals[arg]);
                let canonicals = (this.class.queries[qname] || this.class.actions[qname]).getArgument(arg).metadata.canonical;
                for (let typeNewCanonical in this.newCanonicals[arg]) {
                    const candidates = this.filterCandidates(typeNewCanonical, this.newCanonicals[arg][typeNewCanonical], wordCounter);
                    for (let newCanonical of candidates) {
                        if (this.hasConflict(qname, arg, typeNewCanonical, newCanonical))
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

    countWords(candidates) {
        const counter = {};
        for (let pos in candidates) {
            for (let candidate of candidates[pos]) {
                for (let word of candidate.split(' '))
                    counter[word] = (counter[word] || 0) + 1;
            }
        }
        return counter;
    }

    filterCandidates(pos, candidates, wordCounter) {
        candidates = new Set(candidates);

        const filtered = [];
        for (let candidate of candidates) {
            if (!(candidate.startsWith('# ') || candidate.endsWith(' #') || candidate.includes(' # ') || candidate === '#'))
                continue;

            if (candidate === '#' && pos !== 'adjective')
                continue;

            let includesRareWord = false;
            for (let word of candidate.split(' ')) {
                if (wordCounter[word] < 2) {
                    includesRareWord = true;
                    break;
                }
            }
            if (this.options.filtering && includesRareWord)
                continue;

            filtered.push(candidate);
        }
        return filtered;
    }

    hasConflict(fname, currentArg, currentPos, currentCanonical) {
        const func = this.class.queries[fname] || this.class.actions[fname];
        currentArg = func.getArgument(currentArg);
        const currentStringset = currentArg.getImplementationAnnotation('string_values');
        for (let arg of func.iterateArguments()) {
            if (arg.name === currentArg.name)
                continue;

            // for non base, we only check conflict between arguments of the same type, or same string set
            if (currentPos !== 'base') {
                if (currentStringset) {
                    let stringset = arg.getImplementationAnnotation('string_values');
                    if (stringset && stringset !== currentStringset)
                        continue;
                }
                let currentType = currentArg.type.isArray ? currentArg.type.elem : currentArg.type;
                let type = arg.type.isArray ? arg.type.elem : arg.type;
                if (!currentType.equals(type))
                    continue;
            }

            for (let pos in this.newCanonicals[arg]) {
                for (let canonical of this.newCanonicals[arg][pos]) {
                   if (canonical.replace('#', '').trim() === currentCanonical.replace('#', '').trim())
                       return true;
                }
            }

            const canonicals = arg.metadata.canonical;

            for (let pos in canonicals) {
                // if current pos is base, only check base
                if (currentPos === 'base' && pos !== 'base')
                    continue;
                // if current pos is not base, only check non-base
                if (currentPos !== 'base' && pos === 'base')
                    continue;
                let conflictFound = false;
                let todelete = [];
                for (let i = 0; i < canonicals[pos].length; i++) {
                    let canonical = canonicals[pos][i];
                    if (stemmer(canonical) === stemmer(currentCanonical)) {
                        // conflict with the base canonical phrase of another parameter, return true directly
                        if (i === 0)
                            return true;
                        // conflict with generate canonicals of another parameter, remove conflicts, then return true
                        conflictFound = true;
                        todelete.push(canonical);
                    }
                }
                if (conflictFound) {
                    for (let canonical of todelete) {
                        let index = canonicals[pos].indexOf(canonical);
                        canonicals[pos].splice(index, 1);
                    }
                    return true;
                }
            }
        }

        //TODO: also consider conflicts between candidates

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
        if (fs.existsSync(`./paraphraser-out.json`)) {
            this._output = JSON.parse(fs.readFileSync(`./paraphraser-out.json`, 'utf-8'));
            return;
        }

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
                this._input.push(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`);
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

        for (let paraphrase of paraphrases)
            this._extractOneCanonical(canonical, origin, paraphrase, value, query_canonical);
    }

    _hasValue(paraphrase, value) {
        // find exact match
        if (paraphrase.includes(value))
            return value;

        // find similar
        if (value in VALUE_MAP) {
            for (let alternative of VALUE_MAP[value]) {
                if (paraphrase.includes(alternative))
                    return alternative;
            }
        }

        const pluralized = this._langPack.pluralize(value);
        if (paraphrase.includes(pluralized))
            return pluralized;

        return false;
    }

    _extractOneCanonical(canonical, origin, paraphrase, value, query_canonical) {
        origin = origin.toLowerCase();
        paraphrase = paraphrase.toLowerCase();
        value = value.toLowerCase();
        value = this._hasValue(paraphrase, value);

        if (!value)
            return;

        if (paraphrase.endsWith('.') || paraphrase.endsWith('?') || paraphrase.endsWith('!'))
            paraphrase = paraphrase.slice(0, -1);

        const pluralized_query_canonical = this._langPack.pluralize(query_canonical);
        let tags = this._langPack.posTag(paraphrase.split(' '));

        let prefixes = [];
        if (origin.startsWith('who ')) {
            prefixes.push('who ');
            prefixes.push('who\'s ');
        } if (origin.startsWith('which ')) {
            let standard_prefix = origin.slice(0, origin.indexOf(query_canonical) + query_canonical.length + 1);
            prefixes.push(standard_prefix);
            prefixes.push(standard_prefix.replace('which ', 'what '));
            prefixes.push(standard_prefix.replace(query_canonical, pluralized_query_canonical));
            prefixes.push(standard_prefix.replace(query_canonical, pluralized_query_canonical).replace('which ', 'what '));
        } else {
            let standard_prefix = origin.slice(0, origin.indexOf(query_canonical) + query_canonical.length + 1);
            prefixes.push(standard_prefix);
            let to_replace = origin.includes(`a ${query_canonical}`) ? `a ${query_canonical}` : query_canonical;
            const query_canonical_alternatives = [
                `${pluralized_query_canonical}`,
                `some ${pluralized_query_canonical}`,
                `all ${pluralized_query_canonical}`,
                `any ${query_canonical}`,
                `any ${pluralized_query_canonical}`,
                `an ${query_canonical}`,
                `the ${query_canonical}`
            ];
            for (let alternative of query_canonical_alternatives)
                prefixes.push(standard_prefix.replace(to_replace, alternative));
        }

        if (paraphrase.startsWith('show me ') && paraphrase.endsWith(query_canonical)) {
            const clause = paraphrase.slice('show me '.length, -query_canonical.length - 1);
            if ((clause.startsWith('a ') || clause.startsWith('an ') || clause.startsWith('the ')) && clause.split(' ').length <= 3) {
                canonical['adjective'] = canonical['adjective'] || [];
                canonical['adjective'].push(clause.slice(clause.indexOf(' ') + 1).replace(value, '#'));
            }
            return;
        }

        for (let prefix of new Set(prefixes)) {
            if (!paraphrase.startsWith(prefix))
                continue;

            let clause = paraphrase.slice(prefix.length);
            let length = prefix.trim().split(' ').length;

            if (prefix === 'who\'s'
                || clause.startsWith('is ') || clause.startsWith('are ')
                || clause.startsWith('was ') || clause.startsWith('were ')) {
                if (clause.startsWith('is ') || clause.startsWith('are ')
                    || clause.startsWith('was ') || clause.startsWith('are ')) {
                    clause = clause.slice(clause.indexOf(' ') + 1);
                    length += 1;
                }
                if ((clause.startsWith('a ') || clause.startsWith('an ') || clause.startsWith('the ')) &&
                    ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[length + 1])) {
                    canonical['reverse_property'] = canonical['reverse_property'] || [];
                    canonical['reverse_property'].push(clause.replace(value, '#'));
                } else if (['VBN', 'VBG', 'JJ'].includes(tags[length])) {
                    canonical['passive_verb'] = canonical['passive_verb'] || [];
                    canonical['passive_verb'].push(clause.replace(value, '#'));
                } else if (['IN', 'TO'].includes(tags[length])) {
                    canonical['preposition'] = canonical['preposition'] || [];
                    canonical['preposition'].push(clause.replace(value, '#'));
                }
            } else if (clause.startsWith('with ') || clause.startsWith('has ') || clause.startsWith('have ')) {
                canonical['property'] = canonical['property'] || [];
                canonical['property'].push(clause.slice(clause.indexOf(' ') + 1).replace(value, '#'));
            } else if ((clause.startsWith('that ') || clause.startsWith('who ')) && ['VBP', 'VBZ', 'VBD'].includes(tags[length + 1])) {
                canonical['verb'] = canonical['verb'] || [];
                canonical['verb'].push(clause.slice(clause.indexOf(' ') + 1).replace(value, '#'));
            } else if ((clause.startsWith('do ') || clause.startsWith(`does ${value}`) || clause.startsWith(`did ${value}`))) {
                canonical['verb'] = canonical['verb'] || [];
                canonical['reverse_verb_projection'] = canonical['reverse_verb_projection'] || [];
                canonical['verb'].push(clause.slice(clause.indexOf(' ') + 1).replace(value, '#'));
                canonical['reverse_verb_projection'].push(clause.slice(clause.indexOf(' ') + 1).replace(value, '').trim());
            } else if (['VBN', 'VBG', 'JJ'].includes(tags[length])) {
                canonical['passive_verb'] = canonical['passive_verb'] || [];
                canonical['passive_verb'].push(clause.replace(value, '#'));
            } else if (['VBP', 'VBZ', 'VBD'].includes(tags[length])) {
                canonical['verb'] = canonical['verb'] || [];
                canonical['verb'].push(clause.replace(value, '#'));
            }
            break;
        }
    }
}
