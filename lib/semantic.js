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
    var match = /^\(date\s+([\-0-9]+)\s+([\-0-9]+)\s+([\-0-9]+)(?:\s+([\-0-9]+)\s+([\-0-9]+)\s+([\-0-9\.]+))?\s*\)$/.exec(form);
    if (match === null)
        throw new TypeError('Invalid date ' + form);

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

function parseTime(form) {
    var match = /^\(date\s+([\-0-9]+)\s+([\-0-9]+)\s+([\-0-9]+)\s+([\-0-9]+)\s+([\-0-9]+)\s+([\-0-9\.]+)\s*\)$/.exec(form);
    if (match === null)
        throw new TypeError('Invalid time ' + form);

    var year = parseInt(match[1]);
    var month = parseInt(match[2]);
    var day = parseInt(match[3]);
    if (year >= 0 || month >= 0 || day >= 0)
        throw new TypeError('Invalid time ' + form);
    var hour = parseInt(match[4]);
    if (hour < 0)
        hour = now.getHours();
    var minute = parseInt(match[5]);
    if (minute < 0)
        minute = now.getMinutes();
    return (hour < 10 ? '0' + hour : hour) + ':' +
        (minute < 10 ? '0' + minute : minute);
}

function valueToCategoryAndValue(value) {
    switch(value.type) {
    case 'List':
        var mapped = value.value.map(valueToCategoryAndValue);
        return [mapped.map(function(x) { return x[0]; }),
                Ast.Value.Array(mapped.map(function(x) { return x[1]; }))];
    case 'Measure':
        return [ValueCategory.Measure(value.unit),
                Ast.Value.Measure(parseFloat(value.value), value.unit)];
    case 'Number':
        return [ValueCategory.Number,
                Ast.Value.Number(parseFloat(value.value))];
    case 'String':
        return [ValueCategory.RawString,
                Ast.Value.String(value.value)];
    case 'Time':
        return [ValueCategory.RawString,
                Ast.Value.String(parseTime(value.value))];
    case 'Date':
        return [ValueCategory.Date,
                Ast.Value.Date(parseDate(value.value))];
    case 'Bool':
        return [ValueCategory.YesNo,
                Ast.Value.Boolean(value.value === 'true')];
    case 'Choice':
        return [ValueCategory.MultipleChoice, value.value];
    default:
        throw new Error('Invalid value type ' + value.type);
    }
}

function mapArguments(args) {
    return args.map((arg) => {
        if (arg.name.startsWith('tt:param.'))
            arg.name = arg.name.substr('tt.param.'.length);
        return {
            name: arg.name,
            value: valueToCategoryAndValue(arg)[1],
            operator: arg.operator,
            assigned: false,
        };
    });
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
        this.isDiscovery = false;
        this.isConfigure = false;
        this.isHelp = false;
        this.isList = false;

        if ('special' in this.root) {
            var special = this._handleName(this.root.special);
            if (special === 'tt:root.special.yes')
                this.isYes = true;
            else if (special === 'tt:root.special.no')
                this.isNo = true;
            else
                this.isSpecial = true;
            this.special = special;
        } else if ('answer' in this.root) {
            this.isAnswer = true;
            this._handleValue(this.root.answer);
            if (this.category === ValueCategory.YesNo) {
                this.isYes = this.value.value === true;
                this.isNo = this.value.value === false;
            }
        } else if ('question' in this.root) {
            this.isQuestion = true;
            this.query = this.root.question;
        } else if ('action' in this.root) {
            this.handleAction(this.root.action);
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
        } else if ('discover' in this.root) {
            this.isDiscovery = true;
        } else if ('command' in this.root) {
            // \r {"command": {"type":"discover", "value":{"id":"fitbit"}}}
            // \r {"command": {"type":"list", "value":"devices"}}
            // \r {"command": {"type":"help", "value":{"id":"fitbit"}}}

            // commands are the product of rakesh's laziness (plus java
            // being annoying): he wrapped everything into a
            // CommandValue with a string because of reasons

            switch (this.root.command.type) {
            case 'action':
                this._handleAction(this.root.command.value);
                return;
            case 'discover':
                this.isDiscovery = true;
                this.name = this._handleName(this.root.command.value);
                if (this.name.startsWith('tt:device.'))
                    this.name = this.name.substr('tt:device.'.length);
                return;

            case 'list':
                this.isList = true;
                this.list = this.root.command.value;
                return;

            case 'help':
                // I don't want to trigger HelpDialog for a simple help
                // a bare help should be recognized at any point during any
                // dialog, hence a special
                if (!this.root.command.value || this.root.command.value === 'generic') {
                    this.isSpecial = true;
                    this.special = 'tt:root.special.help';
                } else {
                    this.isHelp = true;
                    this.help = this._handleName(this.root.command.value);
                }
            }
        } else {
            throw new TypeError('Invalid top-level');
        }
    }

    _handleSelector(sel) {
        sel = this._handleName(sel);

        var match = /^tt:([a-z0-9A-Z_]+)\.([a-z0-9A-Z_]+)$/.exec(sel);
        if (match === null)
            throw new TypeError('Invalid selector ' + sel);

        if (match[1] === 'builtin')
            match[1] = '$builtin';

        return [match[1], match[2]];
    }

    _handleName(name) {
        if (typeof name === 'string')
            return name;

        if (typeof name.id !== 'string')
            throw new TypeError('Invalid name');

        return name.id;
    }

    _handleValue(value) {
        var mapped = valueToCategoryAndValue(value);
        this.category = mapped[0];
        this.value = mapped[1];
    }

    _handleAction(action) {
        this.isAction = true;

        var parsed = this._handleSelector(action.name);
        this.kind = parsed[0];
        this.channel = parsed[1];
        this.args = mapArguments(action.args);
    }
}
module.exports.ValueCategory = ValueCategory;
