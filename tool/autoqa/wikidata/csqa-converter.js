// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Naoki Yamamura <yamamura@cs.stanford.edu>

import * as fs from 'fs';
import assert from 'assert';
import * as util from 'util';
import * as path from 'path';
import * as ThingTalk from 'thingtalk';
import * as I18N from '../../../lib/i18n';
import { serializePrediction } from '../../../lib/utils/thingtalk';
import { getType, getElementType, getItemLabel, argnameFromLabel, readJson } from './utils';
import { makeDummyEntities } from "../../../lib/utils/entity-utils";

const Ast = ThingTalk.Ast;

const QUESTION_TYPES = new Set(
    ['Simple Question (Direct)',
    'Verification (Boolean) (All)',
    'Logical Reasoning (All)',
    'Quantitative Reasoning (All)',
    'Quantitative Reasoning (Count) (All)',
    'Comparative Reasoning (All)',
    'Comparative Reasoning (Count) (All)']);

class CsqaConverter {
    constructor(options) {
        this._domain = options.domain;
        this._canonical = options.canonical;

        this._paths = {
            inputDir: options.inputDir,
            output: options.output,
            wikidataProperties: options.wikidataProperties,
            items: options.items,
            values: options.values,
            filteredExamples: options.filteredExamples
        };

        this._items = new Map();
        this._values = new Map();
        this._wikidataProperties = new Map();

        this._examples = [];
        this._tokenizer = I18N.get('en-US').getTokenizer();
    }

    async _getArgName(qid, pid) {
        return  this._items.has(qid) ? 'id' : argnameFromLabel(this._wikidataProperties.get(pid));
    }

    async _getArgValue(qid) {
        let value;
        if (this._values.has(qid)) {
            value = this._values.get(qid);
        } else {
            value = await getItemLabel(qid);
            if (value)
                this._values.set(qid, value);
        }
        if (value) 
            return this._tokenizer.tokenize(value).tokens.join(' ');
        console.log(`Label not found for ${qid}`);
        return null;
    }

