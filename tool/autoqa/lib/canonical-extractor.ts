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

import { Ast } from 'thingtalk';
import stemmer from 'stemmer';
import PosParser from '../../../lib/pos-parser';
import { ParaphraseExample } from './canonical-example-constructor';
import { PROJECTION_PARTS_OF_SPEECH } from './base-canonical-generator';

interface AnnotationExtractorOptions {
    batch_size : number,
    filtering : boolean,
    debug : boolean,
}

function stem(str : string) : string {
    if (str.endsWith(' #'))
        str = str.slice(0, -2);
    return str.split(' ').map(stemmer).join(' ');
}

class ConflictResolver {
    private schema : Ast.FunctionDef;
    private candidates : Record<string, Record<string, string[]>>;
    private stemmedBaseCanonicals : Record<string, string>;

    constructor(schema : Ast.FunctionDef, candidates : Record<string, Record<string, string[]>>) {
        this.schema = schema;
        this.candidates = candidates;
        this.stemmedBaseCanonicals = {};
        for (const arg of schema.iterateArguments()) 
            this.stemmedBaseCanonicals[arg.name] = stem(arg.canonical);
    }

    resolve() {
        for (const [arg, candidatesByPos] of Object.entries(this.candidates)) {
            for (const [pos, candidates] of Object.entries(candidatesByPos)) {
                const filteredCandidates = [];
                for (const candidate of candidates) {
                    if (!this._hasConflict(arg, pos, candidate))
                        filteredCandidates.push(candidate);
                }
                this.candidates[arg][pos] = filteredCandidates;
            }
        }
    }

    private _hasConflict(argument : string, pos : string, candidate : string) : boolean {
        // remove candidates that conflict with the default canonical of other arguments
        for (const [arg, stemmedBaseCanonical] of Object.entries(this.stemmedBaseCanonicals)) {
            if (arg !== argument && stemmedBaseCanonical === stem(candidate))
                return true;
        }
        // remove candidates that conflict with each other
        for (const [arg, candidatesByPos] of Object.entries(this.candidates)) {
            if (arg === argument)
                continue;
            for (const [pos, candidates] of Object.entries(candidatesByPos)) {
                // for non-projection canonical, we only care about the arguments having conflict types
                if (!PROJECTION_PARTS_OF_SPEECH.includes(pos) && !this._hasConflictTypes(arg, argument))
                    continue;
                
                if (candidates.includes(candidate)) {
                    // return true, and remove conflicted ones for the compared argument as well
                    candidatesByPos[pos] = candidates.filter((c) => c === candidate);
                    return true;
                }
            }
        }

        return false;
    }

    private _hasConflictTypes(arg1 : string, arg2 : string) : boolean {
        // FIXME: consider subtypes
        // if types conflict
        if (this.schema.getArgType(arg1)!.equals(this.schema.getArgType(arg2)!))
            return true;
        // if string set conflict
        const stringSet1 = this.schema.getArgument(arg1)!.getImplementationAnnotation('string_values');
        const stringSet2 = this.schema.getArgument(arg2)!.getImplementationAnnotation('string_values');
        if (stringSet1 && stringSet2 && stringSet1 === stringSet2)
            return true;
        // otherwise 
        return false;
    }
}

export default class AnnotationExtractor {
    private class : Ast.ClassDef;
    private queries : string[];
    private options : AnnotationExtractorOptions;
    private parser : PosParser;
    private candidates : Record<string, Record<string, Record<string, string[]>>>;

    constructor(klass : Ast.ClassDef, queries : string[], options : AnnotationExtractorOptions) {
        this.class = klass;
        this.queries = queries;
        this.options = options;
        this.parser = new PosParser();

        this.candidates = {};
        for (const qname of this.queries) {
            this.candidates[qname] = {};
            for (const arg of this.class.getFunction('query', qname)!.iterateArguments())
                this.candidates[qname][arg.name] = {};
        }
    }

