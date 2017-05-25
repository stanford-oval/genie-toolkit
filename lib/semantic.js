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
const Type = ThingTalk.Type;

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

ValueCategory.fromValue = function fromValue(value) {
    if (typeof value === 'number')
        return ValueCategory.MultipleChoice;
    if (value.isVarRef)
        return ValueCategory.Unknown;

    var type = Ast.typeForValue(value);

    if (type.isEntity && type.type === 'tt:picture')
        return ValueCategory.Picture;
    else if (type.isEntity && type.type === 'tt:phone_number')
        return ValueCategory.PhoneNumber;
    else if (type.isEntity && type.type === 'tt:email_address')
        return ValueCategory.EmailAddress;
    else if (type.isEntity && type.type === 'tt:contact')
        return ValueCategory.Contact;
    else if (type.isEntity)
        return ValueCategory.RawString;
    else if (type.isBoolean)
        return ValueCategory.YesNo;
    else if (type.isString)
        return ValueCategory.RawString;
    else if (type.isNumber)
        return ValueCategory.Number;
    else if (type.isMeasure)
        return ValueCategory.Measure(type.unit);
    else if (type.isEnum)
        return ValueCategory.RawString;
    else if (type.isTime)
        return ValueCategory.Time;
    else if (type.isDate)
        return ValueCategory.Date;
    else
        return ValueCategory.Unknown;
}

function parseValue(value) {
    var parsed;
    var type = value.type;

    // first the special cases
    if (value.type === 'Measure')
        return Ast.Value.Measure(value.value.value, value.value.unit);
    if (value.type === 'Bool')
        return Ast.Value.Boolean(value.value.value);
    if (value.type === 'Enum')
        return Ast.Value.Enum(value.value.value);
    if (value.type === 'Choice')
        return value.value;
    if (value.type === 'VarRef') {
        var name = handleName(value.value);
        if (name.startsWith('tt:param.'))
            name = name.substr('tt:param.'.length);
        return Ast.Value.VarRef(name);
    }

    if (value.type === 'Contact')
        type = Type.Entity('tt:contact');
    else
        type = Type.fromString(value.type);

    if (type.isEntity) {
        parsed = Ast.Value.Entity(value.value.value, type.type);
        if (value.value.display)
            parsed.display = value.value.display;
    } else if (type.isString) {
        parsed = Ast.Value.String(value.value.value);
    } else if (type.isNumber) {
        parsed = Ast.Value.Number(value.value.value);
    } else if (type.isTime) {
        var [hour, minute] = parseTime(value.value);
        parsed = Ast.Value.Time(hour, minute);
    } else if (type.isDate) {
        var date = parseDate(value.value);
        parsed = Ast.Value.Date(date);
    } else if (type.isLocation) {
        parsed = parseLocation(value.value);
        if (value.value.display)
            parsed.display = value.value.display;
    } else {
        throw new Error('Invalid type ' + type);
    }

    return parsed;
}

