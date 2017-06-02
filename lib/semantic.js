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
    Program: {
        program: adt.only(Ast.Program)
    },
    Primitive: {
        primitiveType: adt.only(String),
        primitive: adt.only(Ast.RulePart)
    },
    Setup: { person: adt.only(Ast.Value), program: adt.only(Ast.Program) }
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
            return Q(intent);
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
        if (root.answer.type === 'Choice') {
            intent = Intent.Answer(ValueCategory.MultipleChoice, root.answer.value);
        } else {
            let value = SEMPRESyntax.parseValue(root.answer);
            let category = ValueCategory.fromValue(value);
            intent = Intent.Answer(category, value);
            if (category === ValueCategory.YesNo) {
                intent.isYes = value.value === true;
                intent.isNo = value.value === false;
            }
        }
    } else if ('filter' in root) {
        intent = Intent.Filter;
    } else if ('action' in root) {
        intent = SEMPRESyntax.parsePrimitive(schemaRetriever, 'actions', root.action, true).then((prim) => Intent.Primitive('action', prim));
    } else if ('trigger' in root) {
        intent = SEMPRESyntax.parsePrimitive(schemaRetriever, 'triggers', root.trigger, true).then((prim) => Intent.Primitive('trigger', prim));
    } else if ('query' in root) {
        intent = SEMPRESyntax.parsePrimitive(schemaRetriever, 'queries', root.query, true).then((prim) => Intent.Primitive('query', prim));
    } else if ('rule' in root) {
        intent = SEMPRESyntax.parseRule(schemaRetriever, root.rule, true).then((prog) => Intent.Program(prog));
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
        intent = SEMPRESyntax.parseRule(schemaRetriever, root.setup, true).then((prog) => Intent.Setup(Ast.Value.Entity(root.setup.person, 'tt:contact_name', null), prog));
    }

    return Q(intent).then((intent) => {
        intent.root = root;
        intent.raw = raw;
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

module.exports.Intent = Intent;
module.exports.ValueCategory = ValueCategory;
