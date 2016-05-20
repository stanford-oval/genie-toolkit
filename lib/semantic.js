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
const Ast = ThingTalk.Ast;

const ValueCategory = adt.data({
    YesNo: null,
    Number: null,
    Measure: { unit: adt.only(String) },
    RawString: null,
    Date: null,
    Unknown: null,
    Picture: null,
    MultipleChoice: null
});

function parseDate(form) {
    var match = /^\(date\\s+([\-0-9]+)\\s+([\-0-9]+)\\s+([\-0-9]+)(?:\\s+([\-0-9]+)\\s+([\-0-9]+)\\s+([\-0-9]+))?\\*\)$/.match(form);
    if (match === null)
        throw new Error('Invalid date ' + form);

    var now = new Date;
    var year = parseInt(match[1]);
    if (year < 0)
        year = now.getFullYear();
    var month = parseInt(match[2]);
    if (month < 0)
        month = now.getMonth() + 1;
    var day = parseInt(match[3]);
    if (day < 0)
        day = now.getDate();
    var hour = 0, minute = 0, second = 0;
    if (match.length > 3) {
        hour = parseInt(match[4]);
        if (hour < 0)
            hour = now.getHours();
        minute = parseInt(match[5]);
        if (minute < 0)
            minute = now.getMinutes();
        second = parseFloat(match[6]);
        if (second < 0)
            second = now.getSeconds();
    }

    return new Date(year, month-1, day, hour, minute, second);
}

function valueToCategoryAndValue(value) {
    switch(value.type) {
    case 'List':
        var mapped = value.value.map(valueToCategoryAndValue);
        return [mapped.map(function(x) { return x[0]; }),
                mapped.map(function(x) { return x[1]; })];
    case 'Measure':
        return [ValueCategory.Measure(value.unit),
                Ast.Value.Measure(value.value, value.unit)];
    case 'Number':
        return [ValueCategory.Number,
                Ast.Value.Number(value.value)];
    case 'String':
        return [ValueCategory.RawString,
                Ast.Value.String(value.value)];
    case 'Time':
    case 'Date':
        return [ValueCategory.Date,
                Ast.Value.Date(parseDate(value.value))];
    case 'Choice':
        return [ValueCategory.MultipleChoice, value.value];
    default:
        return [ValueCategory.Unknown, null];
    }
}

function mapArguments(args) {
    var res = {};
    for (var arg of args)
        res[arg.name] = valueToCategoryAndValue(arg)[1];
    return res;
}

module.exports = class SemanticAnalyzer {
    constructor(obj) {
        this.root = obj;

        this.isSpecial = false;
        this.isAction = false;
        this.isQuestion = false;
        this.isRule = false;
        this.isYes = false;
        this.isNo = false;
        this.isAnswer = false;

        if ('special' in this.root) {
            if (this.root.special === 'tt:root.special.yes')
                this.isYes = true;
            else if (this.root.special === 'tt:root.special.no')
                this.isNo = true;
            else
                this.isSpecial = true;
            this.special = this.root.special;
        } else if ('answer' in this.root) {
            this.isAnswer = true;
            this._handleValue(this.root.answer);
        } else if ('question' in this.root) {
            this.isQuestion = true;
            this.query = this.root.question;
        } else if ('action' in this.root) {
            this.isAction = true;

            var parsed = this._handleSelector(this.root.action.name);
            this.kind = parsed[0];
            this.channel = parsed[1];
            this.args = mapArguments(this.root.action.args);
        } else if ('rule' in this.root) {
            this.isRule = true;

            var trigger = this._handleSelector(this.root.rule.trigger.name);
            this.trigger = {
                isTrigger: true,
                kind: trigger[0],
                channel: trigger[1],
                args: mapArguments(this.root.rule.trigger.args)
            };
            var action = this._handleSelector(this.root.rule.action.name);
            this.action = {
                isAction: true,
                kind: action[0],
                channel: action[1],
                args: mapArguments(this.root.rule.action.args)
            };
        } else {
            throw new TypeError('Invalid top-level');
        }
    }

    _handleSelector(sel) {
        var match = /^tt:([a-z0-9A-Z]+)\.([a-z0-9A-Z]+)$/.exec(sel);
        if (match === null)
            throw new Error('Invalid selector ' + sel);

        return [match[1], match[2]];
    }

    _handleValue(value) {
        var mapped = valueToCategoryAndValue(value);
        this.category = mapped[0];
        this.value = mapped[1];
    }
}
module.exports.ValueCategory = ValueCategory;