function mapArguments(args) {
    return args.map((arg) => {
        var name = handleName(arg.name);
        if (name.startsWith('tt:param.'))
            name = name.substr('tt:param.'.length);
        return {
            name: name,
            value: parseValue(arg),
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

function handleSpecial(name) {
    name = handleName(name);
    if (name.startsWith('tt:root.special.'))
        name = name.substr('tt:root.special.'.length);
    return name;
}

function handleValue(obj, value) {
    var mapped = valueToCategoryAndValue(value);
    obj.category = mapped[0];
    obj.value = mapped[1];
    if (obj.value instanceof Ast.Value)
        obj.value.display = mapped[2];
}

function handleSelector(sel) {
    sel = handleName(sel);

    var match = /^tt:(\$?[a-z0-9A-Z_\-]+)\.([a-z0-9A-Z_]+)$/.exec(sel);
    if (match === null)
        throw new TypeError('Invalid selector ' + sel);

    return [match[1], match[2]];
}

function handlePrimitive(prim) {
    if (!prim)
        return null;

    var into = {};
    var parsed = handleSelector(prim.name);
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
    if (Array.isArray(prim.remoteSlots))
        into.remoteSlots = new Set(prim.remoteSlots);
    else
        into.remoteSlots = new Set();
    if (prim.dynamic_type) {
        into.schema = {
            schema: prim.dynamic_type.types.map((t) => ThingTalk.Type.fromString(t)),
            args: prim.dynamic_type.args,
            argcanonicals: prim.dynamic_type.args,
            required: prim.dynamic_type.required,
            questions: []
        };
    }
    return into;
}

const Intent = adt.data({
    // internally generated intents
    Failed: { raw: adt.only(String) },
    Fallback: { raw: adt.only(String), fallbacks: adt.only(Array) },
    Train: { raw: adt.only(String, null), fallbacks: adt.only(Array, null) },
    Back: null,
    Empty: null,
    Debug: null,
    Filter: null, // FIXME

    // special entries in the grammar
    NeverMind: null,
    Help: {
        name: adt.only(String, null),
        page: adt.only(Number),
        category: adt.only(String, null)
    },
    Make: null,

    Answer: { category: adt.only(ValueCategory), value: adt.only(Ast.Value, Number) },

    // thingtalk
    Rule: {
        trigger: adt.only(Object, null),
        query: adt.only(Object, null),
        action: adt.only(Object, null),
        once: adt.only(Boolean) },
    // same as Rule but with the added constraint that only one is not null
    Primitive: {
        trigger: adt.only(Object, null),
        query: adt.only(Object, null),
        action: adt.only(Object, null) },
    Setup: { person: adt.only(Ast.Value), rule: adt.any }
});

Intent.parse = function parse(root, raw, previousRaw, previousCandidates) {
    var intent;

    if ('special' in root) {
        // separate the "specials" (ie, the single words we always try to match/paraphrase)
        // into yes/no answers and true specials
        // the true specials are those that have contextual behavior and get
        // sent to Dialog.handleGeneric, for example "never mind" and "train"
        // the yes/no answers are really just answers
        var special = handleSpecial(root.special);
        switch (special) {
        case 'yes':
            intent = Intent.Answer(ValueCategory.YesNo, Ast.Value.Boolean(true));
            intent.isYes = true;
            intent.isNo = false;
            break;
        case 'no':
            intent = Intent.Answer(ValueCategory.YesNo, Ast.Value.Boolean(false));
            intent.isYes = false;
            intent.isNo = true;
            break;
        case 'failed':
            intent = Intent.Failed;
            break;
        case 'train':
            intent = Intent.Train(previousRaw, previousCandidates);
            intent.root = root;
            // return early to avoid the common path for .raw
            return intent;
        case 'makerule':
            intent = Intent.Make;
            break;
        case 'empty':
            intent = Intent.Empty;
            break;
        case 'back':
            intent = Intent.Back;
            break;
        case 'nevermind':
            intent = Intent.NeverMind;
            break;
        case 'debug':
            intent = Intent.Debug;
            break;
        case 'help':
            intent = Intent.Help(null, 0, null);
            break;
        default:
            throw new Error('Unrecognized special ' + special);
        }
    } else if ('answer' in root) {
        var value = parseValue(root.answer);
        var category = ValueCategory.fromValue(value);
        intent = Intent.Answer(category, value);
        if (category === ValueCategory.YesNo) {
            intent.isYes = value.value === true;
            intent.isNo = value.value === false;
        }
    } else if ('filter' in root) {
        intent = Intent.Filter;
    } else if ('action' in root) {
        intent = Intent.Primitive(null, null, handlePrimitive(root.action));
        // for compatibility with some ugly code in makedialog
        intent.action.root = root;
    } else if ('trigger' in root) {
        intent = Intent.Primitive(handlePrimitive(root.trigger), null, null);
        intent.trigger.root = root;
    } else if ('query' in root) {
        intent = Intent.Primitive(null, handlePrimitive(root.query), null);
        intent.query.root = root;
    } else if ('rule' in root) {
        intent = Intent.Rule(handlePrimitive(root.rule.trigger),
                             handlePrimitive(root.rule.query),
                             handlePrimitive(root.rule.action),
                             !!root.rule.once);
    } else if ('command' in root && root.command.type === 'help') {
        // I don't want to trigger HelpDialog for a simple help
        // a bare help should be recognized at any point during any
        // dialog, hence a special
        var help = handleName(root.command.value);
        if (!help || help === 'generic') {
            intent = Intent.Help(null, 0, null);
        } else {
            if (help.startsWith('tt:device.'))
                help = help.substr('tt:device.'.length);
            intent = Intent.Help(help, root.command.page || 0, root.command.category || null);
        }
    } else if ('setup' in root) {
        intent = Intent.Setup(Ast.Value.VarRef('$contact(' + root.setup.person + ')'), root.setup);
        delete intent.rule.person;
    }

    intent.root = root;
    intent.raw = raw;
    if ('example_id' in root)
        intent.exampleId = root.example_id;

    return intent;
}

Intent.parseString = function parseString(json, raw, previousRaw, previousCandidates) {
    var intent = this.parse(JSON.parse(json), raw, previousRaw, previousCandidates);
    intent.json = json;
    return intent;
}

module.exports.Intent = Intent;
module.exports.ValueCategory = ValueCategory;
