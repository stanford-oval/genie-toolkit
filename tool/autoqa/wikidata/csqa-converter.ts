// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as argparse from 'argparse';
import * as fs from 'fs';
import assert from 'assert';
import * as util from 'util';
import * as path from 'path';
import { Ast, Type } from 'thingtalk';
import * as I18N from '../../../lib/i18n';
import { serializePrediction } from '../../../lib/utils/thingtalk';
import { getElementType, getItemLabel, argnameFromLabel, readJson, Domains } from './utils';
import { makeDummyEntities } from "../../../lib/utils/entity-utils";
import { loadClassDef } from '../lib/utils';

export interface CSQADialogueTurn {
    speaker : 'USER'|'SYSTEM',
    utterance : string,
    ques_type_id : 1|2|3|4|5|6|7|8,
    sec_ques_type ?: 1|2,
    sec_ques_sub_type ?: 1|2|3|4,
    is_inc ?: 0|1,
    is_incomplete ?: 0|1,
    bool_ques_type ?: 1|2|3|4|5|6,
    inc_ques_type ?: 1|2|3,
    set_op_choice ?: 1|2|3,
    set_op ?: 1|2,
    count_ques_sub_type ?: 1|2|3|4|5|6|7|8|9,
    type_list ?: string[],
    entities_in_utterance ?: string[],
    active_set ?: string[]
}

interface CSQADialogueTurnPair {
    file : string,
    system : CSQADialogueTurn,
    user : CSQADialogueTurn,
}

interface ParameterRecord {
    value : string,
    preprocessed : string
}

interface CSQAConverterOptions {
    locale : string;
    timezone ?: string;
    domains : Domains,
    includeEntityValue : boolean,
    filter : string,
    softMatchId : boolean,
    inputDir : string,
    output : string,
    thingpedia : string,
    wikidataProperties : string,
    items : string,
    values : string,
    types : string,
    filteredExamples : string
}

class CsqaConverter {
    private _locale : string;
    private _timezone ?: string;
    private _domains : Domains;
    private _includeEntityValue : boolean;
    private _softMatchId : boolean;
    private _filters : Record<string, number[]>;
    private _paths : Record<string, string>;
    private _classDef : Ast.ClassDef|null;
    private _items : Map<string, Record<string, string>>;
    private _values : Map<string, string>;
    private _types : Map<string, string>;
    private _wikidataProperties : Map<string, string>;
    private _examples : CSQADialogueTurnPair[];
    private _tokenizer : I18N.BaseTokenizer;
    private _unsupportedCounter : Record<string, number>;

    constructor(options : CSQAConverterOptions) {
        this._locale = options.locale;
        this._timezone = options.timezone;
        this._domains = options.domains;
        this._includeEntityValue = options.includeEntityValue;
        this._softMatchId = options.softMatchId;
        this._filters = {};
        for (const filter of options.filter || []) {
            assert(filter.indexOf('=') > 0 && filter.indexOf('=') === filter.lastIndexOf('='));
            const [key, values] = filter.split('=');
            this._filters[key] = values.split(',').map((v) => parseInt(v));
        }

        this._paths = {
            inputDir: options.inputDir,
            output: options.output,
            thingpedia: options.thingpedia,
            wikidataProperties: options.wikidataProperties,
            items: options.items,
            values: options.values,
            types: options.types,
            filteredExamples: options.filteredExamples
        };

        this._classDef = null;
        this._items = new Map();
        this._values = new Map();
        this._types = new Map();

        this._wikidataProperties = new Map();

        this._examples = [];
        this._tokenizer = I18N.get('en-US').getTokenizer();

        this._unsupportedCounter = {
            indirect: 0,
            setOp: 0,
            typeConstraint: 0,
            wrongAnnotation: 0
        };
    }

