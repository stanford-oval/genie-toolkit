// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
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
    MultipleChoice: null,

    Number: null,
    Measure: { unit: adt.only(String) },
    RawString: null,
    Date: null,
    Time: null,
    Unknown: null,
    Picture: null,
    Location: null,
    PhoneNumber: null,
    EmailAddress: null,
    Contact: null,
    Command: null
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
    return [hour, minute];
}

function parseLocation(loc) {
    if (loc.relativeTag === 'absolute')
        return Ast.Value.Location(loc.longitude, loc.latitude);
    else
        return Ast.Value.VarRef('$context.location.' + loc.relativeTag.substr('rel_'.length));
}
function displayLocation(loc) {
    if (loc.relativeTag === 'absolute')
        return '[Latitude: ' + Number(loc.latitude).toFixed(3) + ' deg, Longitude: ' + Number(loc.longitude).toFixed(3) + ' deg]';
    else
        return loc.relativeTag.substr('rel_'.length);
}

function valueToCategoryAndValue(value) {
    if (value.type.startsWith('Entity(')) {
      return [ValueCategory.RawString,
              Ast.Value.Entity(value.value.value, value.type.substring('Entity('.length, value.type.length-1)),
              value.value.display];
    }

    switch(value.type) {
    case 'List':
        var mapped = value.value.map(valueToCategoryAndValue);
        return [mapped.map(function(x) { return x[0]; }),
                Ast.Value.Array(mapped.map(function(x) { return x[1]; })),
                mapped.map(function(x) { return x[2]; }).join(', ')];
    case 'Measure':
        var ttVal = Ast.Value.Measure(value.value.value, value.value.unit);
        // obtaining the type will normalize the unit to the base unit
        var type = Ast.typeForValue(ttVal);
        return [ValueCategory.Measure(type.unit), ttVal,
                value.value.value + ' ' + value.value.unit];
    case 'Number':
        return [ValueCategory.Number,
                Ast.Value.Number(value.value.value),
                String(value.value.value)];
    case 'String':
        return [ValueCategory.RawString,
                Ast.Value.String(value.value.value),
                '"' + value.value.value + '"'];
    case 'Enum':
        return [ValueCategory.RawString,
                Ast.Value.Enum(value.value.value),
                value.value.value];
    case 'URL':
        return [ValueCategory.RawString,
                Ast.Value.Entity(value.value.value, 'tt:url'),
                value.value.value];
    case 'Username':
        return [ValueCategory.RawString,
                Ast.Value.Entity(value.value.value, 'tt:username'),
                '@' + value.value.value];
    case 'Hashtag':
        return [ValueCategory.RawString,
                Ast.Value.Entity(value.value.value, 'tt:hashtag'),
                '#' + value.value.value];
    case 'Picture':
        return [ValueCategory.Picture,
                Ast.Value.Entity(value.value.value, 'tt:picture'),
                'picture'];
    case 'Time':
        var time = parseTime(value.value);
        return [ValueCategory.Time,
                Ast.Value.Time(time[0], time[1]),
                (time[0] + ':' + (time[1] < 10 ? '0' : '') + time[1])];
    case 'Date':
        var date = parseDate(value.value);
        return [ValueCategory.Date,
                Ast.Value.Date(date),
                date.toLocaleString()];
    case 'Bool':
        return [ValueCategory.YesNo,
                Ast.Value.Boolean(value.value.value),
                value.value.value ? 'on' : 'off'];
    case 'PhoneNumber':
        return [ValueCategory.PhoneNumber,
                Ast.Value.Entity(value.value.value, 'tt:phone_number'),
                value.value.display];
    case 'EmailAddress':
        return [ValueCategory.EmailAddress,
                Ast.Value.Entity(value.value.value, 'tt:email_address'),
                value.value.display];
    case 'Contact':
        return [ValueCategory.Contact,
                Ast.Value.VarRef('$contact(' + value.value.value + ')'),
                value.value.value];
    case 'Choice':
        return [ValueCategory.MultipleChoice, value.value, value.value];
    case 'Location':
        return [ValueCategory.Location, parseLocation(value.value),
                value.value.display || displayLocation(value.value)];
    case 'VarRef':
        var name = handleName(value.value);
        if (name.startsWith('tt:param.'))
            name = name.substr('tt:param.'.length);
        return [ValueCategory.Unknown, Ast.Value.VarRef(name), name.replace(/_/g, ' ').replace(/([^A-Z])([A-Z])/g, '$1 $2').toLowerCase()];
    default:
        throw new Error('Invalid value type ' + value.type);
    }
}

