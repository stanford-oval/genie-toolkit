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
    'imgflip:meme_id': [],
    'tt:currency_code': [],
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
const ABBREVIATIONS = [
    ['ltd', 'ltd.', 'limited'],
    ['corp', 'corp.', 'corporation'],
    ['l.l.c', 'llc'],
    ['&', 'and'],
    ['inc.', 'inc', 'incorporated'],
];
const PROCESSED_ABBREVIATIONS = {};
for (let abbr of ABBREVIATIONS) {
    for (let variant of abbr)
        PROCESSED_ABBREVIATIONS[variant] = abbr;

}

// tokens that are treated specially by the PTB tokenizer for English
// (and what they map to in properly punctuated English)
const SPECIAL_TOKENS = {
    '.': '.',
    ',': ',',
    '?': '?',

    // right/left round/curly/square bracket
    '-rrb-': ')',
    '-lrb-': ' (',
    '-rcb-': '}',
    '-lcb-': ' {',
    '-rsb-': ']',
    '-lsb-': ' [',
};

// Convert a tokenized sentence back into a correctly spaced, correctly punctuated
// sentence, to present to an MTurk worker for paraphrasing
function detokenize(sentence, prevtoken, token) {
    if (token in SPECIAL_TOKENS) {
        sentence += SPECIAL_TOKENS[token];
    } else {
        if (sentence)
            sentence += ' ';
        sentence += token;
    }
    return sentence;
}

// All the different forms in which MTurk workers write "no idea" for a sentence
// they don't understand
//
// This is usually empirically collected by looking at the results and finding
// sentences that don't validate or are too short
const NO_IDEA = [];

// Check if a pair of word, paraphrase from PPDB should be considered a candidate
// for augmentation or not
function isValidParaphrasePair(word, paraphrase) {
    // assume true, and hope for the best
    return true;
}

const CHANGE_SUBJECT_TEMPLATES = [];

const SINGLE_DEVICE_TEMPLATES = [];

function pluralize(noun) {
    // no plural form
    return undefined;
}

module.exports = {
    postprocessSynthetic,
    detokenize,

    pluralize,

    ARGUMENT_NAME_OVERRIDES,

    IGNORABLE_TOKENS,
    ABBREVIATIONS: PROCESSED_ABBREVIATIONS,

    NO_IDEA,

    CHANGE_SUBJECT_TEMPLATES,
    SINGLE_DEVICE_TEMPLATES,

    isValidParaphrasePair
};
