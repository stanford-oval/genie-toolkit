// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const util = require('util');
const Stream = require('stream');

const Constants = require('./constants');
const UnionStream = require('./unionstream');
const SortStream = require('./sortstream');

function addAll(set, iterable) {
    for (var v of iterable)
        set.add(v);
}

var _id = 0;

class QueryNode {
    constructor(runner) {
        this.runner = runner;
        this.scope = new Set();
        this.id = _id++;
    }

    pushProject(variables) {
        //throw new Error('Not Implemented');
        return false;
    }

    computeScope() {
        throw new Error('Not Implemented');
    }

    lower() {}

    optimize() {
        //throw new Error('Not Implemented');
        return false;
    }

    evaluate() {
        throw new Error('Not Implemented');
    }
}

// A query node that always produces the empty dataset
class EmptyQueryNode extends QueryNode {
    pushProject() { return false; }
    optimize() { return false; }
    lower() {}
    computeScope() {}
    inspect() { return '[empty]'; }

    evaluate() {
        var stream = new Stream.Readable({ read: function() { } });
        stream.push(null);
        return stream;
    }
}

// Base class for binary operations on result sets (join, semijoin, set difference, union)
class BinaryQueryNode extends QueryNode {
    constructor(runner, left, right) {
        super(runner);
        if (left === null)
            left = new EmptyQueryNode();
        this.left = left;
        this.right = right;
    }

    lower() {
        this.left.lower();
        this.right.lower();
    }

    computeScope() {
        this.left.computeScope();
        this.right.computeScope();
        addAll(this.scope, this.left.scope);
        addAll(this.scope, this.right.scope);
    }
}

const MAX_JOIN_BUFFER = 128*1024;

class JoinQueryNode extends BinaryQueryNode {
    _doJoin(s1, s2) {
        for (var name in s1) {
            if (name in s2) {
                if (s1[name] !== s2[name])
                    return null;
            } else
                s2[name] = s1[name];
        }
        return s2;
    }

    inspect() { return { type: 'join', left: this.left, right: this.right }; }

    evaluate(store) {
        var left = this.left.evaluate(store);
        var stream = new Stream.Readable({ objectMode: true, read: () => {} });
        // nested loop join
        // (with buffering optimization)
        // we load up to 128k solutions from the left table, and for each
        // load we do a full read of the right table

        var leftbuffer = [];
        var first = true;

        var flushleft = (buffer, resume) => {
            var right = this.right.evaluate(store);
            right.on('data', (rightData) => {
                buffer.forEach((leftData) => {
                    // rightData can be modified here, but leftData cannot
                    // it's important that the order of arguments is preserved
                    var joined = this._doJoin(leftData, rightData);
                    if (joined !== null)
                        stream.push(joined);
                });
            });
            right.on('end', (rightData) => {
                if (resume)
                    left.resume();
                else
                    stream.push(null);
            });
            right.on('error', (e) => stream.emit('error', e));
        }

        left.on('data', (leftData) => {
            if (leftbuffer.length < MAX_JOIN_BUFFER) {
                leftbuffer.push(leftData);
                return;
            }

            var toJoin = leftbuffer;
            leftbuffer = [];

            left.pause();
            flushleft(toJoin, true);
        });
        left.on('end', () => {
            var toJoin = leftbuffer;
            leftbuffer = [];
            flushleft(toJoin, false);
        });
        left.on('error', (e) => stream.emit('error', e));
        return stream;
    }
}

class LeftJoinQueryNode extends BinaryQueryNode {
    inspect() { return { type: 'leftjoin', left: this.left, right: this.right }; }
}

class MinusQueryNode extends BinaryQueryNode {
    computeScope() {
        // variables in the MINUS {} part do not contribute to the scope (they must be in scope in some other way)
        this.left.computeScope();
        this.right.computeScope();
        this.scope = this.left.scope;
    }

    inspect() { return { type: 'minus', left: this.left, right: this.right }; }
}

class UnionQueryNode extends BinaryQueryNode {
    evaluate(store) {
        return new UnionStream([this.left.evaluate(store), this.right.evaluate(store)]);
    }

