// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Mehrad Moradshahi <mehrad@cs.stanford.edu>
//
// See COPYING for details
"use strict";

var keys = [
];

function postprocessSynthetic(sentence, program) {
    
    keys.forEach((key) => {
        var re = new RegExp("\\b" + key[0] + "\\b", "g");
        if(sentence.match(re))
            sentence = sentence.replace(key[0], key[1]);
    });
    return sentence;
}


const ARGUMENT_NAME_OVERRIDES = {};


const IGNORABLE_TOKENS = {
    'sportradar': ['fc', 'ac', 'us', 'if', 'as', 'rc', 'rb', 'il', 'fk', 'cd', 'cf'],
    'imgflip:meme_id': ['the'],
    'tt:currency_code': ['us'],
    'tt:stock_id': ['l.p.', 's.a.', 'plc', 'n.v', 's.a.b', 'c.v.'],
    'org:freedesktop:app_id': ['gnome']
};

const ABBREVIATIONS = [
];

const PROCESSED_ABBREVIATIONS = {};
for (let abbr of ABBREVIATIONS) {
    for (let variant of abbr)
        PROCESSED_ABBREVIATIONS[variant] = abbr;

}

function detokenize(sentence, prevtoken, token) {
    if (sentence)
        sentence += ' ';
    sentence += token;
    return sentence;
}

const NO_IDEA = [
];

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


function isGoodWord(word) {
    // filter out words that cannot be in the dataset,
    // because they would be either tokenized/preprocessed out or
    // they are unlikely to be used with voice
    // [Arabic_chars| Arabic_Digits| Persian_supplements| English digits ...]
    return /^([\u0600-\u06ff\u0660-\u0669\uFB50–\uFDFF0-9-][\u0600-\u06ff\u0660-\u0669\uFB50–\uFDFF0-9.-]*|\u060C|\u061F|!)$/.test(word);
}

function isGoodSentence(sentence) {
    if (sentence.length < 3)
        return false;
    if (['.', '\u060C', '\u061F', '!', ' '].includes(sentence[0]))
        return false;
    // (for|me|and|or|that|this|in|with|from|on|before|after)$
    return !/^(برای|من|و|یا|آن|این|در|با|از|روی|قبل|بعد)$/.test(sentence);

}

function isGoodNumber(number) {
    // [English numbers| Persian numbers]
    return !/^([0-9|\u0660-\u0669]+)$/.test(number);
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

    isValidParaphrasePair,

    isGoodWord,
    isGoodSentence,
    isGoodNumber
};