    async _getTable() {
        const selector = new Ast.DeviceSelector(null, 'org.wikidata', null, null);
        return (new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, this._canonical, [], null), null));
    }

    async _getFilterBoolExp(property, value, param) {
        let ttValue, op;
        if (param === 'id') {
            ttValue = new Ast.Value.String(value);
            op = '=~';
        } else {
            const type = await getType(this._canonical, property, value);
            op = type.isArray ? 'contains' : '==';
            const elemType = getElementType(type);
            if (elemType.isEntity) {
                ttValue = new Ast.Value.Entity(value, elemType.type, value);
            } else if (elemType.Enum) {
                ttValue = new Ast.Value.Enum(value);
            } else if (elemType.isNumber) {
                ttValue = new Ast.Value.Number(Number(value));
            } else { // Default to string
                ttValue = new Ast.Value.String(value);
                op = type.isArray ? 'contains~' : '=~';
            }
        }
        return new Ast.BooleanExpression.Atom(null, param, op, ttValue);
    }

    async _getSingleFilter(activeSet, negate) {
        const param = await this._getArgName(activeSet[0], activeSet[1]);
        const value = await this._getArgValue(activeSet[0]);
        if (!value) return false;

        const exp = await this._getFilterBoolExp(activeSet[1], value, param);
        return negate ? new Ast.BooleanExpression.Not(null, exp) : exp;
    }

    async _getMultiFilter(activeSet, negate) {
        const filter1 = await this._getSingleFilter(activeSet.slice(0, 3));
        const filter2 = await this._getSingleFilter(activeSet.slice(3), negate);
        if (!filter1 || !filter2) return false;
        return [filter1, filter2];
    }

    // ques_type_id=1
    async _simpleQuestion(activeSet) {
        const exp = await this._getSingleFilter(activeSet);
        if (!exp) return false;

        const invocationTable = await this._getTable();
        const filter = new Ast.BooleanExpression.And(null, [exp]);
        const filterTable = new Ast.FilterExpression(null, invocationTable, filter, null);
        // Return projected table.
        return new Ast.ProjectionExpression(null, filterTable, [(await this._getArgName(activeSet[2], activeSet[1]))], [], [], null);
    }

    // ques_type_id=2
    async _secondaryQuestion(activeSet, secQuesType) {
        switch (secQuesType) {
            case 1: // Subject based question
                return this._simpleQuestion(activeSet);
            case 2: // Object based question
                return this._simpleQuestion(activeSet);
            default:
                throw new Error(`Unknown sec_ques_type: ${secQuesType}`);    
        }
    }

    // ques_type_id=4
    async _setBasedQuestion(activeSet, setOpChoice) {
        const invocationTable = await this._getTable();
        let filter;
        switch (setOpChoice) {
            case 1: // OR
                filter = await this._getMultiFilter(activeSet);
                if (!filter) return false;
                filter = new Ast.BooleanExpression.Or(null, filter);
                break;
            case 2: // AND
                filter = await this._getMultiFilter(activeSet);
                if (!filter) return false;
                filter = new Ast.BooleanExpression.And(null, filter);
                break;
            case 3: // Difference
                filter = await this._getMultiFilter(activeSet, true);
                if (!filter) return false;
                filter = new Ast.BooleanExpression.And(null, filter);
                break;
            default:
                throw new Error(`Unknown set_op_choice: ${setOpChoice}`);
        }

        const filterTable = new Ast.FilterExpression(null, invocationTable, filter, null);
        const param = activeSet[1] === activeSet[4] ?
            [(await this._getArgName(activeSet[2], activeSet[1]))] :
            [(await this._getArgName(activeSet[2], activeSet[1])), (await this._getArgName(activeSet[5], activeSet[4]))];
        // Return projected table.
        return (new Ast.ProjectionExpression(null, filterTable, param, [], []));
    }

    // ques_type_id=7
    async _quantitativeQuestionsSingleEntity(activeSet, countQuesSubType) {
        switch (countQuesSubType) {
            case 1: { // Quantitative (count) single entity
                const exp = await this._simpleQuestion(activeSet);
                if (!exp) return false;
                return new Ast.AggregationExpression(null, exp, '*', 'count', null);
            }
            case 2: // Quantitative (min/max) single entity
                return false; // not supprted in thingtalk.
            default:
                throw new Error(`Unknown count_ques_sub_type: ${countQuesSubType}`);    
        }
    }

    // ques_type_id=8
    async _quantitativeQuestionsMultiEntity(activeSet, countQuesSubType, setOpChoice) {
        switch (countQuesSubType) {
            case 1: { // Quantitative with Logical Operators
                const exp = await this._setBasedQuestion(activeSet, setOpChoice);
                if (!exp) return false;
                return new Ast.AggregationExpression(null, exp, '*', 'count', null);
            }
            case 2: { // Quantitative (count) multiple entity
                if (activeSet[1] === activeSet[4]) {
                    const exp = await this._simpleQuestion(activeSet);
                    if (!exp) return false;
                    return new Ast.AggregationExpression(null, exp, '*', 'count', null);
                } else {
                    const exp = await this._setBasedQuestion(activeSet, setOpChoice);
                    if (!exp) return false;
                    return new Ast.AggregationExpression(null, exp, '*', 'count', null);
                }
            }
            default:
                throw new Error(`Unknown count_ques_sub_type: ${countQuesSubType}`);    
        }
    }

    async csqaToThingTalk(dialog) {
        const user = dialog.user;
        const system = dialog.system;
            
        let activeSet = [];
        for (let active of system.active_set) {
            // There is no info if the question is subject or object based in CSQA json
            // except for ques_type_id 2. So we check that ourselves.
            if (!user.sec_ques_type) {
                const type = active.replace(/[^0-9PQc,|]/g, '').split(',');
                user.sec_ques_type = type[0].startsWith('c') ? 2:1;
            }
            active = active.replace(/[^0-9PQ,|]/g, '').split(',');
            if (user.sec_ques_type === 2) active = active.reverse();
            activeSet = activeSet.concat(active);
        }

        let program;
        switch (user.ques_type_id) {
            case 1: // Simple Question (subject-based)
                program = await this._simpleQuestion(activeSet);
                break;
            case 2: // Secondary question
                program = await this._secondaryQuestion(activeSet, user.sec_ques_type);
                break;
            case 3: // Clarification (for secondary) question
                break;
            case 4: // Set-based question
                program = await this._setBasedQuestion(activeSet, user.set_op_choice);
            case 5: // Boolean (Factual Verification) question
                break; // Not supported by thingtalk
            case 6: // Incomplete question (for secondary)
                break;
            case 7: // Comparative and Quantitative questions (involving single entity)
                program = await this._quantitativeQuestionsSingleEntity(activeSet, user.count_ques_sub_type);
                break;
            case 8: { // Comparative and Quantitative questions (involving multiple(2) entities)
                assert(user.set_op);
                const op = user.set_op === 2 ? 1:2; // Somehow set op is reverse of question type 4
                program = await this._quantitativeQuestionsMultiEntity(activeSet, user.count_ques_sub_type, op);
                break;
            }
            default:
                throw new Error(`Unknown ques_type_id: ${user.ques_type_id}`);
        }
        return program;
    }

    async _filterTurnsByDomain(dialog, file) {
        let userTurn;
        for (const turn in dialog) {
            const speaker = dialog[turn].speaker;
            if (speaker === 'USER') {
                userTurn = dialog[turn];
            } else {
                let found = false;
                for (let active of dialog[turn].active_set) {
                    active = active.replace(/[^0-9PQ,|]/g, '').split(',');
                    const entities = active[0].split('|').concat(active[2].split('|'));
                    for (const entity of entities) {
                        if (this._items.has(entity) &&
                            QUESTION_TYPES.has(userTurn['question-type']) &&
                            userTurn.description &&
                            !userTurn.description.toLowerCase().includes('indirect') &&
                            !userTurn.description.toLowerCase().includes('incomplete')) {
                            this._examples.push({
                                file: file,
                                turn: turn - 1, // count from start of the turn (i.e. user turn)
                                user: userTurn,
                                system: dialog[turn],
                            });
                            found = true;
                            break; // one entity set is sufficient for positive case.
                        }
                    }
                    if (found) break; // break +1 outer loop as well.
                }
            }
        }
    }

    async _filterExamples() {
        for (const dir of fs.readdirSync(this._paths.inputDir)) {
            for (const file of fs.readdirSync(path.join(this._paths.inputDir, dir))) {
                const dialog = JSON.parse(fs.readFileSync(path.join(this._paths.inputDir, dir, file)));
                this._filterTurnsByDomain(dialog, file);
            }
        }
        console.log(`${this._examples.length} QA pairs found for ${this._canonical} domain.`);
        await util.promisify(fs.writeFile)(this._paths.filteredExamples, JSON.stringify(this._examples, undefined, 2));
    }

    async _loadfilteredExamples() {
        this._examples = JSON.parse(await util.promisify(fs.readFile)(this._paths.filteredExamples));
    }

    async _convert() {
        const annotated = [];
        const skipped = [];
        const error = [];
        for (const example of this._examples) {
            const user = example.user;
            const program = await this.csqaToThingTalk(example);

            if (!program) {
                skipped.push(example);
                continue;
            }

            try {
                const preprocessed = this._tokenizer.tokenize(user.utterance).tokens.join(' ');
                const entities = makeDummyEntities(preprocessed);
                const thingtalk = serializePrediction(program, preprocessed, entities, { locale: 'en-US' }).join(' ');
                annotated.push({
                    id : annotated.length + 1,
                    raw: user.utterance,
                    preprocessed,
                    thingtalk
                });
            } catch(e) {
                // Mostly non-English alphabet
                console.error(e.message);
                error.push(example);
            }
        }
        console.log(`${annotated.length} annotated, ${skipped.length} skipped, ${error.length} thrown error in ${this._canonical}`);
        return annotated;
    }

    async run() {
        this._items = await readJson(this._paths.items);
        this._values = await readJson(this._paths.values);
        this._wikidataProperties = await readJson(this._paths.wikidataProperties);

        // load in-domain examples 
        if (fs.existsSync(this._paths.filteredExamples))
            await this._loadfilteredExamples();
        else 
            await this._filterExamples();

        // convert dataset annotation into thingtalk
        const dataset = await this._convert();

        // output thingtalk dataset
        await util.promisify(fs.writeFile)(this._paths.output, dataset.map((example) => {
            return `${example.id}\t${example.preprocessed}\t${example.thingtalk} ;`;
        }).join('\n'), { encoding: 'utf8' });
    }
}    

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('wikidata-convert-csqa', {
            add_help: true,
            description: "Generate parameter-datasets.tsv from processed wikidata dump. "
        });
        parser.add_argument('-o', '--output', {
            required: true,
        });
        parser.add_argument('-i', '--input', {
            required: true,
        });
        parser.add_argument('--domain', {
            required: true,
            help: 'domain (by item id) to process data'
        });
        parser.add_argument('--domain-canonical', {
            required: true,
            help: 'the canonical form for the given domains, used as the query names'
        });
        parser.add_argument('--wikidata-property-list', {
            required: true,
            help: "full list of properties in the wikidata dump, named filtered_property_wikidata4.json"
                + "in CSQA, in the form of a dictionary with PID as keys and canonical as values."
        });
        parser.add_argument('--items', {
            required: true,
            help: "A json file containing the labels for items of the domain"
        });
        parser.add_argument('--values', {
            required: true,
            help: "A json file containing the labels for value entities for the domain"
        });
        parser.add_argument('--filtered-examples', {
            required: true,
            help: "A json file containing in-domain examples of the given CSQA dataset"
        });
    },

    async execute(args) {
        const csqaConverter = new CsqaConverter({
            domain: args.domain,
            canonical: args.domain_canonical,
            inputDir: args.input,
            output: args.output,
            wikidataProperties: args.wikidata_property_list,
            items: args.items,
            values: args.values,
            filteredExamples: args.filtered_examples
        });
        csqaConverter.run();
    },
    CsqaConverter
};
