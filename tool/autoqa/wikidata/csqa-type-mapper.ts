// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


import * as argparse from 'argparse';
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import csvstringify from 'csv-stringify';
import JSONStream from 'JSONStream';
import * as StreamUtils from '../../../lib/utils/stream-utils';
import { argnameFromLabel } from './utils';
import { CSQADialogueTurn } from './csqa-converter';

const pfs = fs.promises;

interface CSQATypeMapperOptions {
    domains ?: string[],
    input_dir : string,
    output : string,
    wikidata : string,
    wikidata_labels : string,
    minimum_appearance : number,
    minimum_percentage : number,
}

// map experiment name to CSQA type 
const DOMAIN_MAP : Record<string, string> = {
    'human': 'common_name',
    'city': 'administrative_territorial_entity',
    'country': 'designation_for_an_administrative_territorial_entity',
    'art': 'work_of_art',
    'song': 'release',
    'music_band': 'musical_ensemble',
    'game': 'application',
    'organization': 'organization',
    'disease': 'health_problem',
    'tv': 'television_program',
    'drug': 'drug'
};

class CSQATypeMapper {
    private _inputDir : string;
    private _output : string;
    private _wikidata : string; 
    private _wikidataLabels : string;
    private _minAppearance : number;
    private _minPercentage : number;
    private _domains ?: string[];
    private _labels : Map<string, string|undefined>;
    private _wikidataTypes : Map<string, string[]>;
    private _wikidataSuperTypes : Map<string, string[]>;
    private _typeMap : Map<string, any>;


    constructor(options : CSQATypeMapperOptions) {
        this._inputDir = options.input_dir;
        this._output = options.output;
        this._wikidata = options.wikidata;
        this._wikidataLabels = options.wikidata_labels;
        this._minAppearance = options.minimum_appearance;
        this._minPercentage = options.minimum_percentage;
        this._domains = options.domains ? options.domains.map((domain : string) => DOMAIN_MAP[domain] || domain) : undefined;

        this._labels = new Map();
        this._wikidataTypes = new Map();
        this._wikidataSuperTypes = new Map();
        this._typeMap = new Map();
    }

