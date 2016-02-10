// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const adt = require('adt');

const LambdaForm = adt.data(function() {
    return {
        Atom: { name: adt.only(String) },
        Apply: { left: adt.only(this),
                 right: adt.only(this) },
        Lambda: { varname: adt.only(String),
                  body: adt.only(this) },
        String: { value: adt.only(String) },
        Number: { value: adt.only(Number) },
        Date: { value: adt.only(Date) },
        Variable: { name: adt.only(String) },
    };
});
module.exports = LambdaForm;

LambdaForm.Parser = new lang.Class({
    Name: 'LambdaFormParser',

    _init: function(full) {
        this._full = full;
        this._idx = 0;
    },

    _eatString: function() {
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
    },

    _eatName: function() {
        var reg = /[0-9a-z:\.]+/ig;
        reg.lastIndex = this._idx;
        var match = reg.exec(this._full);
        if (match === null)
            throw new Error('Expected identifier');
        this._idx = reg.lastIndex;
        return match[0];
    },

    nextToken: function() {
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
    },

    expect: function(what) {
        var token = this.nextToken();
        if (what !== token)
            throw new Error('Expected ' + what);
    },

    parseList: function() {
        var name = this.nextToken();
        if (name === '(') {
            var left = this.parseList();
            if (left.isString || left.isDate || left.isNumber)
                throw new Error('Cannot apply value ' + left);
            var right = this.parseAtom();
            return LambdaForm.Apply(left, right);
        } else if (name === 'string') {
            var value = this.nextToken();
            if (value === '(' || value === ')')
                throw new Error('Expected string');
            this.expect(')');
            return LambdaForm.String(value);
        } else if (name === 'date') {
            var year = this.nextToken();
            var month = this.nextToken();
            var day = this.nextToken();
            if (year === '(' || year === ')' ||
                month === '(' || month === ')' ||
                day === '(' || day === ')')
                throw new Error('Expected date');
            this.expect(')');
            return LambdaForm.Date(new Date(year, month, day));
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
    },

    parseAtom: function() {
        var token = this.nextToken();
        if (token === '(')
            return this.parseList();
        else if (token === ')')
            throw new Error('Unexpected token close-paren');
        else
            return LambdaForm.Atom(token);
    },

    parse: function() {
        return this.parseAtom()
    }
});
