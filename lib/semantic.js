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
    var now = new Date;
    var year = form.year;
    if (year < 0)
        year = now.getFullYear();
    var month = form.month;
    if (month < 0)
        month = now.getMonth() + 1;
    var day = form.day;
    if (day < 0)
        day = now.getDate();
    var hour = 0, minute = 0, second = 0;
    hour = form.hour;
    if (hour < 0)
        hour = now.getHours();
    minute = form.minute;
    if (minute < 0)
        minute = now.getMinutes();
    second = form.second;
    if (second < 0)
        second = now.getSeconds();

    return new Date(year, month-1, day, hour, minute, second);
}

function parseTime(form) {
    var year = form.year;
    var month = form.month;
    var day = form.day;
    if (year >= 0 || month >= 0 || day >= 0)
        throw new TypeError('Invalid time ' + form);
    var hour = form.hour;
    if (hour < 0)
        hour = now.getHours();
    var minute = form.minute;
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
        return [ValueCategory.Measure(value.value.unit),
                Ast.Value.Measure(value.value.value, value.value.unit)];
    case 'Number':
        return [ValueCategory.Number,
                Ast.Value.Number(value.value.value)];
    case 'String':
        return [ValueCategory.RawString,
                Ast.Value.String(value.value.value)];
    case 'Time':
        return [ValueCategory.RawString,
                Ast.Value.String(parseTime(value.value))];
    case 'Date':
        return [ValueCategory.Date,
                Ast.Value.Date(parseDate(value.value))];
    case 'Bool':
        return [ValueCategory.YesNo,
                Ast.Value.Boolean(value.value.value)];
    case 'Choice':
        return [ValueCategory.MultipleChoice, value.value];
    default:
        throw new Error('Invalid value type ' + value.type);
    }
}

function mapArguments(args) {
    return args.map((arg) => {
        if (typeof arg.name === 'object')
            arg.name = arg.name.id;
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
        this.isTrigger = false;
        this.isQuery = false;
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
            this._handleAction(this.root.action);
        } else if ('trigger' in this.root) {
            this.isTrigger = true;

            var trigger = this._handleSelector(this.root.trigger.name);
            this.kind = trigger[0];
            this.channel = trigger[1];
            this.args = mapArguments(this.root.trigger.args);
            if (Array.isArray(this.root.trigger.slots))
                this.slots = new Set(this.root.trigger.slots);
            else
                this.slots = new Set();
        } else if ('query' in this.root) {
            this.isQuery = true;

            var query = this._handleSelector(this.root.query.name);
            this.kind = query[0];
            this.channel = query[1];
            this.args = mapArguments(this.root.query.args);
            if (Array.isArray(this.root.query.slots))
                this.slots = new Set(this.root.query.slots);
            else
                this.slots = new Set();
        } else if ('rule' in this.root) {
            this.isRule = true;

            var trigger = this._handleSelector(this.root.rule.trigger.name);
            this.trigger = {
                isTrigger: true,
                kind: trigger[0],
                channel: trigger[1],
                id: null,
                device: null,
                args: mapArguments(this.root.rule.trigger.args)
            };
            if (Array.isArray(this.root.rule.trigger.slots))
                this.trigger.slots = new Set(this.root.rule.trigger.slots);
            else
                this.trigger.slots = new Set();
            var action = this._handleSelector(this.root.rule.action.name);
            this.action = {
                isAction: true,
                kind: action[0],
                channel: action[1],
                id: null,
                device: null,
                args: mapArguments(this.root.rule.action.args)
            };
            if (Array.isArray(this.root.rule.action.slots))
                this.action.slots = new Set(this.root.rule.action.slots);
            else
                this.action.slots = new Set();
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
                this.list = this.root.command.value.value;
                return;

            case 'help':
                // I don't want to trigger HelpDialog for a simple help
                // a bare help should be recognized at any point during any
                // dialog, hence a special
                var help = this._handleName(this.root.command.value);
                if (!help || help === 'generic') {
                    this.isSpecial = true;
                    this.special = 'tt:root.special.help';
                } else {
                    this.isHelp = true;
                    this.help = help;
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

        if (typeof name !== 'object' || name === null)
            throw new TypeError('Invalid name');

        if (typeof name.id === 'string')
            return name.id;

        if (typeof name.value === 'string')
            return name.value;

        throw new TypeError('Invalid name');
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
        if (Array.isArray(action.slots))
            this.slots = new Set(action.slots);
        else
            this.slots = new Set();
    }
}
module.exports.ValueCategory = ValueCategory;
