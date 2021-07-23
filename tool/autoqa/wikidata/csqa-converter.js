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
//         Silei Xu <silei@cs.stanford.edu>

import * as fs from 'fs';
import assert from 'assert';
import * as util from 'util';
import * as path from 'path';
import * as ThingTalk from 'thingtalk';
import * as I18N from '../../../lib/i18n';
import { serializePrediction } from '../../../lib/utils/thingtalk';
import { getElementType, getItemLabel, argnameFromLabel, readJson, Domains } from './utils';
import { makeDummyEntities } from "../../../lib/utils/entity-utils";

const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

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
        this._domains = options.domains;
        this._includeEntityValue = options.includeEntityValue;
        this._filters = {};
        for (const filter of options.filter || []) {
            assert(filter.indexOf('=') > 0 && filter.indexOf('=') === filter.lastIndexOf('='));
            const [key, values] = filter.split('=');
            this._filters[key] = values.split(',').map((v) => parseInt(v));
        }

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

        this._current = null;
        this._unsupportedCounter = {
            indirect: 0,
            setOp: 0,
            typeConstraint: 0,
            wrongAnnotation: 0
        };
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
            return { value: qid, preprocessed: this._tokenizer.tokenize(value).tokens.join(' ') };
        throw new Error(`Label not found for ${qid}`);
    }

    _invocationTable(domain) {
        const selector = new Ast.DeviceSelector(null, 'org.wikidata', null, null);
        return (new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, domain, [], null), null));
    }

    _generateFilter(domain, param, value) {
        let ttValue, op;
        if (param === 'id') {
            if (this._includeEntityValue) {
                ttValue = new Ast.Value.Entity(value.value, `org.wikidata:${domain}`, value.preprocessed);
                op = '==';
            } else {
                ttValue = new Ast.Value.String(value.preprocessed);
                op = '=~';
            }
        } else { 
            // FIXME: load type from schema
            const type = new Type.Array(new Type.Entity(`org.wikidata:p_${param}`));
            const elemType = getElementType(type);
            if (elemType.isEntity) {
                ttValue = new Ast.Value.Entity(value.value, elemType.type, value.preprocessed);
                op = type.isArray ? 'contains' : '==';
            } else { // Default to string
                ttValue = new Ast.Value.String(value.preprocessed);
                op = type.isArray ? 'contains~' : '=~';
            }
        }
        return new Ast.BooleanExpression.Atom(null, param, op, ttValue);
    }

    _getDomainBySubject(x) {
        if (x.startsWith('c'))
            return this._domains.getDomainByCSQAType(x.slice(1));
        for (const [domain, items] of this._items) {
            if (x in items)
                return domain;
        }
        return null;
    }

    // returns [projection, filter]
    async _processOneActiveSet(activeSet) {
        const triple = activeSet[0];
        const domain = this._getDomainBySubject(triple[0]);
        assert(domain);
        const subject = triple[0].startsWith('c') ? null : await this._getArgValue(triple[0]);
        const relation = await argnameFromLabel(this._wikidataProperties.get(triple[1]));
        const object = triple[2].startsWith('c') ? null : await this._getArgValue(triple[2]);

        // when object is absent, return a projection on relation with filtering on id = subject
        if (subject && !object)
            return [domain, [relation], this._generateFilter(domain, 'id', subject)];
        // when subject is absent, return a filter on the relation with the object value
        if (!subject && object)
            return [domain, null, this._generateFilter(domain, relation, object)];
        // when both subject and object exists, then it's a verification question
        // return a boolean expression as projection, and a filter on id = subject
        if (subject && object)
            return [domain, this._generateFilter(domain, relation, object), this._generateFilter(domain, 'id', subject)];

        throw new Error('Both subject and object absent in the active set entry: ', activeSet);
    }

    // returns [projection, filter]
    async _processOneActiveSetWithSetOp(activeSet, setOp) {
        assert(activeSet.length === 1 && activeSet[0].length > 3 && activeSet[0].length % 3 === 0);
        const triples = [];
        for (let i = 0; i < activeSet[0].length; i += 3) 
            triples.push(activeSet[0].slice(i, i + 3));
        // when the subjects of some triples are different, it requires set operation 
        // in ThingTalk to represent, which is not supported yet
        const subjects = new Set(triples.map(((triple) => triple[0])));
        if (subjects.size > 1)
            return [null, null];

        // process tripes in active set
        const domains = [];
        const projections = [];
        const filters = [];
        for (let i = 0; i < triples.length; i ++) {
            const [domain, projection, filter] = await this._processOneActiveSet(triples.slice(i, i+1));
            domains.push(domain);
            projections.push(projection);
            filters.push(filter);
        }

        // FIXME: we current don't handle multiple domains 
        assert((new Set(domains)).size === 1);
        const domain = domains[0];

        // when projection is not null, it means we should have the same id filter on 
        // both triple, and different projection
        if (projections[0] && projections[0].length > 0) {
            const uniqueProjections = [...new Set(projections.flat())];
            return [domain, uniqueProjections, filters[0]];
        }
        // when projection is null, then we merge two filters according to setOp
        switch (setOp) {
            case 1: return [domain, null, new Ast.BooleanExpression.Or(null, filters)]; // OR
            case 2: return [domain, null, new Ast.BooleanExpression.And(null, filters)]; // AND
            case 3: { // DIFF
                assert(filters.length === 2);
                const negateFilter = new Ast.BooleanExpression.Not(null, filters[1]);
                return [domain, null, new Ast.BooleanExpression.And(null, [filters[0], negateFilter])];
            }
            default:
                throw new Error(`Unknown set_op_choice: ${setOp}`);
        }
    }

    // ques_type_id=1
    async _simpleQuestion(activeSet) {
        assert(activeSet.length === 1);
        const [domain, projection, filter] = await this._processOneActiveSet(activeSet);
        const filterTable = new Ast.FilterExpression(null, this._invocationTable(domain), filter, null);
        if (projection && projection.length > 0)
            return new Ast.ProjectionExpression(null, filterTable, projection, [], [], null);
        return filterTable;
    }

    // ques_type_id=2
    async _secondaryQuestion(activeSet, secQuesType, secQuesSubType) {
        if (secQuesSubType === 2 || secQuesSubType === 3) {
            this._unsupportedCounter.indirect += 1;
            return null;
        }
        if (secQuesSubType === 1) {
            if (activeSet.length !== 1) {
                this._unsupportedCounter.wrongAnnotation += 1;
                return null;
            }
            return this._simpleQuestion(activeSet);
        }
        if (secQuesSubType === 4) {
            // this it basically is asking multiple questions in one sentence. 
            // it is sometimes ambiguous with set-based questions
            if (activeSet.length <= 1)
                throw new Error('Only one active set found for secondary plural question');
            const domains = [];
            const projections = [];
            const filters = [];
            for (let i = 0; i < activeSet.length; i ++) {
                const [domain, projection, filter] = await this._processOneActiveSet(activeSet.slice(i, i+1));
                domains.push(domain);
                projections.push(projection);
                filters.push(filter);
            }

            // FIXME: we current don't handle multiple domains 
            assert((new Set(domains)).size === 1);
            const domain = domains[0];

            const filter = new Ast.BooleanExpression.Or(null, filters);
            const filterTable = new Ast.FilterExpression(null, this._invocationTable(domain), filter, null);
            // when subjects of triples are entity, we are asking the same projection for multiple entities
            if (secQuesType === 1) {
                const uniqueProjection = [...new Set(projections.flat())];
                assert(uniqueProjection.length === 1);
                return new Ast.ProjectionExpression(null, filterTable, uniqueProjection, [], [], null);
            }
            // when subjects of triples are type (domain), we are asking multiple questions, each of which
            // satisfies a different filter
            if (secQuesType === 2) 
                return filterTable;
            throw new Error('Invalid sec_ques_type for secondary question');
        }        
        throw new Error('Invalid sec_sub_ques_type for secondary question');
    }

    // ques_type_id=4
    async _setBasedQuestion(activeSet, setOpChoice) {
        assert(activeSet.length === 1);
        const [domain, projection, filter] = await this._processOneActiveSetWithSetOp(activeSet, setOpChoice);
        if (!projection & !filter) {
            this._unsupportedCounter.setOp += 1;
            return null;
        }

        const filterTable = new Ast.FilterExpression(null, this._invocationTable(domain), filter, null);
        if (projection && projection.length > 0)
            return new Ast.ProjectionExpression(null, filterTable, projection, [], []);
        return filterTable;
    }


    // ques_type_id=5
    async _booleanQuestion(activeSet, boolQuesType) {
        if (boolQuesType === 1) {
            assert(activeSet.length === 1);
            const [domain, projection, filter] = await this._processOneActiveSet(activeSet);
            const filterTable = new Ast.FilterExpression(null, this._invocationTable(domain), filter, null);
            return new Ast.BooleanQuestionExpression(null, filterTable, projection, null);
        } 
        if (boolQuesType === 4) {
            assert(activeSet.length === 2);
            const [domain1, projection1, filter] = await this._processOneActiveSet(activeSet);
            const [domain2, projection2, ] = await this._processOneActiveSet(activeSet.slice(1));
            // FIXME: we current don't handle multiple domains 
            assert(domain1 === domain2);
            const filterTable = new Ast.FilterExpression(null, this._invocationTable(domain1), filter, null);
            const projection = new Ast.BooleanExpression.And(null, [projection1, projection2]);
            return new Ast.BooleanQuestionExpression(null, filterTable, projection, null);
        } 
        // indirect questions
        this._unsupportedCounter.indirect += 1;
        return null;
    }

    // ques_type_id=7
    async _quantitativeQuestionsSingleEntity(activeSet, entities, countQuesSubType, utterance) {
        switch (countQuesSubType) {
            case 1: { // Quantitative (count) 
                assert(activeSet.length === 1);
                const [domain, projection, filter] = await this._processOneActiveSet(activeSet);
                return this._quantitativeQuestionCount(domain, projection, filter);
            }
            case 2: // Quantitative (min/max) 
                return this._quantitativeQuestionMinMax(activeSet, utterance);
            case 3: // Quantitative (atleast/atmost/~~/==)
                return this._quantitativeQuestionCompareCount(activeSet, utterance);
            case 4: // Comparative (more/less/~~)
                return this._comparativeQuestion(activeSet, entities, utterance);
            case 5: { // Quantitative (count over atleast/atmost/~~/==)
                const filterTable = await this._quantitativeQuestionCompareCount(activeSet, utterance);
                return new Ast.AggregationExpression(null, filterTable, '*', 'count', null);
            }
            case 6: { // Comparative (count over more/less/~~)
                const filterTable = await this._comparativeQuestion(activeSet, entities, utterance);
                return new Ast.AggregationExpression(null, filterTable, '*', 'count', null);
            }
            case 7:
            case 8:
            case 9: 
                // indirect questions
                this._unsupportedCounter.indirect += 1;
                return null;
            default:
                throw new Error(`Unknown count_ques_sub_type: ${countQuesSubType}`);    
        }
    }

    // ques_type_id=8
    async _quantitativeQuestionsMultiEntity(activeSet, entities, countQuesSubType, setOpChoice, utterance) {
         // Somehow set op is reverse of question type 4, there is no diff set op in this category
        const setOp = setOpChoice === 2 ? 1:2;
        switch (countQuesSubType) {
            case 1: { // Quantitative with logical operators
                assert(activeSet.length === 2);
                activeSet = [activeSet[0].concat(activeSet[1])];
                const [domain, projection, filter] = await this._processOneActiveSetWithSetOp(activeSet, setOp);
                if (!projection && !filter) {
                    this._unsupportedCounter.setOp += 1;
                    return null;
                }
                return this._quantitativeQuestionCount(domain, projection, filter);
            }
            case 2: // Quantitative (count)
            case 3: // Quantitative (min/max)
            case 4: // Quantitative (atleast/atmost/~~/==) 
            case 5: // Comparative (more/less/~~)
            case 6: // Quantitative (count over atleast/atmost/~~/==)
            case 7: // Comparative (count over more/less/~~)
                this._unsupportedCounter.typeConstraint += 1;
                return null;
            case 8:
            case 9: 
            case 10:
                // indirect questions
                this._unsupportedCounter.indirect += 1;
                return null;
            default:
                throw new Error(`Unknown count_ques_sub_type: ${countQuesSubType}`);
        }
    }

    _quantitativeOperator(utterance) {
        // there is literally only one single way to talk about most aggregation
        // operators in CSQA, so it's easy to decide 
        if (utterance.includes(' min '))
            return 'asc';
        if (utterance.includes(' max ')) 
            return 'desc';
        if (utterance.includes(' atleast' ))
            return '>=';
        if (utterance.includes(' atmost '))
            return '<=';
        if (utterance.includes(' exactly '))
            return '==';
        if (utterance.includes(' approximately ') || utterance.includes(' around '))
            return '~~';
        throw new Error('Failed to identify quantitative operator based on the utterance');
    }

    _comparativeOperator(utterance) {
        if (utterance.includes(' more ') || utterance.includes(' greater number '))
            return '>=';
        if (utterance.includes(' less ') || utterance.includes(' lesser number '))
            return '<=';
        if (utterance.includes(' same number '))
            return '~~';
        
        throw new Error('Failed to identify comparative operator based on the utterance');
    }

    _number(utterance) {
        // we expect exactly one number in the utterance 
        const matches = utterance.match(/\d+/);
        if (matches.length === 0)
            throw new Error('Failed to locate numbers from the utterance');
        if (matches.length > 1)
            throw new Error('Multiple numbers found in the utterance');
        return parseInt(matches[0]);
    }

    // Quantitative (count)
    async _quantitativeQuestionCount(domain, projection, filter) {
        const filterTable = new Ast.FilterExpression(null, this._invocationTable(domain), filter, null);
        // when projection exists, it is counting parameter on a table with id filter
        if (projection) {
            const computation = new Ast.Value.Computation(
                'count',
                projection.map((param) => new Ast.Value.VarRef(param))
            );
            return new Ast.ProjectionExpression(null, filterTable, [], [computation], [null], null);
        }
        // when projection is absent, it is counting a table with a regular filter
        return new Ast.AggregationExpression(null, filterTable, '*', 'count', null);
    }

    // Quantitative (min/max)
    async _quantitativeQuestionMinMax(activeSet, utterance) {
        assert(activeSet.length === 1);
        const triple = activeSet[0];
        if (!triple[0].startsWith('c') || !triple[2].startsWith('c')) {
            this._unsupportedCounter.wrongAnnotation += 1;
            return null;
        }
        const param = await argnameFromLabel(this._wikidataProperties.get(triple[1]));
        const computation = new Ast.Value.Computation(
            'count',
            [new Ast.Value.VarRef(param)]
        );
        const domain = this._getDomainBySubject(triple[0]);
        const countTable = new Ast.ProjectionExpression(null, this._invocationTable(domain), [], [computation], [null], null);
        const direction = this._quantitativeOperator(utterance);
        const sortTable = new Ast.SortExpression(null, countTable, new Ast.Value.VarRef('count'), direction, null);
        return new Ast.IndexExpression(null, sortTable, [new Ast.Value.Number(1)], null);
    }

    // Quantitative (atleast/atmost/~~/==)
    async _quantitativeQuestionCompareCount(activeSet, utterance) {
        assert(activeSet.length === 1);
        const triple = activeSet[0];
        assert(triple[0].startsWith('c') && triple[2].startsWith('c'));
        const param = await argnameFromLabel(this._wikidataProperties.get(triple[1]));
        const computation = new Ast.Value.Computation(
            'count',
            [new Ast.Value.VarRef(param)]
        );
        const filter = new Ast.BooleanExpression.Compute(
            null, 
            computation, 
            this._quantitativeOperator(utterance), 
            new Ast.Value.Number(this._number(utterance)), 
            null
        );
        const domain = this._getDomainBySubject(triple[0]);
        return new Ast.FilterExpression(null, this._invocationTable(domain), filter, null);
    }

    // comparative (more/less/~~)
    async _comparativeQuestion(activeSet, entities, utterance) {
        assert(activeSet.length === 1 && entities.length === 1);
        const triple = activeSet[0];
        assert(triple[0].startsWith('c') && triple[2].startsWith('c'));
        const domain = this._getDomainBySubject(triple[0]);
        const param = await argnameFromLabel(this._wikidataProperties.get(triple[1]));
        const comparisonTarget = await this._getArgValue(entities[0]);
        const filter = this._generateFilter(domain, 'id', comparisonTarget);
        const subquery = new Ast.ProjectionExpression(
            null,
            new Ast.FilterExpression(null, this._invocationTable(domain), filter, null),
            [],
            [new Ast.Value.Computation('count', [new Ast.Value.VarRef(param)])],
            [null],
            null
        );
        return new Ast.FilterExpression(
            null,
            this._invocationTable(domain),
            new Ast.ComparisonSubqueryBooleanExpression(
                null,
                new Ast.Value.Computation('count', [new Ast.Value.VarRef(param)]),
                this._comparativeOperator(utterance),
                subquery,
                null
            ),
            null
        );
    }

    async csqaToThingTalk(dialog) {
        this._current = dialog;
        const user = dialog.user;
        const system = dialog.system;

        if (user.is_incomplete || user.is_inc) {
            this._unsupportedCounter.indirect += 1;
            return null;
        }
            
        let activeSet = [];
        for (let active of system.active_set) {
            active = active.replace(/[^0-9PQc,|]/g, '').split(',');
            activeSet.push(active);
        }

        switch (user.ques_type_id) {
            case 1: // Simple Question (subject-based)
                return this._simpleQuestion(activeSet);
            case 2: // Secondary question
                return this._secondaryQuestion(activeSet, user.sec_ques_type, user.sec_ques_sub_type);
            case 3: // Clarification (for secondary) question
                this._unsupportedCounter.indirect += 1;
                return null; 
            case 4: // Set-based question
                return this._setBasedQuestion(activeSet, user.set_op_choice);
            case 5: // Boolean (Factual Verification) question
                return this._booleanQuestion(activeSet, user.bool_ques_type);
            case 6: // Incomplete question (for secondary)
                this._unsupportedCounter.indirect += 1;
                return null;
            case 7: // Comparative and Quantitative questions (involving single entity)
                return this._quantitativeQuestionsSingleEntity(activeSet, user.entities_in_utterance, user.count_ques_sub_type, user.utterance);
            case 8: // Comparative and Quantitative questions (involving multiple(2) entities)
                return this._quantitativeQuestionsMultiEntity(activeSet, user.entities_in_utterance, user.count_ques_sub_type, user.set_op, user.utterance);
            default:
                throw new Error(`Unknown ques_type_id: ${user.ques_type_id}`);
        }
    }

    async _filterTurnsByDomain(dialog, file) {
        let userTurn;
        for (const turn of dialog) {
            const speaker = turn.speaker;
            if (speaker === 'USER') {
                let skip = false;
                for (const [key, values] of Object.entries(this._filters)) {
                    if (!values.includes(turn[key]))
                        skip = true;
                }
                userTurn = skip ? null : turn;
            } else {
                if (!userTurn)
                    continue;

                // only consider examples that contain _only_ the given domain
                let inDomain = true;
                for (let active of turn.active_set) {
                    active = active.replace(/[^0-9PQc,|]/g, '').split(',');
                    for (let i = 0; i < active.length; i += 3) {
                        const subject = active[i];
                        const domain = this._getDomainBySubject(subject);
                        if (!domain && !this._items.has(subject))
                            inDomain = false; 
                    } 
                }
                if (inDomain) {
                    this._examples.push({
                        file: file,
                        turn: turn - 1,
                        user: userTurn,
                        system: turn,
                    });
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
        console.log(`${this._examples.length} QA pairs found`);
        await util.promisify(fs.writeFile)(this._paths.filteredExamples, JSON.stringify(this._examples, undefined, 2));
    }

    async _loadFilteredExamples() {
        this._examples = JSON.parse(await util.promisify(fs.readFile)(this._paths.filteredExamples));
    }

    async _convert() {
        const annotated = [];
        const skipped = [];
        const error = [];
        for (const example of this._examples) {
            let program;
            try {
                program = await this.csqaToThingTalk(example);
            } catch(e) {
                console.log('Error during conversion:');
                console.log('question:', example.user.utterance);
                console.log('triples:', example.system.active_set);
                console.error(e.message);
                program = null;
            }

            if (!program) {
                skipped.push(example);
                continue;
            }

            try {
                const user = example.user;
                const preprocessed = this._tokenizer.tokenize(user.utterance).tokens.join(' ');
                const entities = makeDummyEntities(preprocessed);
                const thingtalk = serializePrediction(program, preprocessed, entities, { locale: 'en-US', includeEntityValue : this._includeEntityValue }).join(' ');
                annotated.push({
                    id : annotated.length + 1,
                    raw: user.utterance,
                    preprocessed,
                    thingtalk
                });
            } catch(e) {
                console.log('Error during serializing:');
                console.log('question:', example.user.utterance);
                console.log('triples:', example.system.active_set);
                console.error(e.message);
                error.push(example);
            }
        }
        console.log(`${annotated.length} annotated, ${skipped.length} skipped, ${error.length} thrown error.`);
        console.log(`Among skipped questions:`);
        console.log(`(1) indirect questions: ${this._unsupportedCounter.indirect}`);
        console.log(`(2) set operations: ${this._unsupportedCounter.setOp}`);
        console.log(`(3) type constraint: ${this._unsupportedCounter.typeConstraint}`);
        console.log(`(4) wrong annotation: ${this._unsupportedCounter.wrongAnnotation}`);
        return annotated;
    }

    async run() {
        this._items = await readJson(this._paths.items);
        this._values = await readJson(this._paths.values);
        this._wikidataProperties = await readJson(this._paths.wikidataProperties);

        // load in-domain examples 
        if (fs.existsSync(this._paths.filteredExamples))
            await this._loadFilteredExamples();
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
        parser.add_argument('--domains', {
            required: true,
            help: 'the path to the file containing type mapping for each domain'
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
        parser.add_argument('--entity-id', {
            action: 'store_true',
            help: "Include entity id in thingtalk",
            default: false
        });
        parser.add_argument('--filter', {
            required: false,
            default: [],
            nargs: '+',
            help: 'filters to be applied to CSQA dataset, in the format of [key]=[value(int)]'
        });
    },

    async execute(args) {
        const domains = new Domains({ path: args.domains });
        await domains.init();
        const csqaConverter = new CsqaConverter({
            domains,
            inputDir: args.input,
            output: args.output,
            wikidataProperties: args.wikidata_property_list,
            items: args.items,
            values: args.values,
            filteredExamples: args.filtered_examples,
            includeEntityValue: args.entity_id,
            filter: args.filter
        });
        csqaConverter.run();
    },
    CsqaConverter
};
