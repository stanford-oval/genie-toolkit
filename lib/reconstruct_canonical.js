// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const { Intent } = require('./semantic');
const ThingTalk = require('thingtalk');
const Describe = ThingTalk.Describe;

module.exports = function reconstructCanonical(dlg, code, entities) {
    return Intent.parse({ code, entities }, dlg.manager.schemas, null, null, []).then((intent) => {
        if (intent.isFailed || intent.isFallback || intent.isTrain ||
            intent.isBack || intent.isEmpty || intent.isFilter || intent.isDebug ||
            intent.isMore || intent.isUnsupported)
            throw new Error('Invalid internal intent ' + intent);

        if (intent.isNeverMind)
            return "never mind";
        if (intent.isHelp)
            return "help";
        if (intent.isMake)
            return "make a command";
        if (intent.isWakeUp)
            return "almond, wake up!";
        if (intent.isAnswer)
            return Describe.describeArg(dlg.manager.gettext, intent.value);

        if (intent.isPermissionRule)
            return Describe.describePermissionRule(dlg.manager.gettext, intent.rule);
        else
            return Describe.describeProgram(dlg.manager.gettext, intent.program);
    });
};
