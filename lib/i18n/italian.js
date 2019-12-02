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

const PREPOSITIONS = {
    // of
    'di il': 'del',
    'di la': 'della',
    'di lo': 'dello',
    'di l\'': 'dell\'',
    'di i': 'dei',
    'di gli': 'degli',
    'di le': 'delle',

    // to
    'a il': 'al',
    'a la': 'alla',
    'a lo': 'allo',
    'a l\'': 'all\'',
    'a i': 'ai',
    'a gli': 'agli',
    'a le': 'alle',

    // from
    'da il': 'dal',
    'da la': 'dalla',
    'da lo': 'dallo',
    'da l\'': 'dall\'',
    'da i': 'dai',
    'da gli': 'dagli',
    'da le': 'dalle',

    // in
    'in il': 'nel',
    'in la': 'nella',
    'in lo': 'nello',
    'in l\'': 'nell\'',
    'in i': 'nei',
    'in gli': 'negli',
    'in le': 'nelle',

    // on
    'su il': 'sul',
    'su la': 'sulla',
    'su lo': 'sullo',
    'su l\'': 'sull\'',
    'su i': 'sui',
    'su gli': 'sugli',
    'su le': 'sulle',
};

function postprocessSynthetic(sentence, program, rng) {
    if (program.isProgram && program.principal !== null)
        sentence = replaceMeMy(sentence);

    sentence = sentence.replace(/ (nuov[iaeo]) (loro|suoi|miei|il|i|gli|le|un|una) /, (_new, what) => ` ${what} ${_new} `);

    // adjust articles
    sentence = sentence
        .replace(/\bla(?= [haeiou])/g, 'l\'')
        .replace(/\bil(?= [haeiou])/g, 'l\'')
        // x, z, gn, ps, pn, or s followed by consonant
        // (h is weird in that it's sometimes a vowel and sometimes a consonant, because
        // it only appears in foreign loan words)
        .replace(/\bil(?= (?:s[^haeiou]|gn|ps|pn|z))/g, 'lo')
        .replace(/\bi(?= (?:[haeiou]|s[^aeiou]|gn|ps|pn|z))/g, 'gli')

        .replace(/\buna(?= [haeiou])/g, 'nessun\'')
        .replace(/\bun(?= (?:s[^haeiou]|gn|ps|pn|z))/g, 'uno')

        // special cases
        .replace(/\bnessuna(?= [haeiou])/g, 'nessun\'')
        .replace(/\bnessun(?= (?:s[^haeiou]|gn|ps|pn|z))/g, 'nessuno');

    // "di il" -> "del"
    sentence = sentence.replace(/\b(di|a|da|in|su) (il|la|lo|l'|i|gli|le)\b/g, (str) => {
        return PREPOSITIONS[str] || str;
    });

    // "posta -lo" -> "postalo"
    sentence = sentence.replace(/ -l([oaie])\b/g, 'l$1');

    if (!sentence.endsWith(' ?') && !sentence.endsWith(' !') && !sentence.endsWith(' .') && coin(0.5, rng))
        sentence = sentence.trim() + ' .';
    if (sentence.endsWith(' ?') && coin(0.5, rng))
        sentence = sentence.substring(0, sentence.length-2);

    return sentence.trim();
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
        if (sentence && !prevtoken.endsWith("'"))
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

    isValidParaphrasePair,

    // there are two grammatical genders
    // humans, otoh...
    GRAMMATICAL_GENDERS: ['masculine', 'feminine'],
    // by rule of Italian grammar, if you refer to two nouns of mixed gender, the masculine
    // pronoun is used
    DEFAULT_GRAMMATICAL_GENDER: 'masculine'
};
