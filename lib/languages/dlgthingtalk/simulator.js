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
        this._constants = new Map;
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
            return new Ast.Value.String(this._generateString(`QUOTED_STRING`, repeatable));
        if (type.isNumber)
            return new Ast.Value.Number(this._generateNumber(`NUMBER`, repeatable));
        if (type.isMeasure)
            return new Ast.Value.Measure(this._generateNumber(`MEASURE_` + type.unit, repeatable), type.unit);
        if (type.isCurrency)
            return new Ast.Value.Currency(this._generateNumber(`CURRENCY`, repeatable), 'usd');
        if (type.isTime)
            return new Ast.Value.Time(this._generateTime(repeatable));
        if (type.isDate)
            return new Ast.Value.Date(this._generateDate(repeatable));
        if (type.isLocation)
            return new Ast.Value.Location(this._generateLocation(repeatable));
        if (type.isEnum)
            return new Ast.Value.Enum(uniform(type.entries, this._rng));
        if (type.isEntity)
            return new Ast.Value.Entity(this._generateString('ENTITY_' + type.type, repeatable), type.type, null);

        throw new TypeError(`Invalid constant of type ${type}`);
    }

    _generateTime(repeatable) {
        const reused = this._reuseConstant('TIME', repeatable);
        if (reused !== undefined)
            return reused;

        const newTime = new Ast.Time.Absolute(randint(0, 23), randint(0, 59), 0);
        this._constants.get('TIME').push(newTime);
        return newTime;
    }

    _generateDate(repeatable) {
        const date = new Date(2018, 0, this._generateNumber('DATE', repeatable));
        return new Date(date);
    }

    _generateLocation(repeatable) {
        const reused = this._reuseConstant('LOCATION', repeatable);
        if (reused !== undefined)
            return reused;

        const lat = this._generateNumber('LOCATION::lat', repeatable);
        const lon = this._generateNumber('LOCATION::lon', repeatable);
        const newLocation = new Ast.Location.Absolute(lat, lon, null);
        this._constants.get('LOCATION').push(newLocation);
        return newLocation;
    }

    _generateNumber(key, repeatable) {
        const reused = this._reuseConstant(key, repeatable);
        if (reused !== undefined)
            return reused;

        let newNumber;
        // with 50% probability, generate a "small" number
        if (coin(0.5, this._rng))
            newNumber = Math.floor(1 + this._rng() * 19);
        else
            newNumber = Math.floor(20 + this._rng() * 980);
        this._constants.get(key).push(newNumber);
        return newNumber;
    }

    _generateString(key, repeatable) {
        const reused = this._reuseConstant(key, repeatable);
        if (reused !== undefined)
            return reused;

        const newString = `str:${key}::${Math.floor(this._rng() * 50)}`;
        this._constants.get(key).push(newString);
        return newString;
    }

    _reuseConstant(key, repeatable) {
        let previous = this._constants.get(key);
        if (previous === undefined) {
            previous = [];
            this._constants.set(key, previous);
        }

        if (repeatable && previous.length > 0 && coin(0.1, this._rng))
            return uniform(previous, this._rng);

        return undefined;
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

        return new Ast.DialogueHistoryResultList(null, results, new Ast.Value.Number(numResults), numResults > MORE_SIZE);
    }
}
module.exports = ThingTalkSimulator;