    inspect() { return { type: 'union', left: this.left, right: this.right }; }
}

class BasicQueryNode extends QueryNode {
    constructor(runner, triples) {
        super(runner);
        this.triples = triples;
    }

    inspect() { return { type: 'bgp', triples: this.triples }; }

    computeScope() {
        for (var triple of this.triples) {
            if (triple.subject.startsWith('?'))
                this.scope.add(triple.subject);
            if (triple.predicate.startsWith('?'))
                this.scope.add(triple.predicate);
            if (triple.object.startsWith('?'))
                this.scope.add(triple.object);
        }
    }

    evaluate(store) {
        return store.get(this.triples);
    }
}

const SparqlOperations = {
    '+': function(a, b) { return a + b; },

    // FIXME handle literals properly
    '=': function(a, b) { return a === b; },
    '!=': function(a, b) { return a !== b; }
}

function compileExpression(expression) {
    if (typeof expression === 'string') {
        if (expression.startsWith('?'))
            return (function(data) { return data[expression]; });

        var match = /^"(0-9)+"\^\^http:\/\/www\.w3\.org\/2001\/XMLSchema#integer$/.exec(expression);
        if (match !== null) {
            var v = parseInt(match[1]);
            return function() { return v; }
        }

        return (function() { return expression; });
    } else if (expression.type === 'operation') {
        var op = SparqlOperations[expression.operator];
        if (typeof op !== 'function')
            throw new Error("Invalid operator " + expression.operator);

        var argop = expression.args.map(compileExpression);
        return function(data) {
            var args = argop.map(function(op) { return op(data); });
            return op.apply(null, args);
        }
    } else {
        throw new Error("Invalid expression type " + expression.type);
    }
}

class FilterQueryNode extends QueryNode {
    constructor(runner, child, expression) {
        super(runner);
        if (child === null)
            child = new EmptyQueryNode();
        this.child = child;
        this.expression = compileExpression(expression);
    }

    inspect() { return { type: 'filter', child: this.child }; }

    lower() {
        this.child.lower();
    }

    computeScope() {
        this.child.computeScope();
        this.scope = this.child.scope;
    }

    evaluate(store) {
        var child = this.child.evaluate(store);
        var stream = new Stream.Readable({ objectMode: true, read: () => { child.resume(); } });
        child.on('data', (data) => {
            if (this.expression(data)) {
                if (!stream.push(data))
                    child.pause();
            }
        });
        child.pause();
        child.on('end', () => stream.push(null));
        child.on('error', (e) => stream.emit('error', e));
        return stream;
    }
}

class ExtendQueryNode extends QueryNode {
    constructor(runner, child, variable, expression) {
        super(runner);
        if (child === null)
            child = new EmptyQueryNode();
        this.child = child;
        this.variable = variable;
        this.expression = compileExpression(expression);
    }

    inspect() { return { type: 'extend', variable: this.variable, child: this.child }; }

    lower() {
        this.child.lower();
    }

    computeScope() {
        this.child.computeScope();
        if (this.child.scope.has(this.variable))
            throw new Error('Variable ' + this.variable + ' is already in scope');
        addAll(this.scope, this.child.scope);
        this.scope.add(this.variable);
    }

    evaluate(store) {
        var child = this.child.evaluate(store);
        var stream = new Stream.Readable({ objectMode: true, read: () => { child.resume(); } });
        child.on('data', (data) => {
            try {
                data[this.variable] = this._evalExpression(data);
            } catch(e) {
                console.error('Ignored error in evaluting expression: ' + e.message);
            }
            if (!stream.push(data))
                child.pause();
        });
        child.pause();
        child.on('end', () => stream.push(null));
        child.on('error', (e) => stream.emit('error', e));
        return stream;
    }
}

// A query node that involves a remote graph
// This is where (most of) the magic happens
class GraphQueryNode extends QueryNode {
    constructor(runner, name, group) {
        super(runner);
        if (group === null)
            group = new EmptyQueryNode();
        this.group = null;

        this._messaging = runner.messaging;
        this.name = name;
        this._nameIsVar = name.startsWith('?');
        if (this._nameIsVar)
            this._uri = null;
        else
            this._uri = name;
    }

