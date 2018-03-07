// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const adt = require('adt');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const SEMPRESyntax = ThingTalk.SEMPRESyntax;

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
    Predicate: null,
    PermissionResponse: null,
    Command: null
});

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
    else if (type.isLocation)
        return ValueCategory.Location;
    else
        return ValueCategory.Unknown;
}

ValueCategory.toAskSpecial = function toAskSpecial(expected) {
    let what;
    if (expected === ValueCategory.YesNo)
        what = 'yesno';
    else if (expected === ValueCategory.Location)
        what = 'location';
    else if (expected === ValueCategory.Picture)
        what = 'picture';
    else if (expected === ValueCategory.PhoneNumber)
        what = 'phone_number';
    else if (expected === ValueCategory.EmailAddress)
        what = 'email_address';
    else if (expected === ValueCategory.Contact)
        what = 'contact';
    else if (expected === ValueCategory.Number)
        what = 'number';
    else if (expected === ValueCategory.Date)
        what = 'date';
    else if (expected === ValueCategory.Time)
        what = 'time';
    else if (expected === ValueCategory.Command)
        what = 'command';
    else if (expected !== null)
        what = 'generic';
    else
        what = null;
    return what;
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

const Intent = adt.data({
    // internally generated intents
    Failed: { raw: adt.only(String) },
    Fallback: { raw: adt.only(String), fallbacks: adt.only(Array) },
    Train: { raw: adt.only(String, null), fallbacks: adt.only(Array, null) },
    Back: { raw: adt.only(String, null) },
    Empty: { raw: adt.only(String, null) },
    Debug: { raw: adt.only(String, null) },
    Maybe: { raw: adt.only(String, null) },
    Filter: { raw: adt.only(String, null), filter: adt.only(Ast.Filter) },

    // special entries in the grammar
    NeverMind: { raw: adt.only(String, null) },
    Help: {
        raw: adt.only(String, null),
        name: adt.only(String, null),
        page: adt.only(Number),
        category: adt.only(String, null)
    },
    Make: { raw: adt.only(String, null) },

    Answer: { raw: adt.only(String, null), category: adt.only(ValueCategory), value: adt.only(Ast.Value, Number) },

    // thingtalk
    Program: {
        raw: adt.only(String, null),
        program: adt.only(Ast.Program)
    },
    Primitive: {
        raw: adt.only(String, null),
        primitiveType: adt.only('trigger', 'query', 'action'),
        primitive: adt.only(Ast.RulePart)
    },
    Predicate: {
        raw: adt.only(String, null),
        predicate: adt.only(Ast.BooleanExpression)
    },
    Setup: {
        raw: adt.only(String, null),
        program: adt.only(Ast.Program)
    },
    PermissionRule: {
        raw: adt.only(String, null),
        rule: adt.only(Ast.PermissionRule)
    }
});

Intent.parse = function parse(root, schemaRetriever, raw, previousRaw, previousCandidates) {
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
            intent = new Intent.Answer(raw, ValueCategory.YesNo, Ast.Value.Boolean(true));
            intent.isYes = true;
            intent.isNo = false;
            break;
        case 'no':
            intent = new Intent.Answer(raw, ValueCategory.YesNo, Ast.Value.Boolean(false));
            intent.isYes = false;
            intent.isNo = true;
            break;
        case 'failed':
            intent = new Intent.Failed(raw);
            break;
        case 'train':
            intent = new Intent.Train(previousRaw, previousCandidates);
            break;
        case 'makerule':
            intent = new Intent.Make(raw);
            break;
        case 'empty':
            intent = new Intent.Empty(raw);
            break;
        case 'back':
            intent = new Intent.Back(raw);
            break;
        case 'nevermind':
            intent = new Intent.NeverMind(raw);
            break;
        case 'debug':
            intent = new Intent.Debug(raw);
            break;
        case 'help':
            intent = new Intent.Help(raw, null, 0, null);
            break;
        case 'maybe':
            intent = new Intent.Maybe(raw);
            break;
        default:
            throw new Error('Unrecognized special ' + special);
        }
    } else if ('answer' in root) {
        if (root.answer.type === 'Choice') {
            intent = new Intent.Answer(raw, ValueCategory.MultipleChoice, root.answer.value);
        } else {
            let value = SEMPRESyntax.parseValue(root.answer);
            let category = ValueCategory.fromValue(value);
            intent = new Intent.Answer(raw, category, value);
            if (category === ValueCategory.YesNo) {
                intent.isYes = value.value === true;
                intent.isNo = value.value === false;
            }
        }
    } else if ('filter' in root) {
        let value;
        if (root.filter.value === null)
            value = Ast.Value.Undefined(true);
        else
            value = SEMPRESyntax.parseValue(root.filter);

        let op = root.filter.operator;
        if (op === 'is')
            op = '=';
        else if (op === 'contains')
            op = '=~';
        else if (op === 'has')
            op = 'contains';
        intent = new Intent.Filter(raw, Ast.Filter(root.filter.name, op, value));
    } else if ('predicate' in root) {
        intent = new Intent.Predicate(raw, SEMPRESyntax.parsePredicate(root));
    } else if ('action' in root) {
        intent = SEMPRESyntax.parsePrimitive(schemaRetriever, 'actions', root.action, true).then((prim) => new Intent.Primitive(raw, 'action', prim));
    } else if ('trigger' in root) {
        intent = SEMPRESyntax.parsePrimitive(schemaRetriever, 'triggers', root.trigger, true).then((prim) => new Intent.Primitive(raw, 'trigger', prim));
    } else if ('query' in root) {
        intent = SEMPRESyntax.parsePrimitive(schemaRetriever, 'queries', root.query, true).then((prim) => new Intent.Primitive(raw, 'query', prim));
    } else if ('rule' in root) {
        intent = SEMPRESyntax.parseToplevel(schemaRetriever, root, true).then((prog) => new Intent.Program(raw, prog));
    } else if ('command' in root && root.command.type === 'help') {
        // I don't want to trigger HelpDialog for a simple help
        // a bare help should be recognized at any point during any
        // dialog, hence a special
        var help = handleName(root.command.value);
        if (!help || help === 'generic') {
            intent = new Intent.Help(raw, null, 0, null);
        } else {
            if (help.startsWith('tt:device.'))
                help = help.substr('tt:device.'.length);
            intent = new Intent.Help(raw, help, root.command.page || 0, root.command.category || null);
        }
    } else if ('setup' in root) {
        return SEMPRESyntax.parseToplevel(schemaRetriever, root, true).then((prog) => new Intent.Setup(raw, prog));
    } else if ('access' in root) {
        intent = SEMPRESyntax.parsePermissionRule(schemaRetriever, root.access, true).then((rule) => new Intent.PermissionRule(raw, rule));
    }

    return Q(intent).then((intent) => {
        if ('example_id' in root)
            intent.exampleId = root.example_id;
        return intent;
    });
}

Intent.parseString = function parseString(json, schemaRetriever, raw, previousRaw, previousCandidates) {
    return this.parse(JSON.parse(json), schemaRetriever, raw, previousRaw, previousCandidates).then((intent) => {
        intent.json = json;
        return intent;
    });
}
Intent.parseProgram = function parseProgram(thingtalk, schemaRetriever) {
    return ThingTalk.Grammar.parseAndTypecheck(thingtalk, schemaRetriever, true).then((prog) => {
        if (prog.principal !== null)
            return new Intent.Setup(null, prog);
        else
            return new Intent.Program(null, prog);
    });
}

module.exports.Intent = Intent;
module.exports.ValueCategory = ValueCategory;
