// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';

class CSQAExampleExtractor {
    constructor(options) {
        this._inputDir = options.input_dir;
        this._limit = options.count ? Number.MAX_SAFE_INTEGER : options.limit;
        this._type = options.type;
        this._entities = options.entities ? options.entities.split(',') : [];
        this._subjectType = options.subject_type;
        this._objectType = options.object_type;
        this._filters = {};
        for (const filter of options.filter) {
            assert(filter.indexOf('=') > 0 && filter.indexOf('=') === filter.lastIndexOf('='));
            const [key, value] = filter.split('=');
            this._filters[key] = parseInt(value);
        }
        this.examples = [];
    }

    _filterTurns(dialog) {
        let pair = [];
        for (const turn of dialog) {
            if (pair.length === 1) {
                if (this._subjectType) {
                    if (!turn.active_set.some((triple) => triple.includes(`c(${this._subjectType}),`))) {
                        pair = [];
                        continue;
                    }
                }
                if (this._objectType) {
                    if (!turn.active_set.some((triple) => triple.includes(`,c(${this._objectType})`))) {
                        pair = [];
                        continue;
                    }
                }

                pair.push(turn);
                this.examples.push(pair);
                if (this.examples.length === this._limit)
                    return;
                pair = [];
                continue;
            }
            
            if (this._type && turn.ques_type_id !== this._type) 
                continue;

            if (this._entities.length > 0) {
                if (!turn.entities_in_utterance)
                    continue;
                let containsRequiredEntities = false;
                for (const entity of this._entities) {
                    if (turn.entities_in_utterance.includes(entity)) {
                        containsRequiredEntities = true;
                        break;
                    }
                }
                if (!containsRequiredEntities)
                    continue;
            }

            let skip = false;
            for (const [key, value] of Object.entries(this._filters)) {
                if (Array.isArray(turn[key])) {
                    if (!turn[key].includes(value))
                        skip = true;
                } else if (turn[key] !== value) {
                    skip = true;
                }
            }
            if (skip)
                continue;
                
            pair.push(turn);
        }
    }

    async extract() {
        for (const dir of fs.readdirSync(this._inputDir)) {
            for (const file of fs.readdirSync(path.join(this._inputDir, dir))) {
                const dialog = JSON.parse(fs.readFileSync(path.join(this._inputDir, dir, file)));
                this._filterTurns(dialog);
                if (this.examples.length === this._limit)
                    return;
            }
        }
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('wikidata-sample-csqa', {
            add_help: true,
            description: "Sample CSQA examples by given criteria. "
        });
        parser.add_argument('-i', '--input-dir', {
            required: true,
            help: 'the directory containing the raw csqa examples'
        });
        parser.add_argument('--limit', {
            default: 5,
            type: Number,
            help: 'the number of examples to return'
        });
        parser.add_argument('--count', {
            action: 'store_true',
            default: false,
            help: 'instead of showing examples, count the total number of examples that meet the criteria, limit will be omitted is true'
        });
        parser.add_argument('--type', {
            required: false,
            type: Number,
            help: 'question type to return'
        });
        parser.add_argument('--entities', {
            required: false,
            help: 'a list of entities that require to appear in entities_in_utterance'
        });
        parser.add_argument('--subject-type', {
            required: false,
            help: 'subject type that must appear in type_list'
        });
        parser.add_argument('--object-type', {
            required: false,
            help: 'object type that must appear in type_list'
        });
        parser.add_argument('--filter', {
            required: false,
            default: [],
            nargs: '+',
            help: 'additional filters to apply'
        });
    },

    async execute(args) {
        const extractor = new CSQAExampleExtractor(args);
        extractor.extract();
        if (args.count) {
            console.log(extractor.examples.length);
        } else {
            for (const example of extractor.examples) {
                console.log('*'.repeat(100));
                console.log(example);
            }
        }
    }
};

