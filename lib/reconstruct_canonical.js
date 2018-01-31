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

const Intent = require('./semantic').Intent;
const ThingTalk = require('thingtalk');
const Describe = ThingTalk.Describe;

module.exports = function reconstructCanonical(dlg, json) {
    var schemaRetriever = dlg.manager.schemas;

    return Intent.parse(json, schemaRetriever, null).then((intent) => {
        if (intent.isFailed || intent.isFallback || intent.isTrain ||
            intent.isBack || intent.isEmpty || intent.isFilter || intent.isDebug)
            throw new Error('Invalid internal intent ' + intent);

        if (intent.isNeverMind)
            return dlg._("never mind");
        if (intent.isHelp && intent.name === null)
            return dlg._("help");
        if (intent.isHelp)
            return dlg._("help %s").format(intent.name);
        if (intent.isMake)
            return dlg._("make a command");
        if (intent.isAnswer)
            return Describe.describeArg(dlg.manager.gettext, intent.value);

        if (intent.isSetup) {
            let progDesc = Describe.describeProgram(dlg.manager.gettext, intent.rule);
            return dlg._("ask %s to %s").format(Describe.describeArg(dlg.manager.gettext, intent.person), progDesc);
        }

        let program;
        if (intent.isPrimitive)
            program = ThingTalk.Generate.primitiveProgram(intent.primitiveType, intent.primitive);
        else
            program = intent.program;
        return Describe.describeProgram(dlg.manager.gettext, program);
    });
}
