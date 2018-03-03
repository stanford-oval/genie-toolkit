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
    Failed: { command: adt.only(Object, null) },
    Train: { command: adt.only(Object, null), fallbacks: adt.only(Array, null) },
    Back: null,
    Empty: null,
    Debug: null,
    Maybe: null,
    Filter: { filter: adt.only(Ast.Filter) },

    // special entries in the grammar
    NeverMind: null,
    Help: null,
    Make: null,

    Answer: { category: adt.only(ValueCategory), value: adt.only(Ast.Value, Number) },

    // thingtalk
    Program: {
        program: adt.only(Ast.Program)
    },
    Primitive: {
        primitiveType: adt.only('trigger', 'query', 'action'),
        primitive: adt.only(Ast.RulePart)
    },
    Predicate: {
        predicate: adt.only(Ast.BooleanExpression)
    },
    Setup: {
        program: adt.only(Ast.Program)
    },
    PermissionRule: {
        rule: adt.only(Ast.PermissionRule)
    }
});

function parseSpecial(special, command, previousCommand, previousCandidates) {
    let intent;
    switch (special.substring('special:'.length)) {
    case 'yes':
        intent = new Intent.Answer(ValueCategory.YesNo, Ast.Value.Boolean(true));
        intent.isYes = true;
        intent.isNo = false;
        break;
    case 'no':
        intent = new Intent.Answer(ValueCategory.YesNo, Ast.Value.Boolean(false));
        intent.isYes = false;
        intent.isNo = true;
        break;
    case 'failed':
        intent = new Intent.Failed(command);
        break;
    case 'train':
        intent = new Intent.Train(previousCommand, previousCandidates);
        break;
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
        intent = Intent.Help;
        break;
    case 'maybe':
        intent = Intent.Maybe;
        break;
    default:
        throw new Error('Unrecognized special ' + special);
    }
    return intent;
}

function parseBookeeping(code, entities, command, previousCommand, previousCandidates) {
    switch (code[1]) {
    case 'special':
        return parseSpecial(code[2], command, previousCommand, previousCandidates);

    case 'answer': {
        const value = ThingTalk.NNSyntax.fromNN(code.slice(1), entities);
        return new Intent.Answer(ValueCategory.fromValue(value), value);
    }

    case 'choice':
        return new Intent.Answer(ValueCategory.MultipleChoice, parseInt(code[2]));

    default:
        throw new Error('Unrecognized bookkeeping command ' + code[1]);
    }
}

Intent.parse = function parse(code, entities, schemaRetriever, command, previousCommand, previousCandidates) {
    if (code[0] === 'bookkeeping')
        return Promise.resolve(parseBookeeping(code, entities, command, previousCommand, previousCandidates));

    return Promise.resolve().then(() => {
        let program = ThingTalk.NNSyntax.fromNN(code, entities);
        return ThingTalk.Generate.typeCheckProgram(program, schemaRetriever, true).then(() => program);
    }).then((program) => {
        if (program.principal !== null)
            return new Intent.Setup(program);
        else
            return new Intent.Program(program);
    });
};

Intent.parseProgram = function parseProgram(thingtalk, schemaRetriever) {
    return ThingTalk.Grammar.parseAndTypecheck(thingtalk, schemaRetriever, true).then((prog) => {
        if (prog.principal !== null)
            return new Intent.Setup(prog);
        else
            return new Intent.Program(prog);
    });
};

module.exports.Intent = Intent;
module.exports.ValueCategory = ValueCategory;
