// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const { DialogueState } = require('./ast');

module.exports = {
    async parse(code, entities, options) {
        return DialogueState.parse(code, entities, options);
    },

    serialize(ast, sentence, entities) {
        return ast.serialize(sentence, entities);
    },

    async normalize(code, options) {
        return DialogueState.normalize(code, options);
    }
};