    inspect() { return { type: 'graph', name: this.name, child: this.child }; }

    lower() {
        this.child.lower();
    }

    computeScope() {
        this.group.computeScope();
        addAll(this.scope, this.group.scope);
        this._nameInScope = false;
        if (this._nameIsVar) {
            if (this.scope.contains(this.name))
                this._nameInScope = true;
            else
                this.scope.add(this.name);
        }
    }

    evaluate(store) {
        if (this._uri) {
            return this.child.evaluate(this.runner.getStore(this._uri));
        } else {
            var stores = this.runner.getAllStores();
            var streams = stores.map((store) => this.child.evaluate(store));
            return new UnionStream(streams, (i, solution) => {
                var store = stores[i];
                if (this._nameInScope) {
                    if (solution[this._name] === store.uri)
                        return true;
                    else
                        return false;
                } else if (this._nameIsVar) {
                    solution[this._name] = store.uri;
                    return true;
                }
            });
        }
    }
}

class ProjectQueryNode extends QueryNode {
    constructor(runner, child, variables) {
        super(runner);

        if (child === null)
            child = new EmptyQueryNode();
        this.child = child;
        this.variables = new Set(variables);
    }

    inspect() { return { type: 'project', variables: Array.from(this.variables), child: this.child }; }

    computeScope() {
        this.child.computeScope();
        for (var v of this.variables) {
            if (!this.child.scope.has(v))
                throw new Error('Variable ' + v + ' is not in scope');
        }
        // project limits scope to only declared variables
        this.scope = this.variables;
    }

    lower() {
        this.child.lower();
    }

    optimize() {
        var progress;

        progress = this.child.pushProject(this.variables);
        progress = this.child.optimize() || progress;

        return progress;
    }

    evaluate(store) {
        var child = this.child.evaluate(store);
        var stream = new Stream.Readable({ objectMode: true, read: () => { child.resume(); } });
        child.on('data', (data) => {
            var solution = {};
            for (var name of this.variables.values())
                solution[name] = data[name];
            if (!stream.push(solution))
                child.pause();
        });
        child.pause();
        child.on('end', () => stream.push(null));
        child.on('error', (e) => stream.emit('error', e));
        return stream;
    }
}

class SortQueryNode extends QueryNode {
    constructor(runner, child, compare) {
        super(runner);

        if (child === null)
            child = new EmptyQueryNode();
        this.child = child;

        this._compare = compare;
    }

    inspect() { return { type: 'sort', child: this.child }; };

    lower() {
        this.child.lower();
    }

    computeScope() {
        this.child.computeScope();
        this.scope = this.child.scope;
    }

    evaluate(store) {
        var child = this.child.evaluate(store);
        var stream = new SortStream(child, this._compare);
        return stream;
    }

    optimize() {
        var progress = false;

        // optimize multiple sort query nodes in a row
        if (this.child instanceof SortQueryNode) {
            var sort = this.child;
            this._compare = intersectionCompare([this._compare, sort._compare]);
            this.child = sort.child;
            progress = true;
        }

        progress = this.child.optimize() || progress;
    }
}

function compileOneCompare(exp) {
    return function(a, b) {
        var v1 = exp(a);
        var v2 = exp(b);

        if (v1 < v2)
            return -1;
        else if (v2 < v1)
            return +1;
        else
            return 0;
    }
}

function intersectionCompare(compares) {
    return function(a, b) {
        for (var c of compares) {
            var r = c(a, b);
            if (r < 0 || r > 0)
                return r;
        }

        return 0;
    }
}

function compileCompare(compares) {
    if (compares.length > 1)
        return intersectionCompare(compares.map(compileOneCompare));
    else
        return compileOneCompare(compares[0]);
}

const SparqlAggregations = {
    'count': { init: 0, incr: function(state, data) { return state + 1; } },
    'sum': { init: 0, incr: function(state, data) { return state + data; } },
}

