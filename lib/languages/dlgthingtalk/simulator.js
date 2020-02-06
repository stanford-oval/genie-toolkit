// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const AbstractThingTalkExecutor = require('./dlgthingtalk');

const { coin, uniform, randint } = require('../../random');

function getApproximateResultSize(table, rng) {
    if (table.isProjection || table.isSort || table.isCompute)
        return getApproximateResultSize(table.table, rng);
    if (table.isIndex)
        return table.index.length;
    if (table.isInvocation)
        return randint(500, 5000, rng);
    if (table.isFilter) {
        if (table.filter.isAnd) {
            for (let clause of table.filter.operands) {
                if (clause.isAtom && clause.name === 'id')
                    return 1;
            }
        }
        if (table.filter.isAtom && table.filter.name === 'id')
            return 1;
        let numClauses = table.filter.isAnd ? table.filter.operands.length : 1;
        return Math.round(getApproximateResultSize(table, rng) * Math.pow(0.33, numClauses));
    }
    if (table.isJoin)
        return getApproximateResultSize(table.lhs, rng) * getApproximateResultSize(table.rhs, rng);

    throw new TypeError();
}

class ResultGenerator {
    constructor(schema, numResults, rng) {
        this._numResults = numResults;

        this._schema = schema;
        this._rng = rng;
        this._constants = {};
        this._results = [];
    }

    generate() {
        while (this._results.length < this._numResults)
            this._generateOneResult();
        return this._results;
    }

    _generateOneResult() {
        let result = {};
        for (let key in this._schema.out)
            result[key] = this._generateValue(this._schema.out[key]);
        this._results.push(new Ast.DialogueHistoryResult(null, result));
    }

    _generateValue(type) {
        if (type.isBoolean)
            return new Ast.Value.Boolean(coin(0.5, this._rng) ? true : false);

        if (type.isArray) {
            let length = randint(1, 3, this._rng);
            let buffer = [];
            for (let i = 0; i < length; i++)
                buffer.push(this._generateValue(type.elem));
            return buffer;
        }

        if (type.isString)
            return new Ast.Value.VarRef(this.generateConstant(`__const_QUOTED_STRING`));
        if (type.isNumber)
            return new Ast.Value.VarRef(this.generateConstant(`__const_NUMBER`));
        if (type.isMeasure)
            return new Ast.Value.VarRef(this.generateConstant(`__const_MEASURE_` + type.unit));
        if (type.isCurrency)
            return new Ast.Value.VarRef(this.generateConstant(`__const_CURRENCY`));
        if (type.isTime)
            return new Ast.Value.VarRef(this.generateConstant(`__const_TIME`));
        if (type.isDate)
            return new Ast.Value.VarRef(this.generateConstant(`__const_DATE`));
        if (type.isLocation)
            return new Ast.Value.VarRef(this.generateConstant(`__const_LOCATION`));
        if (type.isEnum)
            return new Ast.Value.Enum(uniform(type.entries, this._rng));

        if (type.isEntity) {
            switch (type.type) {
            case 'tt:username':
            case 'tt:contact_name':
                return new Ast.Value.VarRef(this.generateConstant('__const_USERNAME'));
            case 'tt:hashtag':
                return new Ast.Value.VarRef(this.generateConstant('__const_HASHTAG'));
            case 'tt:url':
                return new Ast.Value.VarRef(this.generateConstant('__const_URL'));
            case 'tt:phone_number':
                return new Ast.Value.VarRef(this.generateConstant('__const_PHONE_NUMBER'));
            case 'tt:email_address':
                return new Ast.Value.VarRef(this.generateConstant('__const_EMAIL_ADDRESS'));
            case 'tt:path_name':
                return new Ast.Value.VarRef(this.generateConstant('__const_PATH_NAME'));
            case 'tt:picture':
                return new Ast.Value.VarRef(this.generateConstant('__const_PICTURE'));
            default: {
                const escapedType = type.type.replace(/[:._]/g, (match) => {
                    if (match === '_')
                        return '__';
                    let code = match.charCodeAt(0);
                    return code < 16 ? '_0' + code.toString(16) : '_' + code.toString(16);
                });
                return new Ast.Value.VarRef(this._generateConstant('__const_GENERIC_ENTITY_' + escapedType));
            }
            }
        }

        throw new TypeError(`Invalid constant of type ${type}`);
    }

    generateConstant(key) {
        let max = this._constants[key] || 0;

        if (max > 0 && coin(0.1, this._rng))
            return key + '_' + randint(0, max-1, this._rng);

        this._constants[key] = max + 1;
        return key + '_' + max;
    }
}

// above MORE_SIZE, we set the "more" bit
const MORE_SIZE = 1000;
// above PAGE_SIZE, we set the count but don't actually show the full list of results
const PAGE_SIZE = 10;

/**
 * Simulate the execution of ThingTalk code.
 */
class ThingTalkSimulator extends AbstractThingTalkExecutor {
    constructor(options) {
        super();
        this._rng = options.rng;
    }

    async executeStatement(stmt) {
        assert(stmt instanceof Ast.Command || stmt instanceof Ast.Rule);

        if (stmt instanceof Ast.Rule) {
            // nothing to do, this always returns nothing
            return [];
        }

        if (stmt.actions.length > 0 && !stmt.actions.some((a) => a.isNotify)) {
            // FIXME for now, actions return nothing
            return [];
        }
        assert(stmt.table);

        let numResults;
        if (stmt.table.schema.is_list)
            numResults = getApproximateResultSize(stmt.table, this._rng);
        else
            numResults = 1;

        const generator = new ResultGenerator(stmt.table.schema, Math.min(numResults, PAGE_SIZE), this._rng);
        const results = generator.generate();

        return new Ast.DialogueHistoryResults(null, results,
            numResults > results.length ? generator.generateConstant('__const_NUMBER') : new Ast.Value.Number(numResults),
            numResults > MORE_SIZE);
    }
}
module.exports = ThingTalkSimulator;
