// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const BaseTokenizer = require('./tokenizer/base');

// Apply final touches to a newly generated synthetic sentence
//
// This function should correct coreferences, conjugations and other
// grammar/readability issues that are too inconvenient to prevent
// using the templates
function postprocessSynthetic(sentence, program, rng) {
    return sentence;
}

// Override the canonical form of argument names for synthetic generation
// (to generate filters and projections)
//
// More than one form can be provided for each argument name, in which case
// all are used
const ARGUMENT_NAME_OVERRIDES = {
};

// Tokens that can be ignored in the names of entities, by entity type
//
// This should cover abbreviations, prefixes and suffixes that are usually
// omitted in colloquial speech
const IGNORABLE_TOKENS = {
    'sportradar': ['fc', 'ac', 'us', 'if', 'as', 'rc', 'rb', 'il', 'fk', 'cd', 'cf'],
    'tt:stock_id': ['l.p.', 's.a.', 'plc', 'n.v', 's.a.b', 'c.v.'],
    'org:freedesktop:app_id': ['gnome']
};
// Interchangeable abbreviations for entity names
//
// Each entry in this array is a set (in array form) of abbreviations with the same
// meaning; while expanding parameters, one of the possible forms is chosen at random
//
// Use this to fix tokenization inconsistencies in the entity database, to add
// colloquial forms, and to add robustness to punctuation
const ABBREVIATIONS = [];
const PROCESSED_ABBREVIATIONS = {};
for (let abbr of ABBREVIATIONS) {
    for (let variant of abbr)
        PROCESSED_ABBREVIATIONS[variant] = abbr;
}

// tokens that should not be preceded by a space
const NO_SPACE_TOKENS = new Set(['.', ',', '?', '!', ':']);

// Convert a tokenized sentence back into a correctly spaced, correctly punctuated
// sentence, to present to an MTurk worker for paraphrasing
function detokenize(sentence, prevtoken, token) {
    if (sentence && !NO_SPACE_TOKENS.has(token))
        sentence += ' ';
    sentence += token;
    return sentence;
}

function detokenizeSentence(tokens) {
    let sentence = '';
    let prevToken = '';
    for (let token of tokens) {
        sentence = detokenize(sentence, prevToken, token);
        prevToken = token;
    }
    return sentence;
}

// All the different forms in which MTurk workers write "no idea" for a sentence
// they don't understand
//
// This is usually empirically collected by looking at the results and finding
// sentences that don't validate or are too short
const NO_IDEA = [];

const CHANGE_SUBJECT_TEMPLATES = [];

const SINGLE_DEVICE_TEMPLATES = [];

function pluralize(phrase) {
    // no plural form
    return undefined;
}

function toVerbPast(phrase) {
    // no past
    return undefined;
}

function isGoodWord(word) {
    // filter out words that cannot be in the dataset,
    // because they would be either tokenized/preprocessed out or
    // they are unlikely to be used with voice
    return true;
}

function isGoodSentence(sentence) {
    return true;
}

function isGoodNumber(number) {
    return /^([0-9|\u0660-\u0669]+)$/.test(number);
}

function isGoodPersonName(word) {
    return isGoodWord(word) || /^(\w+\s\w\s?\.)$/.test(word);
}

const DEFINITE_ARTICLE_REGEXP = undefined;
function addDefiniteArticle(phrase) {
    return undefined;
}

function getTokenizer() {
    return new BaseTokenizer();
}

module.exports = {
    getTokenizer,
    postprocessSynthetic,
    detokenize,
    detokenizeSentence,

    // inflections
    pluralize,
    toVerbPast,

    DEFINITE_ARTICLE_REGEXP,
    addDefiniteArticle,

    ARGUMENT_NAME_OVERRIDES,

    IGNORABLE_TOKENS,
    ABBREVIATIONS: PROCESSED_ABBREVIATIONS,

    NO_IDEA,

    CHANGE_SUBJECT_TEMPLATES,
    SINGLE_DEVICE_TEMPLATES,

    isGoodWord,
    isGoodSentence,
    isGoodNumber,
    isGoodPersonName
};