function mapArguments(args) {
    return args.map((arg) => {
        var name = handleName(arg.name);
        if (name.startsWith('tt:param.'))
            name = name.substr('tt:param.'.length);
        var value = valueToCategoryAndValue(arg);
        if (value[2])
            value[1].display = value[2];
        return {
            name: name,
            value: value[1],
            operator: arg.operator,
            assigned: false,
        };
    });
}

function handleName(name) {
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

const EASTER_EGGS = new Set(['tt:root.special.hello', 'tt:root.special.cool', 'tt:root.special.sorry', 'tt:root.special.thankyou']);

module.exports = class SemanticAnalyzer {
    constructor(json, raw, previousRaw, previousCandidates) {
        this.json = json;
        this.root = JSON.parse(json);
        this.raw = raw;
        this.exampleId = null;

        this.isSpecial = false;
        this.isEasterEgg = false;
        this.isFailed = false;
        this.isFallback = false;
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
        this.isSetting = false;
        this.isTrain = false;
        this.isMake = false;
        this.isBack = false;

        if ('example_id' in this.root)
            this.exampleId = this.root.example_id;

        if ('special' in this.root) {
            // separate the "specials" (ie, the single words we always try to match/paraphrase)
            // into yes/no answers, true specials and easter eggs
            // the true specials are those that have contextual behavior and get
            // sent to Dialog.handleGeneric, for example "never mind" and "train"
            // the yes/no answers are really just answers
            // the easter eggs trigger a few canned responses that DefaultDialog takes
            // care of (or trigger a "That's not what I expected" message outside of
            // DefaultDialog)
            var special = handleName(this.root.special);
            if (special === 'tt:root.special.yes') {
                this.isAnswer = true;
                this.category = ValueCategory.YesNo;
                this.isYes = true;
            } else if (special === 'tt:root.special.no') {
                this.isAnswer = true;
                this.category = ValueCategory.YesNo;
                this.isNo = true;
            } else if (special === 'tt:root.special.failed') {
                this.isSpecial = true;
                this.isFailed = true;
                this.special = special;
            } else if (special === 'tt:root.special.train') {
                this.isSpecial = true;
                this.isTrain = true;
                this.special = special;
                this.raw = previousRaw;
                this.fallbacks = previousCandidates;
            } else if (EASTER_EGGS.has(special)) {
                this.isEasterEgg = true;
                this.egg = special;
            } else {
                this.isSpecial = true;
                this.special = special;
            }
        } else if ('$$fallback' in this.root) {
            this.isSpecial = true;
            this.isFallback = true;
            this.special = 'tt:root.special.fallback';
            this.fallbacks = this.root.$$fallback;
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
            this.isAction = true;
            this._handlePrimitive(this.root.action, this);
        } else if ('trigger' in this.root) {
            this.isTrigger = true;
            this._handlePrimitive(this.root.trigger, this);
        } else if ('query' in this.root) {
            this.isQuery = true;
            this._handlePrimitive(this.root.query, this);
        } else if ('rule' in this.root) {
            this.isRule = true;
            this.once = !!this.root.rule.once;

            if (this.root.rule.trigger) {
                this.trigger = {
                    isTrigger: true,
                }
                this._handlePrimitive(this.root.rule.trigger, this.trigger);
            } else {
                this.trigger = null;
            }
            if (this.root.rule.query) {
                this.query = {
                    isQuery: true,
                }
                this._handlePrimitive(this.root.rule.query, this.query);
            } else {
                this.query = null;
            }
            if (this.root.rule.action) {
                this.action = {
                    isAction: true,
                }
                this._handlePrimitive(this.root.rule.action, this.action);
            } else {
                this.action = null;
            }
        } else if ('command' in this.root) {
            // commands are the product of rakesh's laziness (plus java
            // being annoying): he wrapped everything into a
            // CommandValue with a string because of reasons

            switch (this.root.command.type) {
                case 'discover':
                    var name = handleName(this.root.command.value);

                    if (name === 'generic') {
                        this.isDiscovery = true;
                    } else {
                        // treat 'discover foo' the same as 'configure foo'
                        this.isConfigure = true;
                        this.name = name;
                        if (this.name.startsWith('tt:device.'))
                            this.name = this.name.substr('tt:device.'.length);
                    }
                    return;

                case 'list':
                    this.isList = true;
                    this.list = this.root.command.value.value;
                    return;

                case 'help':
                    // I don't want to trigger HelpDialog for a simple help
                    // a bare help should be recognized at any point during any
                    // dialog, hence a special
                    var help = handleName(this.root.command.value);
                    if (!help || help === 'generic') {
                        // this will be converted back by HelpDialog
                        this.isSpecial = true;
                        this.special = 'tt:root.special.help';
                    } else {
                        this.isHelp = true;
                        this.name = help;
                        this.page = this.root.command.page || 0;
                        if (this.name.startsWith('tt:device.'))
                            this.name = this.name.substr('tt:device.'.length);
                        this.category = this.root.command.category;
                    }
                    return;
                case 'configure':
                    this.isConfigure = true;
                    this.name = handleName(this.root.command.value);
                    if (this.name.startsWith('tt:device.'))
                        this.name = this.name.substr('tt:device.'.length);
                    return;

                case 'setting':
                    this.isSetting = true;
                    this.name = handleName(this.root.command.value.name);
                    return;

                case 'make':
                    this.isMake = true;
                    this.name = handleName(this.root.command.value);
                    return;

                case 'back':
                    this.isBack = true;
                    return;
                }
        } else if ('discover' in this.root) {
            this.isDiscovery = true;
            this.discoveryType = this.root.discover.type;
            this.discoveryKind = this.root.discover.kind;
            this.discoveryName = this.root.discover.text;
        } else {
            throw new TypeError('Invalid top-level');
        }
    }

    static makeFailed(raw) {
        return new SemanticAnalyzer('{"special":"tt:root.special.failed"}', raw);
    }

    static makeFallbacks(raw, fallbacks) {
        return new SemanticAnalyzer(JSON.stringify({ $$fallback: fallbacks }), raw);
    }

    _handleSelector(sel) {
        sel = handleName(sel);

        var match = /^tt:(\$?[a-z0-9A-Z_\-]+)\.([a-z0-9A-Z_]+)$/.exec(sel);
        if (match === null)
            throw new TypeError('Invalid selector ' + sel);

        return [match[1], match[2]];
    }

    _handleValue(value) {
        var mapped = valueToCategoryAndValue(value);
        this.category = mapped[0];
        this.value = mapped[1];
        if (this.value instanceof Ast.Value)
            this.value.display = mapped[2];
    }

    _handlePrimitive(prim, into) {
        var parsed = this._handleSelector(prim.name);
        into.id = null;
        into.device = null;
        into.kind = parsed[0];
        into.channel = parsed[1];
        into.owner = prim.person ? Ast.Value.VarRef('$contact(' + prim.person + ')') : null;
        into.args = mapArguments(prim.args);
        if (Array.isArray(prim.slots))
            into.slots = new Set(prim.slots);
        else
            into.slots = new Set();
        if (prim.dynamic_type) {
            into.schema = {
                schema: prim.dynamic_type.types.map((t) => ThingTalk.Type.fromString(t)),
                args: prim.dynamic_type.args,
                argcanonicals: prim.dynamic_type.args,
                required: prim.dynamic_type.required,
                questions: []
            };
        }
    }
}
module.exports.ValueCategory = ValueCategory;
