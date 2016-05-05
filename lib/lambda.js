// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const adt = require('adt');

const unit = require('./units');

const LambdaForm = adt.data(function() {
    return {
        Atom: { name: adt.only(String) },
        Apply: { left: adt.only(this),
                 right: adt.only(this) },
        Lambda: { varname: adt.only(String),
                  body: adt.only(this) },
        String: { value: adt.only(String) },
        Number: { value: adt.only(Number) },
        Measure: { value: adt.only(Number), unit: adt.only(String) },
        Date: { value: adt.only(Date) },
        Variable: { name: adt.only(String) },
        List: { value: adt.only(Array) }
    };
});
module.exports = LambdaForm;

function normalize(lambda) {
    if (lambda.isApply && lambda.left.isAtom &&
        lambda.left.name.startsWith('tt:value.unit.') &&
        lambda.right.isNumber) {
        var normalized = unit(lambda.right.value, lambda.left.name.substring('tt:value.unit.'.length, lambda.left.name.length));
        return LambdaForm.Measure(normalized[0], normalized[1]);
    }

    if (lambda.isString || lambda.isNumber || lambda.isMeasure ||
        lambda.isDate || lambda.isVariable || lambda.isAtom)
        return lambda;

    if (lambda.isApply)
        return LambdaForm.Apply(normalize(lambda.left), normalize(lambda.right));

    if (lambda.isLambda)
        return LambdaForm.Lambda(lambda.varname, normalize(lambda.body));

    if (lambda.isList)
        return LambdaForm.List(lambda.value.map(normalize));

    throw new TypeError();
}


LambdaForm.Parser = class LambdaFormParser {
    constructor(full) {
        this._full = full;
        this._idx = 0;
    }

    _eatString() {
        this._idx ++; // eat the open quote first
        var buffer = '';
        while (this._idx < this._full.length) {
            if (this._full[this._idx] === '"') {
                this._idx ++; // eat the close quote
                return buffer;
            }

            if (this._full[this._idx] === '\\') {
                if (this._idx === this._full.length-1)
                    throw new Error('Invalid escape');
                if (this._full[this._idx] === '"')
                    buffer += '"';
                else if (this._full[this._idx] === 'n')
                    buffer += '\n';
                else
                    throw new Error('Invalid escape');
                this._idx += 2;
            } else {
                buffer += this._full[this._idx];
                this._idx++;
            }
        }

        throw new Error('Invalid non terminated string');
    }

    _eatName() {
        var reg = /[0-9a-z:\._\-]+/ig;
        reg.lastIndex = this._idx;
        var match = reg.exec(this._full);
        if (match === null)
            throw new Error('Expected identifier');
        this._idx = reg.lastIndex;
        return match[0];
    }

    peekNextToken() {
        while (this._idx < this._full.length) {
            if (/\s/.test(this._full[this._idx]))
                this._idx++;
            break;
        }
        if (this._idx >= this._full.length)
            return null;

        if (this._full[this._idx] === '(')
            return '(';

        if (this._full[this._idx] === ')')
            return ')';

        if (this._full[this._idx] === '"') {
            var save = this._idx;
            var tok = this._eatString();
            this._idx = save;
            return tok;
        }

        var save = this._idx;
        var tok = this._eatName();
        this._idx = save;
        return tok;
    }

    nextToken() {
        while (this._idx < this._full.length) {
            if (/\s/.test(this._full[this._idx]))
                this._idx++;
            break;
        }
        if (this._idx >= this._full.length)
            throw new Error('Unexpected end of input');

        if (this._full[this._idx] === '(') {
            this._idx++;
            return '(';
        }

        if (this._full[this._idx] === ')') {
            this._idx++;
            return ')';
        }

        if (this._full[this._idx] === '"') {
            return this._eatString();
        }

        return this._eatName();
    }

    expect(what) {
        var token = this.nextToken();
        if (what !== token)
            throw new Error('Expected ' + what);
    }

    parseList() {
        var name = this.nextToken();
        if (name === '(') {
            var left = this.parseList();
            if (left.isString || left.isDate || left.isNumber)
                throw new Error('Cannot apply value ' + left);
            var right = this.parseAtom();
            this.expect(')');
            return LambdaForm.Apply(left, right);
        } else if (name === 'list') {
            var next = this.peekNextToken();
            var atoms = [];
            while (next !==  null && next !== ')') {
                atoms.push(this.parseAtom());
                next = this.peekNextToken();
            }
            this.expect(')');
            return LambdaForm.List(atoms);
        } else if (name === 'string') {
            var value = this.nextToken();
            if (value === '(' || value === ')')
                throw new Error('Expected string');
            this.expect(')');
            return LambdaForm.String(value);
        } else if (name === 'number') {
            var value = this.nextToken();
            if (value === '(' || value === ')')
                throw new Error('Expected number');
            this.expect(')');
            return LambdaForm.Number(parseFloat(value));
        } else if (name === 'date') {
            var now = new Date;
            var year = this.nextToken();
            var month = this.nextToken();
            var day = this.nextToken();
            if (year === '(' || year === ')' ||
                month === '(' || month === ')' ||
                day === '(' || day === ')')
                throw new Error('Expected date');
            if (year === '-1')
                year = now.getFullYear();
            if (month === '-1')
                month = now.getMonth()+1;
            var next = this.nextToken();
            if (next === ')')
                return LambdaForm.Date(new Date(year, month-1, day));
            var hour = next;
            var minute = this.nextToken();
            var second = this.nextToken();
            if (hour === '(' || hour === ')' ||
                minute === '(' || minute === ')' ||
                second === '(' || second === ')')
                throw new Error('Expected time');
            this.expect(')');
            return LambdaForm.Date(new Date(year, month-1, day, hour, minute,
                                   Math.floor(second), 1000*(second-Math.floor(second))))
        } else if (name === 'lambda') {
            var varname = this.nextToken();
            if (varname === '(' || varname === ')')
                throw new Error('Expected varname');
            var body = this.parseAtom();
            this.expect(')');
            return LambdaForm.Lambda(varname, body);
        } else if (name === 'var') {
            var varname = this.nextToken();
            this.expect(')');
            return LambdaForm.Variable(varname);
        } else {
            var left = LambdaForm.Atom(name);
            var right = this.parseAtom();
            this.expect(')');
            return LambdaForm.Apply(left, right);
        }
    }

    parseAtom() {
        var token = this.nextToken();
        if (token === '(')
            return this.parseList();
        else if (token === ')')
            throw new Error('Unexpected token close-paren');
        else
            return LambdaForm.Atom(token);
    }

    parse() {
        return normalize(this.parseAtom());
    }
}