    private async _loadKB(kbfile : string) {
        const pipeline = fs.createReadStream(kbfile).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (item) => {
            const entity = item.key;
            const predicates = item.value;
            if ('P31' in predicates) {
                const entityTypes = predicates['P31'];
                this._wikidataTypes.set(entity, entityTypes);
                for (const type of entityTypes)
                    this._labels.set(type, undefined);
            }
            if ('P279' in predicates) {
                const superTypes = predicates['P279'];
                this._wikidataSuperTypes.set(entity, superTypes);
                for (const type of superTypes) 
                    this._labels.set(type, undefined);
            }
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    private async _loadLabels() {
        const pipeline = fs.createReadStream(this._wikidataLabels).pipe(JSONStream.parse('$*'));
        pipeline.on('data', async (entity) => {
            const qid = String(entity.key);
            const label = String(entity.value);
            if (this._labels.has(qid))
                this._labels.set(qid, label); 
        });

        pipeline.on('error', (error) => console.error(error));
        await StreamUtils.waitEnd(pipeline);
    }

    async load() {
        console.log('loading wikidata files ...');
        for (const kbfile of this._wikidata) 
            await this._loadKB(kbfile);

        console.log('loading wikidata labels ...');
        await this._loadLabels();
    }

    private _processDialog(dialog : CSQADialogueTurn[]) {
        let userTurn, systemTurn;
        for (const turn of dialog) {
            if (turn.speaker === 'USER') {
                userTurn = turn;
                continue;
            }
            
            assert(userTurn && turn.speaker === 'SYSTEM');
            systemTurn = turn;
    
            // extract examples from type 2.2.1, where an singular object-based question is asked. 
            // ie., given a relation and an object in the triple, asking for the subject 
            if (userTurn.ques_type_id === 2 && userTurn.sec_ques_type === 2 && userTurn.sec_ques_sub_type === 1) {
                assert(userTurn.type_list && userTurn.type_list.length === 1);
                const csqaType = userTurn.type_list[0];
                if (!this._typeMap.has(csqaType))
                    this._typeMap.set(csqaType, { total: 0 });
                const answer = systemTurn.entities_in_utterance!;
                for (const entity of answer) {
                    if (!this._wikidataTypes.has(entity)) 
                        continue;
                    for (const type of this._wikidataTypes.get(entity) ?? []) {
                        const map = this._typeMap.get(csqaType);
                        map.total += 1;
                        if (!(type in map)) 
                            map[type] = 1;
                        else
                            map[type] +=1;
                    }
                }
            }
        }
    }

    private async _processFile(file : string) {
        const dialog = JSON.parse(await pfs.readFile(file,  { encoding: 'utf8' }));
        this._processDialog(dialog);
    }

    private async _processDir(dir : string) {
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


    /**
     * Output the type mapping in a tsv format, where each column shows
     * 1. CSQA domain name (label of wikidata type)
     * 2. CSQA domain wikidata type (QID)
     * 3. the actual wikidata types for entities in the CSQA domain (filtered, used as the type map)
     * 4. the actual wikidata types for entities in the CSQA domain (unfiltered, used as a reference only)
     * 
     * each wikidata type in 3 and 4 is in the following format, and separated by space
     * <QID>:<label>:<# of appearance in CSQA>
     * 
     */
    async write() {
        const sortByCount = function(a : string, b : string) {
            if (a.split(':')[2] < b.split(':')[2])
                return 1;
            return -1;
        };

        console.log('write type mapping to file ...');
        const output = csvstringify({ header: false, delimiter: '\t' });
        output.pipe(fs.createWriteStream(this._output, { encoding: 'utf8' })); 
        for (const [csqaType, counter] of this._typeMap) {
            const label = this._labels.get(csqaType);
            if (!label) {
                console.error(`Found no label for CSQA type ${csqaType}`);
                continue;
            }
            if (this._domains && !this._domains.includes(argnameFromLabel(label)))
                continue;

            const mappedTypes = [];
            const allTypes = [];
            const total = counter.total;
            if (total < this._minAppearance)
                continue;
            for (const type in counter) {
                if (type === 'total')
                    continue;
                const label = this._labels.get(type);
                if (!label) {
                    console.error(`Found no label for Wikidata type ${csqaType}`);
                    continue;
                }
                const entry = `${type}:${argnameFromLabel(label)}:${counter[type]}`;
                allTypes.push(entry);
                if (counter[type] < this._minPercentage * total) 
                    continue;
                if (type !== csqaType) {
                    const superTypes = this._wikidataSuperTypes.get(type);
                    if (!superTypes || !superTypes.includes(csqaType))
                        continue;
                }
                mappedTypes.push(entry);
            }

            // HACK: in case no mapped type is found, i.e., none of the wikidata types 
            // are subtypes of the csqa type, then remove the subtype requirement
            // but use a higher threshold
            if (mappedTypes.length === 0) {
                for (const entry of allTypes) {
                    const [,, count] = entry.split(':');
                    if (parseInt(count) > this._minPercentage * 2 * total)
                        mappedTypes.push(entry);
                }
            }

            output.write([
                argnameFromLabel(label), 
                csqaType, 
                mappedTypes.sort(sortByCount).join(' '), 
                allTypes.sort(sortByCount).join(' ')
            ]);
        }
        StreamUtils.waitFinish(output);
    }
}

module.exports = {
    initArgparse(subparsers : argparse.SubParser) {
        const parser = subparsers.add_parser('wikidata-csqa-type-map', {
            add_help: true,
            description: "Collect how types in CSQA map to wikidata types"
        });
        parser.add_argument('-i', '--input-dir', {
            required: true,
            help: 'the directory containing the raw CSQA examples'
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
        parser.add_argument('--minimum-percentage', {
            required: false,
            type: Number,
            default: 0.05,
            help: 'within a domain, the minimum percentage for a Wikidata type to be included in the type map'
        });
        parser.add_argument('--wikidata', {
            required: true,
            nargs: '+',
            help: "full knowledge base of wikidata, named wikidata_short_1.json and wikidata_short_2.json"
        });
        parser.add_argument('--wikidata-labels', {
            required: true,
            help: "wikidata labels"
        });
        parser.add_argument('--domains', {
            required: false,
            nargs: '+',
            help: "domains to include, if available, all other domains will be excluded"
        });
    },

    async execute(args : any) {
        const analyzer = new CSQATypeMapper(args);
        await analyzer.load();
        await analyzer.process();
        await analyzer.write();
    }
};

