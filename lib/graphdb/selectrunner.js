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

const UnionStream = require('./unionstream');

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
    pushProject() {}
    optimize() { return false; }
    computeScope() {}

    evaluate() {
        return Q([]);
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

    computeScope() {
        this.left.computeScope();
        this.right.computeScope();
        addAll(this.scope, this.left.scope);
        addAll(this.scope, this.right.scope);
    }
}

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

    evaluate(store) {
        var left = this.left.evaluate(store);
        var stream = new Stream.Readable({ objectMode: true, read: () => {
            // nested loop join
            // (with buffering optimization)
            // we load up to 10k solutions from the left table, and for each
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
                if (leftbuffer.length < 10000) {
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
        } });
        return stream;
    }
}

class LeftJoinQueryNode extends BinaryQueryNode {

}

class MinusQueryNode extends BinaryQueryNode {
    computeScope() {
        // variables in the MINUS {} part do not contribute to the scope (they must be in scope in some other way)
        this.left.computeScope();
        this.right.computeScope();
        this.scope = this.left.scope;
    }
}

class UnionQueryNode extends BinaryQueryNode {
    evaluate(store) {
        return new UnionStream([this.left.evaluate(store), this.right.evaluate(store)]);
    }
}

class BasicQueryNode extends QueryNode {
    constructor(runner, triples) {
        super(runner);
        this.triples = triples;
    }

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

class FilterQueryNode extends QueryNode {
    constructor(runner, child, expression) {
        super(runner);
        if (child === null)
            child = new EmptyQueryNode();
        this.child = child;
        this.expression = expression;
    }

    computeScope() {
        this.child.computeScope();
        this.scope = this.child.scope;
    }

    _evalExpression(solution) {
        return true;
    }

    evaluate(store) {
        var child = this.child.evaluate(store);
        var stream = new Stream.Readable({ objectMode: true, read: () => {
            child.on('data', (data) => {
                if (this._evalExpression(data))
                    stream.push(data);
            });
            child.on('end', () => stream.push(null));
        } });
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
        this.expression = expression;
    }

    computeScope() {
        this.child.computeScope();
        if (this.child.scope.has(this.variable))
            throw new Error('Variable ' + this.variable + ' is already in scope');
        addAll(this.scope, this.child.scope);
        this.scope.add(this.variable);
    }

    _evalExpression(solution) {
        throw new Error('Not Implemented');
    }

    evaluate(store) {
        var child = this.child.evaluate(store);
        var stream = new Stream.Readable({ objectMode: true, read: () => {
            child.on('data', (data) => {
                try {
                    data[this.variable] = this._evalExpression(data);
                } catch(e) {
                    console.error('Ignored error in evaluting expression: ' + e.message);
                }
                stream.push(data);
            });
            child.on('end', () => stream.push(null));
        } });
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

module.exports = class SelectRunner {
    constructor(stores, query) {
        this._stores = stores;

        this._query = query;
        this._from = this._query.from || { default: ['omlet://me'], named: [] };

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
        default:
            throw new Error('Unhandled pattern type ' + pattern.type);
        }
    }

    run() {
        console.log('Query:', this._query);

        var translated = this._translateGroup(this._query.where);

        for (var i = 0; i < this._query.variables.length; i++) {
            var variable = this._query.variables[i];
            if (typeof variable !== 'string') {
                translated = new ExtendQueryNode(this, translated, variable.variable, variable.expression);
                this._query.variables[i] = variable.variable;
            }
        }

        translated.computeScope();

        if (this._query.variables[0] !== '*')
            translated.pushProject(this._query.variables);

        var progress = false;
        do {
            progress = translated.optimize();
        } while(progress);

        var stream = translated.evaluate(this.getStore(this._from.default[0]));
        stream.on('end', this._closeAllStores.bind(this));
        stream.on('error', this._closeAllStores.bind(this));
        return stream;
    }
}
