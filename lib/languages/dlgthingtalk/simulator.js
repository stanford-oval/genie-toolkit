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

const AbstractThingTalkExecutor = require('./executor');

const { coin, uniform, randint } = require('../../random');

function getApproximateResultSize(table, rng) {
    assert(rng);
    if (table.isProjection || table.isSort || table.isCompute)
        return getApproximateResultSize(table.table, rng);
    if (table.isIndex)
        return table.index.length;
    if (table.isSlice)
        return table.limit.isNumber ? table.limit.value : randint(10, 20, rng);
    if (table.isAggregation)
        return 1;
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
        return Math.ceil(getApproximateResultSize(table.table, rng) * Math.pow(0.2, numClauses));
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
            result[key] = this._generateValue(this._schema.out[key], key !== 'id');
        this._results.push(new Ast.DialogueHistoryResultItem(null, result));
    }

    _generateValue(type, repeatable = true) {
        if (type.isBoolean)
            return new Ast.Value.Boolean(coin(0.5, this._rng) ? true : false);

        if (type.isArray) {
            let length = randint(1, 3, this._rng);
            let buffer = [];
            // do not repeat values inside the array
            for (let i = 0; i < length; i++)
                buffer.push(this._generateValue(type.elem, false));
            return buffer;
        }

        if (type.isString)
            return new Ast.Value.VarRef(this.generateConstant(`__const_QUOTED_STRING`, repeatable));
        if (type.isNumber)
            return new Ast.Value.VarRef(this.generateConstant(`__const_NUMBER`, repeatable));
        if (type.isMeasure)
            return new Ast.Value.VarRef(this.generateConstant(`__const_MEASURE_` + type.unit, repeatable));
        if (type.isCurrency)
            return new Ast.Value.VarRef(this.generateConstant(`__const_CURRENCY`, repeatable));
        if (type.isTime)
            return new Ast.Value.VarRef(this.generateConstant(`__const_TIME`, repeatable));
        if (type.isDate)
            return new Ast.Value.VarRef(this.generateConstant(`__const_DATE`, repeatable));
        if (type.isLocation)
            return new Ast.Value.VarRef(this.generateConstant(`__const_LOCATION`, repeatable));
        if (type.isEnum)
            return new Ast.Value.Enum(uniform(type.entries, this._rng));

        if (type.isEntity) {
            switch (type.type) {
            case 'tt:username':
            case 'tt:contact_name':
                return new Ast.Value.VarRef(this.generateConstant('__const_USERNAME', repeatable));
            case 'tt:hashtag':
                return new Ast.Value.VarRef(this.generateConstant('__const_HASHTAG', repeatable));
            case 'tt:url':
                return new Ast.Value.VarRef(this.generateConstant('__const_URL', repeatable));
            case 'tt:phone_number':
                return new Ast.Value.VarRef(this.generateConstant('__const_PHONE_NUMBER', repeatable));
            case 'tt:email_address':
                return new Ast.Value.VarRef(this.generateConstant('__const_EMAIL_ADDRESS', repeatable));
            case 'tt:path_name':
                return new Ast.Value.VarRef(this.generateConstant('__const_PATH_NAME', repeatable));
            case 'tt:picture':
                return new Ast.Value.VarRef(this.generateConstant('__const_PICTURE', repeatable));
            default: {
                const escapedType = type.type.replace(/[:._]/g, (match) => {
                    if (match === '_')
                        return '__';
                    let code = match.charCodeAt(0);
                    return code < 16 ? '_0' + code.toString(16) : '_' + code.toString(16);
                });
                return new Ast.Value.VarRef(this.generateConstant('__const_GENERIC_ENTITY_' + escapedType, repeatable));
            }
            }
        }

        throw new TypeError(`Invalid constant of type ${type}`);
    }

    generateConstant(key, repeatable = true) {
        let max = this._constants[key] || 0;

        if (repeatable && max > 0 && coin(0.1, this._rng))
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
        assert(stmt instanceof Ast.Statement.Command || stmt instanceof Ast.Statement.Rule);

        if (stmt instanceof Ast.Statement.Rule) {
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

        return new Ast.DialogueHistoryResultList(null, results,
            numResults > results.length ? new Ast.Value.VarRef(generator.generateConstant('__const_NUMBER')) : new Ast.Value.Number(numResults),
            numResults > MORE_SIZE);
    }
}
module.exports = ThingTalkSimulator;
