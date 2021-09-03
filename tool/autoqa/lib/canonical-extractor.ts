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
//
/// <reference types="./stemmer" />

import { Ast, Type } from 'thingtalk';
import assert from 'assert';
import * as fs from 'fs';
import * as util from 'util';
import * as child_process from 'child_process';
import stemmer from 'stemmer';
import PosParser from '../../../lib/pos-parser';

interface AnnotationExtractorOptions {
    batch_size : string,
    filtering : boolean,
    debug : boolean,
}

export default class AnnotationExtractor {
    private class : Ast.ClassDef;
    private model : string;
    private queries : string[];
    private options : AnnotationExtractorOptions;
    private parser : PosParser;
    private _input : string[];
    private _output : string[];
    private newCanonicals : Record<string, any>;

    constructor(klass : Ast.ClassDef, queries : string[], model : string, options : AnnotationExtractorOptions) {
        this.class = klass;
        this.model = model;
        this.queries = queries;
        this.options = options;
        this.parser = new PosParser();

        this._input = [];
        this._output = [];
        this.newCanonicals = {};
    }

    async run(synonyms : Record<string, Record<string, any>>, queries : Record<string, Record<'args'|'canonical', any>>) {
        const slices : Record<string, any> = {};
        for (const qname of this.queries) {
            slices[qname] = {};
            for (const arg in synonyms[qname]) {
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

        for (const qname of this.queries) {
            const query_canonical = Array.isArray(queries[qname]['canonical']) ? queries[qname]['canonical'][0] : queries[qname]['canonical'];
            for (const arg in synonyms[qname]) {
                const values = queries[qname]['args'][arg]['values'];
                const slice = slices[qname][arg];
                for (let i = slice[0]; i < slice[1]; i++)
                    this.extractCanonical(arg, i, values, query_canonical);
            }

            for (const arg in synonyms[qname]) {
                if (!(arg in this.newCanonicals))
                    continue;

                const wordCounter = this.countWords(this.newCanonicals[arg]);
                const canonicals = (this.class.queries[qname] || this.class.actions[qname]).getArgument(arg)!.metadata.canonical;
                for (const typeNewCanonical in this.newCanonicals[arg]) {
                    const candidates = this.filterCandidates(typeNewCanonical, this.newCanonicals[arg][typeNewCanonical], wordCounter);
                    for (const newCanonical of candidates) {
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

    countWords(candidates : Record<string, string[]>) : Record<string, number> {
        const counter : Record<string, number> = {};
        for (const pos in candidates) {
            for (const candidate of candidates[pos]) {
                for (const word of candidate.split(' '))
                    counter[word] = (counter[word] || 0) + 1;
            }
        }
        return counter;
    }

    filterCandidates(pos : string, candidates : string[], wordCounter : Record<string, number>) {
        const dedupedCandidates = new Set(candidates);

        const filtered = [];
        for (const candidate of dedupedCandidates) {
            if (!(candidate.startsWith('# ') || candidate.endsWith(' #') || candidate.includes(' # ') || candidate === '#'))
                continue;

            if (candidate === '#' && pos !== 'adjective')
                continue;

            let includesRareWord = false;
            for (const word of candidate.split(' ')) {
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

    hasConflict(fname : string, currentArg : string, currentPos : string, currentCanonical : string) {
        const func = this.class.queries[fname] || this.class.actions[fname];
        const currentArgDef = func.getArgument(currentArg);
        assert(currentArgDef);
        const currentStringset = currentArgDef.getImplementationAnnotation('string_values');
        for (const arg of func.iterateArguments()) {
            if (arg.name === currentArgDef.name)
                continue;

            // for non base, we only check conflict between arguments of the same type, or same string set
            if (currentPos !== 'base') {
                if (currentStringset) {
                    const stringset = arg.getImplementationAnnotation('string_values');
                    if (stringset && stringset !== currentStringset)
                        continue;
                }
                const currentType = currentArgDef.type instanceof Type.Array ? currentArgDef.type.elem as Type : currentArgDef.type;
                const type = arg.type instanceof Type.Array ? arg.type.elem as Type : arg.type;
                if (!currentType.equals(type))
                    continue;
            }

            for (const pos in this.newCanonicals[arg.name]) {
                for (const canonical of this.newCanonicals[arg.name][pos]) {
                   if (canonical.replace('#', '').trim() === currentCanonical.replace('#', '').trim())
                       return true;
                }
            }

            const canonicals = arg.metadata.canonical;

            for (const pos in canonicals) {
                // if current pos is base, only check base
                if (currentPos === 'base' && pos !== 'base')
                    continue;
                // if current pos is not base, only check non-base
                if (currentPos !== 'base' && pos === 'base')
                    continue;
                let conflictFound = false;
                const todelete = [];
                for (let i = 0; i < canonicals[pos].length; i++) {
                    const canonical = canonicals[pos][i];
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
                    for (const canonical of todelete) {
                        const index = canonicals[pos].indexOf(canonical);
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

        const stdout : string = await new Promise((resolve, reject) => {
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

    generateInput(candidates : Record<string, any>) {
        for (const category in candidates) {
            if (category === 'base')
                continue;
            const canonical = Object.keys(candidates[category])[0];
            for (const sentence of candidates[category][canonical])
                this._input.push(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`);
        }
    }

    extractCanonical(arg : string, index : number, values : string[], query_canonical : string) {
        const origin = this._input[index];
        const paraphrases = this._output[index];

        if (!(arg in this.newCanonicals))
            this.newCanonicals[arg] = {};

        const canonical = this.newCanonicals[arg];
        // In case of boolean parameter, values field is empty, skip for now
        if (!values)
            return;
        const value = values.find((v) => origin.includes(v));
        if (!value) {
            // base canonical, do nothing
            return;
        }

        for (const paraphrase of paraphrases)
            this._extractOneCanonical(canonical, paraphrase, value, query_canonical);
    }

    _extractOneCanonical(canonical : Record<string, any>, paraphrase : string, value : string, query_canonical : string) {
        const annotations = this.parser.match('query', paraphrase, [query_canonical], value);
        if (annotations) {
            for (const annotation of annotations) {
                canonical[annotation.pos] = canonical[annotation.pos] || [];
                canonical[annotation.pos].push(annotation.canonical.replace('$value', '#'));
            }
        }
    }

}
