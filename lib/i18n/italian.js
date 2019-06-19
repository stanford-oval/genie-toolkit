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

function replaceMeMy(sentence) {
    sentence = sentence.replace(/\b((?!(?:notifica|informa|invia a)\b)[a-zA-Z0-9]+) me\b/g, '$1 lui');

    return sentence.replace(/\b(io|me|mio|miei|mia|mie)\b/g, (what) => {
        switch(what) {
        case 'me':
        case 'io':
            return 'lui';
        case 'mio':
            return 'suo';
        case 'miei':
            return 'suoi';
        case 'mia':
            return 'sua';
        case 'mie':
            return 'sue';
        default:
            return what;
        }
    });
}

function postprocessSynthetic(sentence, program) {
    if (program.isProgram && program.principal !== null)
        sentence = replaceMeMy(sentence);

    return sentence.replace(/ (nuovi|nuove) (loro|suoi|miei|il|i|gli|le|un|una) /, (_new, what) => ` ${what} ${_new} `)
        //.replace(/ 's (my|their|his|her) /, ` 's `) //' // is there an equivalent in Italian? depends on the templates...
        .trim();
}

const ARGUMENT_NAME_OVERRIDES = {
    'picture_url': ['fotografia', 'foto', 'immagine'],

    'file_name': ['nome del file', 'nome'],
    'file_size': ['dimensione del file', 'dimensione'],
    'mime_type': ['tipo di file', 'tipo'],
};

const IGNORABLE_TOKENS = {
    'sportradar': ['fc', 'ac', 'us', 'if', 'as', 'rc', 'rb', 'il', 'fk', 'cd', 'cf'],
    'imgflip:meme_id': ['il'],
    'tt:currency_code': ['us'],
    'tt:stock_id': ['l.p.', 's.a.', 'plc', 'n.v', 's.a.b', 'c.v.'],
    'org:freedesktop:app_id': ['gnome']
};
const ABBREVIATIONS = [
    ['ltd', 'ltd.', 'limited'],
    ['corp', 'corp.', 'corporation'],
    ['l.l.c', 'llc'],
    ['inc.', 'inc', 'incorporated'],
    ['s.p.a', 'società per azioni'],
    ['s.r.l.', 'società a responsabilità limitata'],
    ['f.lli', 'fratelli'],
    ['&', 'e']
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

const NO_IDEA = [
    'no idea', 'non ho idea', 'non lo so', 'non so', 'non ho capito',
    'non capisco', 'boh', 'non ha senso', 'non si capisce'
];

const PPDB_BLACKLIST = new Set(['tb', 'canale']);
function isValidParaphrasePair(word, paraphrase) {
    if (PPDB_BLACKLIST.has(word))
        return false;

    // TODO: ignore singular/plural relation and verb/gerund
    // TODO: don't change the mode or tense of the verb
    // (conjugation rules are more complex in Italian than English
    // so this is not trivial...)
    return true;
}

const CHANGE_SUBJECT_TEMPLATES = [];
const SINGLE_DEVICE_TEMPLATES = [];

module.exports = {
    postprocessSynthetic,
    detokenize,

    ARGUMENT_NAME_OVERRIDES,

    IGNORABLE_TOKENS,
    ABBREVIATIONS: PROCESSED_ABBREVIATIONS,

    NO_IDEA,
    CHANGE_SUBJECT_TEMPLATES,
    SINGLE_DEVICE_TEMPLATES,

    isValidParaphrasePair
};
