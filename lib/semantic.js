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

const adt = require('adt');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ValueCategory = adt.data({
    YesNo: null,
    MultipleChoice: null,

    Number: null,
    Measure: { unit: adt.only(String) },
    RawString: null,
    Password: null,
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
    Command: null,
    More: null
});

ValueCategory.fromValue = function fromValue(value) {
    if (value.isVarRef)
        return ValueCategory.Unknown;

    var type = value.getType();

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
};

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
    else if (expected === ValueCategory.RawString)
        what = 'raw_string';
    else if (expected === ValueCategory.Password)
        what = 'password';
    else if (expected === ValueCategory.MultipleChoice)
        what = 'choice';
    else if (expected === ValueCategory.Command)
        what = 'command';
    else if (expected !== null)
        what = 'generic';
    else
        what = null;
    return what;
};

const Intent = adt.data({
    // internally generated intents
    Failed: { command: adt.only(Object, null), platformData: adt.any },
    Train: { command: adt.only(Object, null), fallbacks: adt.only(Array, null), platformData: adt.any },
    Back: { platformData: adt.any },
    More: { platformData: adt.any },
    Empty: { platformData: adt.any },
    Debug: { platformData: adt.any },
    Maybe: { platformData: adt.any },
    Unsupported: { platformData: adt.any },
    Example: { utterance: adt.only(String), targetCode: adt.only(String), platformData: adt.any },
    CommandList: { device: adt.only(String, null), category: adt.only(String), platformData: adt.any },

    // special entries in the grammar
    NeverMind: { platformData: adt.any }, // cancel the current task
    Help: { platformData: adt.any }, // ask for contextual help, or start a new task
    Make: { platformData: adt.any }, // reset and start a new task
    WakeUp: { platformData: adt.any }, // do nothing and wake up the screen

    // easter eggs
    Hello: { platformData: adt.any },
    Cool: { platformData: adt.any },
    ThankYou: { platformData: adt.any },
    Sorry: { platformData: adt.any },

    Answer: { category: adt.only(ValueCategory), value: adt.only(Ast.Value, Number), platformData: adt.any },

    // thingtalk
    Program: {
        program: adt.only(Ast.Program),
        platformData: adt.any
    },
    Predicate: {
        predicate: adt.only(Ast.BooleanExpression),
        platformData: adt.any
    },
    Setup: {
        program: adt.only(Ast.Program),
        platformData: adt.any
    },
    PermissionRule: {
        rule: adt.only(Ast.PermissionRule),
        platformData: adt.any
    }
});

const SPECIAL_INTENT_MAP = {
    makerule: Intent.Make,
    empty: Intent.Empty,
    back: Intent.Back,
    more: Intent.More,
    nevermind: Intent.NeverMind,
    debug: Intent.Debug,
    help: Intent.Help,
    maybe: Intent.Maybe,
    hello: Intent.Hello,
    cool: Intent.Cool,
    thankyou: Intent.ThankYou,
    thank_you: Intent.ThankYou,
    sorry: Intent.Sorry,
    wakeup: Intent.WakeUp,
};

function parseSpecial(special, command, previousCommand, previousCandidates, platformData) {
    let intent;
    special = special.substring('special:'.length);
    switch (special) {
    case 'yes':
        intent = new Intent.Answer(ValueCategory.YesNo, Ast.Value.Boolean(true), platformData);
        intent.isYes = true;
        intent.isNo = false;
        break;
    case 'no':
        intent = new Intent.Answer(ValueCategory.YesNo, Ast.Value.Boolean(false), platformData);
        intent.isYes = false;
        intent.isNo = true;
        break;
    case 'failed':
        intent = new Intent.Failed(command, platformData);
        break;
    case 'train':
        intent = new Intent.Train(previousCommand, previousCandidates, platformData);
        break;
    default:
        if (!SPECIAL_INTENT_MAP[special])
            throw new Error('Unrecognized special ' + special);
        intent = new (SPECIAL_INTENT_MAP[special])(platformData);
    }
    return intent;
}

function parseBookeeping(code, schemaRetriever, entities, command, previousCommand, previousCandidates, platformData) {
    switch (code[1]) {
    case 'special':
        return parseSpecial(code[2], command, previousCommand, previousCandidates, platformData);

    case 'answer': {
        const value = ThingTalk.NNSyntax.fromNN(code.slice(1), entities);
        return new Intent.Answer(ValueCategory.fromValue(value), value, platformData);
    }
    case 'filter': {
        const predicate = ThingTalk.NNSyntax.fromNN(code.slice(1), entities);
        return new Intent.Predicate(predicate, platformData);
    }
    case 'category':
        return new Intent.CommandList(null, code[2], platformData);
    case 'commands':
        return new Intent.CommandList(code[3].substring('device:'.length), code[2], platformData);

    case 'choice':
        return new Intent.Answer(ValueCategory.MultipleChoice, parseInt(code[2]), platformData);

    default:
        throw new Error('Unrecognized bookkeeping command ' + code[1]);
    }
}

Intent.parse = function parse(json, schemaRetriever, command, previousCommand, previousCandidates, platformData) {
    if ('program' in json)
        return this.parseProgram(json.program, schemaRetriever, platformData);

    let { code, entities } = json;
    for (let name in entities) {
        if (name.startsWith('SLOT_')) {
            let slotname = json.slots[parseInt(name.substring('SLOT_'.length))];
            let slotType = ThingTalk.Type.fromString(json.slotTypes[slotname]);
            let value = ThingTalk.Ast.Value.fromJSON(slotType, entities[name]);
            entities[name] = value;
        }
    }

    if (code[0] === 'bookkeeping')
        return Promise.resolve(parseBookeeping(code, schemaRetriever, entities, command, previousCommand, previousCandidates, platformData));

    return Promise.resolve().then(() => {
        let program = ThingTalk.NNSyntax.fromNN(code, entities);
        return program.typecheck(schemaRetriever, true);
    }).then((program) => {
        if (program.isProgram) {
            if (program.principal !== null)
                return new Intent.Setup(program, platformData);
            else
                return new Intent.Program(program, platformData);
        } else {
            return new Intent.PermissionRule(program, platformData);
        }
    });
};

Intent.parseProgram = function parseProgram(thingtalk, schemaRetriever, platformData) {
    return ThingTalk.Grammar.parseAndTypecheck(thingtalk, schemaRetriever, true).then((prog) => {
        if (prog.isProgram) {
            if (prog.principal !== null)
                return new Intent.Setup(prog, platformData);
            else
                return new Intent.Program(prog, platformData);
        } else {
            return new Intent.PermissionRule(prog, platformData);
        }
    });
};

module.exports.Intent = Intent;
module.exports.ValueCategory = ValueCategory;