    async run(examples : ParaphraseExample[]) {
        // extract canonicals from paraphrases;
        examples.forEach((ex) => this._extractCanonical(ex));
        // validate extracted canonicals and add to schema
        for (const qname of this.queries) {
            const query : Ast.FunctionDef = this.class.getFunction('query', qname)!;
            // filter candidates for each argument
            for (const candidates of Object.values(this.candidates[qname]))
                this._filterCandidates(candidates);
            // remove conflict candidates among arguments
            this._removeConflictedCandidates(qname);
            // add filtered candidates to the canonical annotation
            for (const [arg, candidates] of Object.entries(this.candidates[qname]))
                this._addCandidates(query.getArgument(arg)!, candidates);
        }
    }

    private _extractCanonical(example : ParaphraseExample) {
        // FIXME: In case of boolean parameter or projection, values field is empty, skip for now
        if (typeof example.value !== 'string') 
            return;

        const canonical = this.candidates[example.query][example.argument];
        for (const paraphrase of example.paraphrases)
            this._extractOneCanonical(canonical, paraphrase, example.value, example.queryCanonical);
    }

    private _extractOneCanonical(canonical : Record<string, string[]>, paraphrase : string, value : string, queryCanonical : string) {
        const annotations = this.parser.match('query', paraphrase, [queryCanonical], value);
        if (annotations) {
            for (const annotation of annotations) {
                canonical[annotation.pos] = canonical[annotation.pos] ?? [];
                canonical[annotation.pos].push(annotation.canonical.replace('$value', '#'));
            }
        }
    }
        
    private _filterCandidates(candidatesByPos : Record<string, string[]>) {
        const wordCounter = this._countWords(candidatesByPos);
        for (const [pos, candidates] of Object.entries(candidatesByPos)) {
            const dedupedCandidates = new Set(candidates);
            const filteredCandidates = [];
            for (const candidate of dedupedCandidates) {
                // skip candidate with value directly connected with a word
                if (PROJECTION_PARTS_OF_SPEECH.includes(pos) && !/(#\w)|(\w#)/.test(candidate))
                    continue;
                // skip value only candidate for non-adjectives
                if (candidate === '#' && !pos.startsWith('adjective'))
                    continue;
                // skip candidate with rare word in it 
                let includesRareWord = false;
                for (const word of candidate.split(' ')) {
                    if (wordCounter[word] < 2) {
                        includesRareWord = true;
                        break;
                    }
                }
                if (this.options.filtering && includesRareWord)
                    continue;
                filteredCandidates.push(candidate);
            }
            candidatesByPos[pos] = filteredCandidates;
        }
    }

    private _countWords(candidates : Record<string, string[]>) : Record<string, number> {
        const counter : Record<string, number> = {};
        for (const pos in candidates) {
            for (const candidate of candidates[pos]) {
                for (const word of candidate.split(' '))
                    counter[word] = (counter[word] ?? 0) + 1;
            }
        }
        return counter;
    }

    private _removeConflictedCandidates(query : string) {
        const conflictResolver = new ConflictResolver(this.class.getFunction('query', query)!, this.candidates[query]);
        conflictResolver.resolve();
    }

    private _addCandidates(argument : Ast.ArgumentDef, candidates : Record<string, string[]>) {
        const canonicalAnnotation : Record<string, string[]> = argument.getNaturalLanguageAnnotation('canonical')!;
        for (const [pos, canonicals] of Object.entries(candidates)) {
            if (canonicals.length === 0)
                continue;
            if (!(pos in canonicalAnnotation)) {
                canonicalAnnotation[pos] = canonicals;
            } else {
                for (const canonical of canonicals) {
                    if (canonicalAnnotation[pos].includes(canonical))
                        continue;
                    if (canonical.endsWith(' #') && canonicalAnnotation[pos].includes(canonical.slice(0, -2)))
                        continue;
                    canonicalAnnotation[pos].push(canonical);
                }
            }

        }
    }
}
