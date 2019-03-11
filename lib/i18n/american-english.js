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

const { coin } = require('../random');

function replaceMeMy(sentence) {
    sentence = sentence.replace(/\b((?!(?:let|inform|notify|alert|send)\b)[a-zA-Z0-9]+) me\b/g, '$1 them');

    return sentence.replace(/\b(my|i|mine)\b/g, (what) => {
        switch(what) {
        case 'me':
            return 'them';
        case 'my':
            return 'their';
        case 'mine':
            return 'theirs';
        case 'i':
            return 'they';
        default:
            return what;
        }
    });
}

// Apply final touches to a newly generated synthetic sentence
//
// This function should correct coreferences, conjugations and other
// grammar/readability issues that are too inconvenient to prevent
// using the templates 
function postprocessSynthetic(sentence, program, rng) {
    if (program.isProgram && program.principal !== null)
        sentence = replaceMeMy(sentence);

    if (!sentence.endsWith(' ?') && !sentence.endsWith(' !') && !sentence.endsWith(' .') && coin(0.5, rng))
        sentence = sentence.trim() + ' .';

    return sentence.replace(/ new (their|my|the|a) /, (_, what) => ` ${what} new `)
        .replace(/ 's (my|their|his|her) /, ` 's `) //'
        .trim();
}

// Override the canonical form of argument names for synthetic generation
// (to generate filters and projections)
//
// More than one form can be provided for each argument name, in which case
// all are used
//
// FIXME this info should be in Thingpedia
// if there is only a single value, this is possible without changing the parameter
// name by adding a #_[canonical] annotation
const ARGUMENT_NAME_OVERRIDES = {
    'updated': ['update time'],
    'random': ['random number'],

    'picture_url': ['picture', 'image', 'photo'],

    'title': ['headline', 'title'],

    'file_name': ['file name', 'name'],
    'file_size': ['file size', 'size', 'disk usage'],
    // not even silei knows about mime types, so definitely no mime type here!
    'mime_type': ['file type', 'type'],

    'user_name': ['username', 'user name'],
};

// Tokens that can be ignored in the names of entities, by entity type
//
// This should cover abbreviations, prefixes and suffixes that are usually
// omitted in colloquial speech
const IGNORABLE_TOKENS = {
    'sportradar': ['fc', 'ac', 'us', 'if', 'as', 'rc', 'rb', 'il', 'fk', 'cd', 'cf'],
    'imgflip:meme_id': ['the'],
    'tt:currency_code': ['us'],
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
    'n\'t': 'n\'t',
    '\'s': '\'s',
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
    } else if ((token === 'not' && prevtoken === 'can') ||
        ((token === 'na' || token === 'ta') && prevtoken === 'gon')) {
        // PTB tokenizer does the following
        // cannot -> can not
        // gonna -> gon na
        // gotta -> got ta
        // invert it here
        //
        // note the absence of a space
        sentence += token;
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
const NO_IDEA = [
    'no idea', 'don\'t know', 'dont know', 'don\'t understand',
    'dont understand', 'no clue',
    'doesn\'t make sense', 'doesn\'t make any sense',
    'doesnt make sense', 'doesnt make any sense'
];

// tb is terabyte in our dataset, tubercolosis in PPDB
// channel is TV/YouTube channel for us, river/waterway for PPDB
const PPDB_BLACKLIST = new Set(['tb', 'channel']);

// Check if a pair of word, paraphrase from PPDB should be considered a candidate
// for augmentation or not
function isValidParaphrasePair(word, paraphrase) {
    if (PPDB_BLACKLIST.has(word))
        return false;
    // ignore singular/plural relation and verb/gerund
    if (paraphrase === word + 's' || word === paraphrase + 's')
        return false;
    if (paraphrase === word + 'ing' || word === paraphrase + 'ing')
        return false;

    // don't change the mode or tense of the verb
    if (paraphrase.endsWith('ing') !== word.endsWith('ing'))
        return false;
    if (paraphrase.endsWith('ed') !== word.endsWith('ed'))
        return false;
    return true;
}

module.exports = {
    postprocessSynthetic,
    detokenize,

    ARGUMENT_NAME_OVERRIDES,

    IGNORABLE_TOKENS,
    ABBREVIATIONS: PROCESSED_ABBREVIATIONS,

    NO_IDEA,

    isValidParaphrasePair
};
