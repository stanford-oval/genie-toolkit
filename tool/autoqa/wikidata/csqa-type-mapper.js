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
import csvstringify from 'csv-stringify';
import JSONStream from 'JSONStream';
import * as StreamUtils from '../../../lib/utils/stream-utils';

const pfs = fs.promises;

class CSQATypeMapper {
    constructor(options) {
        this._inputDir = options.input_dir;
        this._output = options.output;
        this._wikidata = options.wikidata;
        this._minAppearance = options.minimum_appearance;
        this._minPercentage = options.minimum_percentage;

        this._wikidataTypes = new Map();
        this._wikidataSuperTypes = new Map();
        this._typeMap = new Map();
    }

    async _loadKB(kbfile) {
        const pipeline = fs.createReadStream(kbfile).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (item) => {
            const entity = item.key;
            const predicates = item.value;
            if ('P31' in predicates) {
                const entityTypes = predicates['P31'];
                this._wikidataTypes.set(entity, entityTypes);
            }
            if ('P279' in predicates) {
                const superTypes = predicates['P279'];
                this._wikidataSuperTypes.set(entity, superTypes);
            }
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    async load() {
        console.log('loading wikidata files ...');
        for (const kbfile of this._wikidata) 
            await this._loadKB(kbfile);
    }

    _processDialog(dialog) {
        let userTurn, systemTurn;
        for (const turn of dialog) {
            if (turn.speaker === 'USER') {
                userTurn = turn;
                continue;
            }
            
            assert(turn.speaker === 'SYSTEM');
            systemTurn = turn;
    
            // extract examples from type 2.2.1, where an singular object-based question is asked. 
            // ie., given a relation and an object in the triple, asking for the subject 
            if (userTurn.ques_type_id === 2 && userTurn.sec_ques_type === 2 && userTurn.sec_ques_sub_type === 1) {
                assert(userTurn.type_list.length === 1);
                const csqaType = userTurn.type_list[0];
                if (!this._typeMap.has(csqaType))
                    this._typeMap.set(csqaType, { total: 0 });
                const answer = systemTurn.entities_in_utterance;
                for (const entity of answer) {
                    if (!this._wikidataTypes.has(entity)) {
                        console.error('Entity with no wikidata type:', entity);
                        continue;
                    }
                    for (const type of this._wikidataTypes.get(entity)) {
                        const map = this._typeMap.get(csqaType);
                        map.total += 1;
                        if (type !== csqaType) {
                            const superTypes = this._wikidataSuperTypes.get(type);
                            if (!superTypes || !superTypes.includes(csqaType))
                                continue;
                        }
                        if (!(type in map)) 
                            map[type] = 1;
                        else
                            map[type] +=1;
                    }
                }
            }
        }
    }

    async _processFile(file) {
        const dialog = JSON.parse(await pfs.readFile(file));
        this._processDialog(dialog);
    }

    async _processDir(dir) {
        const files = await pfs.readdir(dir);
        for (const file of files) {
            const fpath = path.join(dir, file);
            const stats = await pfs.lstat(fpath);
            if (stats.isDirectory() || stats.isSymbolicLink())
                await this._processDir(fpath);
            else if (file.startsWith('QA') && file.endsWith('.json'))
                await this._processFile(fpath);
        }
    }

    async process() {
        console.log('start processing dialogs');
        await this._processDir(this._inputDir);
    }


    async write() {
        console.log('write type mapping to file ...');
        const output = csvstringify({ header: false, delimiter: '\t'});
        output.pipe(fs.createWriteStream(this._output, { encoding: 'utf8' })); 
        for (const [key, counter] of this._typeMap) {
            const mappedTypes = [];
            const total = counter.total;
            if (total < this._minAppearance)
                continue;
            for (const type in counter) {
                if (type !== 'total' && counter[type] >= this._minPercentage * total)
                    mappedTypes.push(type);
            }
            output.write([key, mappedTypes.join(',')]);
        }
        StreamUtils.waitFinish(output);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('wikidata-csqa-type-map', {
            add_help: true,
            description: "Collect how types in CSQA maps to wikidata types"
        });
        parser.add_argument('-i', '--input-dir', {
            required: true,
            help: 'the directory containing the raw csqa examples'
        });
        parser.add_argument('-o', '--output', {
            required: true,
            help: 'the path to the output json containing the type mapping in CSQA'
        });
        parser.add_argument('--minimum-appearance', {
            required: false,
            type: Number,
            default: 50,
            help: 'the minimum number of appearance of a CSQA type to be included in the output'
        });
        parser.add_argument('--minimum-percentage ', {
            required: false,
            type: Number,
            default: 0.05,
            help: 'the minimum percentage for a Wikidata type to be included in the type map'
        });
        parser.add_argument('--wikidata', {
            required: false,
            nargs: '+',
            help: "full knowledge base of wikidata, named wikidata_short_1.json and wikidata_short_2.json"
        });
    },

    async execute(args) {
        const analyzer = new CSQATypeMapper(args);
        await analyzer.load();
        await analyzer.process();
        await analyzer.write();
    }
};

