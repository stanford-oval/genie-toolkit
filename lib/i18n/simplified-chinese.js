// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

function postprocessSynthetic(sentence, program) {
    // TODO
    return sentence;
}

// no overrides for Chinese, arguments should be translated properly in Thingpedia
const ARGUMENT_NAME_OVERRIDES = {};

// TODO
const IGNORABLE_TOKENS = {};
const ABBREVIATIONS = {};

// TODO
const NO_IDEA = [];

// TODO
const CHANGE_SUBJECT_TEMPLATES = [];
const SINGLE_DEVICE_TEMPLATES = [];

module.exports = {
    postprocessSynthetic,

    ARGUMENT_NAME_OVERRIDES,

    IGNORABLE_TOKENS,
    ABBREVIATIONS,

    detokenize(buffer, prevtoken, token) {
        // join without space
        return buffer + token;
    },

    NO_IDEA,
    CHANGE_SUBJECT_TEMPLATES,
    SINGLE_DEVICE_TEMPLATES,

    // TODO
    isValidParaphrasePair(word, paraphrase) {
        return true;
    }
};
