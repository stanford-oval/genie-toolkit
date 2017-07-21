// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { slotFillSingle } = require('./slot_filling');

module.exports = function* askAnything(dlg, appId, icon, type, question) {
    let app;
    if (appId !== undefined)
        app = dlg.manager.apps.getApp(appId);
    else
        app = undefined;
    if (app)
        question = this._("Question from %s: %s").format(app.name, question);

    dlg.icon = icon;
    let value = yield* slotFillSingle(dlg, type, question);
    return value.toJS();
}
