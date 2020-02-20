// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const { ValueCategory } = require('../semantic');

const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

module.exports = {
    async chooseAction(dlg, state) {
        // TODO
        return new Ast.DialogueState(null, POLICY_NAME, 'sys_recommend_two', null, []);
    },

    getInteractionState(dlg) {
        // TODO
        return {
            isTerminal: false,
            expect: ValueCategory.Command
        };
    }
};