    private async _getArgValue(qid : string) : Promise<ParameterRecord> {
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

    private _invocationTable(domain : string) : Ast.Expression {
        const selector = new Ast.DeviceSelector(null, 'org.wikidata', null, null);
        return new Ast.InvocationExpression(null, new Ast.Invocation(null, selector, domain, [], null), null);
    }

    private _generateFilter(domain : string, param : string, value : ParameterRecord) : Ast.BooleanExpression {
        let ttValue, op;
        if (param === 'id') {
            if (this._softMatchId) {
                ttValue = new Ast.Value.String(value.preprocessed);
                op = '=~';
            } else {
                ttValue = new Ast.Value.Entity(value.value, `org.wikidata:${domain}`, value.preprocessed);
                op = '==';
            }
        } else { 
            const propertyType = this._classDef!.getFunction('query', domain)!.getArgType(param)!;
            const entityType = this._types.get(value.value);
            const valueType = entityType ? new Type.Entity(`org.wikidata:${entityType}`) : getElementType(propertyType);
            if (valueType instanceof Type.Entity) {
                ttValue = new Ast.Value.Entity(value.value, valueType.type, value.preprocessed);
                op = propertyType.isArray ? 'contains' : '==';
            } else { // Default to string
                ttValue = new Ast.Value.String(value.preprocessed);
                op = propertyType.isArray ? 'contains~' : '=~';
            }
        }
        return new Ast.BooleanExpression.Atom(null, param, op, ttValue);
    }

    private _getDomainBySubject(x : string) : string|null {
        if (x.startsWith('c'))
            return this._domains.getDomainByCSQAType(x.slice(1));
        for (const [domain, items] of this._items) {
            if (x in items)
                return domain;
        }
        return null;
    }

    // returns [domain, projection, filter]
    private async _processOneActiveSet(activeSet : string[][]) : Promise<[string, string[]|Ast.BooleanExpression|null, Ast.BooleanExpression]> {
        const triple = activeSet[0];
        const domain = this._getDomainBySubject(triple[0]);
        assert(domain);
        const subject = triple[0].startsWith('c') ? null : await this._getArgValue(triple[0]);
        const relation = await argnameFromLabel(this._wikidataProperties.get(triple[1])!);
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

        throw new Error('Both subject and object absent in the active set entry: ' + activeSet);
    }

    // returns [domain, projection, filter]
    private async _processOneActiveSetWithSetOp(activeSet : string[][], setOp : number) : Promise<[string, string[]|null, Ast.BooleanExpression|null]> {
        assert(activeSet.length === 1 && activeSet[0].length > 3 && activeSet[0].length % 3 === 0);
        const triples = [];
        for (let i = 0; i < activeSet[0].length; i += 3) 
            triples.push(activeSet[0].slice(i, i + 3));
        // when the subjects of some triples are different, it requires set operation 
        // in ThingTalk to represent, which is not supported yet
        const subjects = new Set(triples.map(((triple) => triple[0])));
        if (subjects.size > 1)
            return ['unknown', null, null];

        // process tripes in active set
        const domains = [];
        const projections = [];
        const filters = [];
        for (let i = 0; i < triples.length; i ++) {
            const [domain, projection, filter] = await this._processOneActiveSet(triples.slice(i, i+1));
            domains.push(domain);
            projections.push(projection as string[]); // it won't be boolean question for set ops 
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
    private async _simpleQuestion(activeSet : string[][]) : Promise<Ast.Expression> {
        assert(activeSet.length === 1);
        const [domain, projection, filter] = await this._processOneActiveSet(activeSet);
        const filterTable = new Ast.FilterExpression(null, this._invocationTable(domain), filter, null);
        if (projection && Array.isArray(projection) && projection.length > 0)
            return new Ast.ProjectionExpression(null, filterTable, projection, [], [], null);
        return filterTable;
    }

    // ques_type_id=2
    private async _secondaryQuestion(activeSet : string[][], secQuesType : number, secQuesSubType : number) : Promise<Ast.Expression|null> {
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
                projections.push(projection as string[]);
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
    private async _setBasedQuestion(activeSet : string[][], setOpChoice : number) : Promise<Ast.Expression|null> {
        assert(activeSet.length === 1);
        const [domain, projection, filter] = await this._processOneActiveSetWithSetOp(activeSet, setOpChoice);
        if (!projection && !filter) {
            this._unsupportedCounter.setOp += 1;
            return null;
        }

        const filterTable = new Ast.FilterExpression(null, this._invocationTable(domain!), filter!, null);
        if (projection && projection.length > 0)
            return new Ast.ProjectionExpression(null, filterTable, projection, [], [], null);
        return filterTable;
    }


    // ques_type_id=5
    private async _booleanQuestion(activeSet : string[][], boolQuesType : number) : Promise<Ast.Expression|null> {
        if (boolQuesType === 1) {
            assert(activeSet.length === 1);
            const [domain, projection, filter] = await this._processOneActiveSet(activeSet);
            const filterTable = new Ast.FilterExpression(null, this._invocationTable(domain), filter, null);
            return new Ast.BooleanQuestionExpression(null, filterTable, projection as Ast.BooleanExpression, null);
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
    private async _quantitativeQuestionsSingleEntity(activeSet : string[][], entities : string[], countQuesSubType : number, utterance : string) : Promise<Ast.Expression|null> {
        switch (countQuesSubType) {
        case 1: { // Quantitative (count) 
            assert(activeSet.length === 1);
            const [domain, projection, filter] = await this._processOneActiveSet(activeSet);
            return this._quantitativeQuestionCount(domain, projection as string[], filter);
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
    private async _quantitativeQuestionsMultiEntity(activeSet : string[][], entities : string[], countQuesSubType : number, setOpChoice : number, utterance : string) : Promise<Ast.Expression|null> {
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
            return this._quantitativeQuestionCount(domain, projection as string[], filter!);
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

    private _quantitativeOperator(utterance : string) : string {
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

    private _comparativeOperator(utterance : string) : string {
        if (utterance.includes(' more ') || utterance.includes(' greater number '))
            return '>=';
        if (utterance.includes(' less ') || utterance.includes(' lesser number '))
            return '<=';
        if (utterance.includes(' same number '))
            return '~~';
        
        throw new Error('Failed to identify comparative operator based on the utterance');
    }

    private _numberInUtterance(utterance : string) : number {
        // we expect exactly one number in the utterance 
        const matches = utterance.match(/\d+/);
        if (!matches || matches.length === 0)
            throw new Error('Failed to locate numbers from the utterance');
        if (matches.length > 1)
            throw new Error('Multiple numbers found in the utterance');
        return parseInt(matches[0]);
    }

    // Quantitative (count)
    private async _quantitativeQuestionCount(domain : string, projection : string[], filter : Ast.BooleanExpression) : Promise<Ast.Expression> {
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
    private async _quantitativeQuestionMinMax(activeSet : string[][], utterance : string) : Promise<Ast.Expression|null> {
        assert(activeSet.length === 1);
        const triple = activeSet[0];
        if (!triple[0].startsWith('c') || !triple[2].startsWith('c')) {
            this._unsupportedCounter.wrongAnnotation += 1;
            return null;
        }
        const propertyLabel = this._wikidataProperties.get(triple[1]);
        assert(propertyLabel);
        const param = await argnameFromLabel(propertyLabel);
        const computation = new Ast.Value.Computation(
            'count',
            [new Ast.Value.VarRef(param)]
        );
        const domain = this._getDomainBySubject(triple[0]);
        assert(domain);
        const countTable = new Ast.ProjectionExpression(null, this._invocationTable(domain), [], [computation], [null], null);
        const direction = this._quantitativeOperator(utterance);
        const sortTable = new Ast.SortExpression(null, countTable, new Ast.Value.VarRef('count'), direction as "asc"|"desc", null);
        return new Ast.IndexExpression(null, sortTable, [new Ast.Value.Number(1)], null);
    }

    // Quantitative (atleast/atmost/~~/==)
    private async _quantitativeQuestionCompareCount(activeSet : string[][], utterance : string) : Promise<Ast.Expression> {
        assert(activeSet.length === 1);
        const triple = activeSet[0];
        assert(triple[0].startsWith('c') && triple[2].startsWith('c'));
        const propertyLabel = this._wikidataProperties.get(triple[1]);
        assert(propertyLabel);
        const param = await argnameFromLabel(propertyLabel);
        const computation = new Ast.Value.Computation(
            'count',
            [new Ast.Value.VarRef(param)]
        );
        const filter = new Ast.BooleanExpression.Compute(
            null, 
            computation, 
            this._quantitativeOperator(utterance), 
            new Ast.Value.Number(this._numberInUtterance(utterance)), 
            null
        );
        const domain = this._getDomainBySubject(triple[0]);
        assert(domain);
        return new Ast.FilterExpression(null, this._invocationTable(domain), filter, null);
    }

    // comparative (more/less/~~)
    private async _comparativeQuestion(activeSet : string[][], entities : string[], utterance : string) : Promise<Ast.Expression> {
        assert(activeSet.length === 1 && entities.length === 1);
        const triple = activeSet[0];
        assert(triple[0].startsWith('c') && triple[2].startsWith('c'));
        const domain = this._getDomainBySubject(triple[0]);
        const propertyLabel = this._wikidataProperties.get(triple[1]);
        assert(domain && propertyLabel);
        const param = await argnameFromLabel(propertyLabel);
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

    async csqaToThingTalk(dialog : CSQADialogueTurnPair) : Promise<Ast.Expression|null> {
        const user = dialog.user;
        const system = dialog.system;

        if (user.is_incomplete || user.is_inc) {
            this._unsupportedCounter.indirect += 1;
            return null;
        }
            
        const activeSet = [];
        assert(system.active_set);
        for (const active of system.active_set) 
            activeSet.push(active.replace(/[^0-9PQc,|]/g, '').split(','));

        switch (user.ques_type_id) {
        case 1: // Simple Question (subject-based)
            return this._simpleQuestion(activeSet);
        case 2: // Secondary question
            return this._secondaryQuestion(activeSet, user.sec_ques_type!, user.sec_ques_sub_type!);
        case 3: // Clarification (for secondary) question
            this._unsupportedCounter.indirect += 1;
            return null; 
        case 4: // Set-based question
            return this._setBasedQuestion(activeSet, user.set_op_choice!);
        case 5: // Boolean (Factual Verification) question
            return this._booleanQuestion(activeSet, user.bool_ques_type!);
        case 6: // Incomplete question (for secondary)
            this._unsupportedCounter.indirect += 1;
            return null;
        case 7: // Comparative and Quantitative questions (involving single entity)
            return this._quantitativeQuestionsSingleEntity(activeSet, user.entities_in_utterance!, user.count_ques_sub_type!, user.utterance);
        case 8: // Comparative and Quantitative questions (involving multiple(2) entities)
            return this._quantitativeQuestionsMultiEntity(activeSet, user.entities_in_utterance!, user.count_ques_sub_type!, user.set_op!, user.utterance);
        default:
            throw new Error(`Unknown ques_type_id: ${user.ques_type_id}`);
        }
    }

    private async _filterTurnsByDomain(dialog : CSQADialogueTurn[], file : string) {
        let userTurn;
        for (const turn of dialog) {
            const speaker = turn.speaker;
            if (speaker === 'USER') {
                let skip = false;
                for (const [key, values] of Object.entries(this._filters)) {
                    if (!values.includes(turn[key as keyof CSQADialogueTurn] as number))
                        skip = true;
                }
                userTurn = skip ? null : turn;
            } else {
                if (!userTurn)
                    continue;
                assert(turn.active_set);

                // only consider examples that contain _only_ the given domain
                let inDomain = true;
                for (const active of turn.active_set) {
                    const triples = active.replace(/[^0-9PQc,|]/g, '').split(',');
                    for (let i = 0; i < triples.length; i += 3) {
                        const subject = triples[i];
                        const domain = this._getDomainBySubject(subject);
                        if (!domain && !this._items.has(subject))
                            inDomain = false; 
                    } 
                }
                if (inDomain) {
                    this._examples.push({
                        file: file,
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
                const dialog = JSON.parse(fs.readFileSync(path.join(this._paths.inputDir, dir, file), { encoding: 'utf-8' }));
                this._filterTurnsByDomain(dialog, file);
            }
        }
        console.log(`${this._examples.length} QA pairs found`);
        await util.promisify(fs.writeFile)(this._paths.filteredExamples, JSON.stringify(this._examples, undefined, 2));
    }

    async _loadFilteredExamples() {
        this._examples = JSON.parse(await util.promisify(fs.readFile)(this._paths.filteredExamples, { encoding: 'utf-8' }));
    }

    async _convert() {
        const annotated = [];
        const skipped = [];
        const error = [];
        for (const example of this._examples) {
            let expression;
            try {
                expression = await this.csqaToThingTalk(example);
            } catch(e) {
                console.log('Error during conversion:');
                console.log('question:', example.user.utterance);
                console.log('triples:', example.system.active_set);
                console.error(e.message);
                expression = null;
            }

            if (!expression) {
                skipped.push(example);
                continue;
            }

            try {
                const program = new Ast.Program(null, [], [], [new Ast.ExpressionStatement(null, expression)]); 
                const user = example.user;
                const preprocessed = this._tokenizer.tokenize(user.utterance).tokens.join(' ');
                const entities = makeDummyEntities(preprocessed);
                const thingtalk = serializePrediction(program, preprocessed, entities, { locale: this._locale, timezone: this._timezone, includeEntityValue : this._includeEntityValue }).join(' ');
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
        this._classDef = await loadClassDef(this._paths.thingpedia, { locale: this._locale, timezone: this._timezone });
        this._items = await readJson(this._paths.items);
        this._values = await readJson(this._paths.values);
        this._types = await readJson(this._paths.types);
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
            return `${example.id}\t${example.preprocessed}\t${example.thingtalk}`;
        }).join('\n'), { encoding: 'utf8' });
    }
}    

module.exports = {
    initArgparse(subparsers : argparse.SubParser) {
        const parser = subparsers.add_parser('wikidata-convert-csqa', {
            add_help: true,
            description: "Generate parameter-datasets.tsv from processed wikidata dump. "
        });
        parser.add_argument('-l', '--locale', {
            default: 'en-US',
            help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
        });
        parser.add_argument('--timezone', {
            required: false,
            default: undefined,
            help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
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
        parser.add_argument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
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
        parser.add_argument('--types', {
            required: true,
            help: "A json file containing the entity types for value entities in the domain"
        });
        parser.add_argument('--filtered-examples', {
            required: true,
            help: "A json file containing in-domain examples of the given CSQA dataset"
        });
        parser.add_argument('--include-entity-value', {
            action: 'store_true',
            help: "Include entity value in thingtalk",
            default: false
        });
        parser.add_argument('--soft-match-id', {
            action: 'store_true',
            help: "Do string soft match on id property",
            default: false
        });
        parser.add_argument('--filter', {
            required: false,
            default: [],
            nargs: '+',
            help: 'filters to be applied to CSQA dataset, in the format of [key]=[value(int)]'
        });
    },

    async execute(args : any) {
        const domains = new Domains({ path: args.domains });
        await domains.init();
        const csqaConverter = new CsqaConverter({
            locale: args.locale,
            timezone : args.timezone,
            domains,
            inputDir: args.input,
            output: args.output,
            thingpedia: args.thingpedia,
            wikidataProperties: args.wikidata_property_list,
            items: args.items,
            values: args.values,
            types: args.types,
            filteredExamples: args.filtered_examples,
            includeEntityValue: args.include_entity_value,
            softMatchId: args.soft_match_id,
            filter: args.filter
        });
        csqaConverter.run();
    },
    CsqaConverter
};
