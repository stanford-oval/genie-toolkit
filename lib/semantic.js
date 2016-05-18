// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const adt = require('adt');

const ThingTalk = require('thingtalk');

const LambdaForm = require('./lambda');

const ValueCategory = adt.data({
    YesNo: null,
    Number: null,
    Measure: { unit: adt.only(String) },
    RawString: null,
    Date: null,
    Gender: null,
    Unknown: null,
    Picture: null,
});

function valueToCategoryAndValue(value) {
    if (value.isList) {
        var mapped = value.value.map(valueToCategoryAndValue);
        return [mapped.map(function(x) { return x[0]; }), mapped.map(function(x) { return x[1]; })];
    } else if (value.isMeasure) {
        return [ValueCategory.Measure(value.unit), value.value];
    } else if (value.isNumber) {
        return [ValueCategory.Number, value.value];
    } else if (value.isString) {
        return [ValueCategory.RawString, value.value];
    } else if (value.isDate) {
        return [ValueCategory.Date, value.value];
    } else if (value.isAtom) {
        if (value.name.startsWith('tt:gender.')) {
            return [ValueCategory.Gender, value.name.substring('tt:gender.'.length,
                                                               value.name.length)];
        }
    }

    return [ValueCategory.Unknown, null];
}

// FINISHME: move this to actual thingpedia
const Parameter = adt.data({
    Constant: { value: adt.any },
    Input: { question: adt.only(String), type: adt.only(ThingTalk.Type) }
});

module.exports = class SemanticAnalyzer {
    constructor(lambda) {
        this.root = lambda;

        this.isSpecial = false;
        this.isAction = false;
        this.isQuestion = false;
        this.isRule = false;
        this.isYes = false;
        this.isNo = false;
        this.isValue = false;
    }

    _handleValue(value) {
        var mapped = valueToCategoryAndValue(value);
        this.category = mapped[0];
        this.value = mapped[1];
    }

    run() {
        if (this.root.isAtom && this.root.name.startsWith('tt:root.special.')) {
            if (this.root.name === 'tt:root.special.yes')
                this.isYes = true;
            else if (this.root.name === 'tt:root.special.no')
                this.isNo = true;
            else
                this.isSpecial = true;
        } else if (this.root.isApply && this.root.left.isAtom &&
                   this.root.left.name === 'tt:root.token.value') {
            this.isValue = true;
            this._handleValue(this.root.right);
        } else if (thisr.root.isApply && this.root.left.isAtom &&
                   this.root.left.name === 'tt:root.question.value') {
            this.isQuestion = true;
            if (!this.root.right.isString)
                throw new TypeError('Invalid argument to tt:root.question.value');
            this.query = this.root.right.value;
        } else if (this.root.isApply) {
            var call = null;
            var params = [];
            function uncurry(form) {
                if (form.isApply) {
                    uncurry(form.left);
                    params.push(form.right);
                } else if (form.isLambda) {
                    throw new TypeError('Unexpected lambda form not in normal form');
                } else {
                    call = form;
                }
            }
            uncurry(this.root);
            if (call.isVariable)
                throw new TypeError('Unbound variable ' + call.name);
            if (!call.isAtom)
                throw new TypeError('Unexpected call to ' + call.name);
            if (call.name.startsWith('tt:device.action.')) {
                this.isAction = true;
                this.channel = call.name.substr('tt:device.action.'.length);
                if (params.length === 0)
                    throw new TypeError('Missing parameters to action');
                if (!params[0].isAtom || !params[0].name.startsWith('tt:device.'))
                    throw new TypeError('Invalid first parameter to action (must be device)');
                this.kind = params[0].name.substr('tt:device.'.length);
                // FIXME typecheck kind/channelName combination
                this.params = params.slice(1);
                // FIXME schema here (requires a promise call to SchemaRetriever)
                if (this.kind === 'twitter' && this.channel === 'sink') {
                    this.schema = [Parameter.Input("What do you want me to tweet?",
                                                   ThingTalk.Type.String)];
                } else {
                    this.schema = [];
                }
            } else {
                throw new Error('Unhandled top-level call to ' + call.name);
            }
        } else if (this.root.isLambda) {
            throw new Error('FIXME: unhandled top-level lambda');
        } else {
            throw new TypeError('Invalid top-level ' + this.root);
        }
    }
}
module.exports.ValueCategory = ValueCategory;