class AggregateQueryNode extends QueryNode {
    constructor(runner, child, aggregations, groupBys) {
        super(runner);

        if (child === null)
            child = new EmptyQueryNode();
        this.child = child;
        this.aggregations = aggregations.map(function(a) {
            var expr = compileExpression(a.expression.expression);
            var aggr = SparqlAggregations[a.expression.aggregation];
            if (typeof aggr !== 'object')
                throw new Error('Invalid aggregation ' + aggr);
            var incr = aggr.incr;
            return ({ expression: expr, init: aggr.init, state: aggr.init,
                      prev: null, distinct: !!a.distinct,
                      increment: incr, variable: a.variable });
        });

        this.groupBys = groupBys.map(function(g) {
            var expr = compileExpression(g.expression);
            var bind = typeof g.expression === 'string' ? g.expression : g.expression.variable;
            return ({ expression: expr, state: null, variable: bind });
        });
        this._groupByCompare = compileCompare(this.groupBys.map(function(g) { return g.expression; }));
    }

    inspect() { return { type: 'aggregate', aggregations: this.aggregations, child: this.child }; }

    lower() {
        for (var aggr of this.aggregations) {
            if (aggr.distinct)
                this.child = new SortQueryNode(this.runner, this.child, compileOneCompare(aggr.expression));
        }
        if (this.groupBys.length > 0)
            this.child = new SortQueryNode(this.runner, this.child, this._groupByCompare);
        this.child.lower();
    }

    computeScope() {
        this.child.computeScope();
        this.scope = new Set();
        for (var aggr of this.aggregations)
            this.scope.add(aggr.variable);
        for (var groupBy of this.groupBys) {
            if (groupBy.variable)
                this.scope.add(groupBy.variable);
        }
    }

    evaluate(store) {
        var child = this.child.evaluate(store);
        var stream = new Stream.Readable({ objectMode: true, read: () => { child.resume(); } });
        function flushGroup() {
            var solution = {};
            for (var aggr of this.aggregations) {
                solution[aggr.variable] = aggr.state;
                aggr.state = aggr.init;
                aggr.prev = null;
            }
            for (var groupBy of this.groupBys) {
                if (groupBy.variable)
                    solution[groupBy.variable] = groupBy.state;
            }
            if (!stream.push(solution))
                child.pause();
        }

        child.on('data', (data) => {
            var newGroup = false;
            for (var groupBy of this.groupBys) {
                var val = groupBy.expression(data);
                if (groupBy.state !== null && val !== groupBy.state)
                    newGroup = true;
                groupBy.state = val;
            }
            if (newGroup)
                flushGroup.call(this);

            for (var aggr of this.aggregations) {
                var val = aggr.expression(data);
                if (aggr.distinct && aggr.prev === val)
                    continue;
                aggr.prev = val;
                aggr.state = aggr.increment(aggr.state, val);
            }
        });
        child.on('end', () => {
            flushGroup.call(this);
            stream.push(null);
        });
        child.pause();
        child.on('error', (e) => stream.emit('error', e));
        return stream;
    }
}

class DistinctQueryNode extends QueryNode {
    constructor(runner, child, aggregations, groupBys) {
        super(runner);

        if (child === null)
            child = new EmptyQueryNode();
        this.child = child;
    }

    inspect() { return { type: 'distinct', child: this.child }; }

    lower() {
        var compares = Array.from(this.scope).map(function(variable) {
            return compileExpression(variable);
        });

        this.child = new SortQueryNode(this.runner, this.child, compileCompare(compares));
        this.child.lower();
    }

    computeScope() {
        this.child.computeScope();
        this.scope = this.child.scope;
    }

    evaluate(store) {
        var child = this.child.evaluate(store);
        var stream = new Stream.Readable({ objectMode: true, read: () => { child.resume(); } });

        var state = null;
        function isEqual(state, data) {
            if (state === null)
                return false;

            var stateKeys = Object.keys(state);
            var dataKeys = Object.keys(data);
            if (stateKeys.length !== dataKeys.length)
                return false;

            if (!stateKeys.every(function(k) { return state[k] === data[k]; }))
                return false;

            return true;
        }
        child.on('data', (data) => {
            if (!isEqual(state, data)) {
                state = data;
                if (!stream.push(data))
                    child.pause();
            }
        });
        child.on('end', () => {
            stream.push(null);
        });
        child.pause();
        child.on('error', (e) => stream.emit('error', e));
        return stream;
    }
}

module.exports = class SelectRunner {
    constructor(stores, query) {
        this._stores = stores;

        this._query = query;
        this._from = this._query.from || { default: [Constants.ME], named: [] };

        this._openedStores = {};
    }

    getStore(uri) {
        if (this._openedStores[uri])
            return this._openedStores[uri];

        var store = this._stores.getStore(uri);
        this._openedStores[uri] = store;
        store.ref();
        return store;
    }

    getAllStores() {
        return this._from.named.map((iri) => this.getStore(iri));
    }

    _closeAllStores() {
        for (var uri in this._openedStores)
            this._openedStores[uri].unref();
        this._openedStores = {};
    }

    _translateGroup(group) {
        if (group.length === 0)
            return new EmptyQueryNode();
        if (group.length === 1)
            return this._translatePattern(group[0]);

        var join = null;
        for (var e of group) {
            if (e.type === 'optional')
                join = new LeftJoinQueryNode(this, join, this._translatePattern(e));
            else if (e.type === 'minus')
                join = new MinusQueryNode(this, join, this._translatePattern(e));
            else if (e.type === 'bind')
                join = new ExtendQueryNode(this, join, e.variable, e.expression);
            else if (e.type === 'filter')
                join = new FilterQueryNode(this, join, e.expression);
            else if (join === null)
                join = this._translatePattern(e);
            else
                join = new JoinQueryNode(this, join, this._translatePattern(e));
        }

        return join;
    }

    _translateUnion(union) {
        if (union.length === 1)
            return this._translatePattern(union[0]);

        var result = null;
        for (var e of union) {
            if (result === null)
                result = this._translatePattern(e);
            else
                result = new UnionQueryNode(this, result, this._translatePattern(e));
        }

        return result;
    }

    _translatePattern(pattern) {
        switch (pattern.type) {
        case 'union':
            return this._translateUnion(pattern.patterns);
        case 'bgp':
            return new BasicQueryNode(this, pattern.triples);
        case 'graph':
            return new GraphQueryNode(this, pattern.name, this._translateGroup(pattern.patterns));
        case 'group':
        case 'minus':
        case 'optional':
            return this._translateGroup(pattern.patterns);
        case 'query':
            return this._translateQuery(pattern);
        default:
            throw new Error('Unhandled pattern type ' + pattern.type);
        }
    }

    _translateQuery(query) {
        var translated = this._translateGroup(query.where);
        var aggregations = [];

        for (var i = 0; i < query.variables.length; i++) {
            var variable = query.variables[i];
            if (typeof variable !== 'string') {
                if (variable.expression.type === 'aggregate')
                    aggregations.push(variable);
                else
                    translated = new ExtendQueryNode(this, translated, variable.variable, variable.expression);
                query.variables[i] = variable.variable;
            }
        }

        if (aggregations.length > 0)
            translated = new AggregateQueryNode(this, translated, aggregations, query.group || []);

        if (query.variables[0] !== '*')
            translated = new ProjectQueryNode(this, translated, query.variables);

        if (!!query.distinct)
            translated = new DistinctQueryNode(this, translated);

        // FINISHME order by
        // FINISHME limit

        return translated;
    }

    run() {
        console.log('Query:', util.inspect(this._query, { depth: null }));

        var translated = this._translateQuery(this._query);
        translated.computeScope();
        translated.lower();

        var progress = false;
        do {
            progress = translated.optimize();
        } while(progress);

        console.log('Translated:', util.inspect(translated, { depth: null }));

        var stream = translated.evaluate(this.getStore(this._from.default[0]));
        stream.on('end', (e) => {
            this._closeAllStores();
        });
        stream.on('error', (e) => {
            console.log('Error: ' + e.stack);
            this._closeAllStores();
        });
        return stream;
    }
}
