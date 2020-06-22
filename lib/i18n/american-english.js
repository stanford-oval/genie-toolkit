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

const assert = require('assert');
const { coin } = require('../random');
const POS = require("en-pos");
const Inflectors = require('en-inflectors').Inflectors;
const Tag = require('en-pos').Tag;

// nltk stop words
const STOPWORDS = ['i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', "you're", "you've", "you'll",
    "you'd", 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', "she's", 'her', 'hers',
    'herself', 'it', "it's", 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who',
    'whom', 'this', 'that', "that'll", 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or',
    'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off',
    'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any',
    'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
    'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', "n't", 'should', "should've", 'now', 'd', 'll',
    'm', 'o', 're', 've', 'y', 'ain', 'aren', "aren't", 'couldn', "couldn't", 'didn', 'doesn',
    'hadn', 'hasn', 'haven', 'isn', 'ma', 'mightn', 'mustn', 'needn','shan', 'shouldn', 'wasn', 'weren',
    'won', 'wouldn'];

const PUNCTUATIONS = [
    ',', '.', ':', ';', '(', ')', '[', ']', '{', '}', '"', '\'', '-', '!', '?'
];

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
function postprocessSynthetic(sentence, program, rng, forTarget = 'user') {
    assert(rng);
    if (program.isProgram && program.principal !== null)
        sentence = replaceMeMy(sentence);

    if (!sentence.endsWith(' ?') && !sentence.endsWith(' !') && !sentence.endsWith(' .') && coin(0.5, rng))
        sentence = sentence.trim() + ' .';
    if (forTarget === 'user' && sentence.endsWith(' ?') && coin(0.5, rng))
        sentence = sentence.substring(0, sentence.length-2);

    sentence = sentence.replace(/ (1|one|a) ([a-z]+)s /g, ' $1 $2 ');

    if (coin(0.5, rng))
        sentence = sentence.replace(/ with (no|zero) /g, ' without ');

    if (coin(0.5, rng))
        sentence = sentence.replace(/ has no /g, ' does not have ');
    if (coin(0.5, rng))
        sentence = sentence.replace(/ have no /g, ' do not have ');

    // contractions
    // FIXME check multiwoz preprocessing is compatible
    // FIXME we should probably either always do them or always not do them for
    // agent utterances, otherwise the agent will speak weirdly
    if (coin(0.5, rng))
        sentence = sentence.replace(/ (does|do) not /g, ' $1 n\'t ');
    if (coin(0.5, rng))
        sentence = sentence.replace(/ (he|she|it|what|who|where|when) (is|has) /g, ' $1 \'s ');
    if (coin(0.5, rng))
        sentence = sentence.replace(/ i am /g, ' i \'m ');
    if (coin(0.5, rng))
        sentence = sentence.replace(/ (you|we|they) are /g, ' $1 \'re ');
    if (coin(0.5, rng))
        sentence = sentence.replace(/ (i|you|he|she|we|they) (had|would) /g, ' $1 \'d ');

    sentence = sentence.replace(/#([a-z_]*) ((?:a|an|the) )?(NUMBER_[0-9]|0|zero|1|one|QUOTED_STRING_[0-9]|GENERIC_ENTITY_[^ ]+_[0-9])/g,
        (_, word, mid, value) => (mid || '') + value + ' ' + word.replace(/_/g, ' '));

    sentence = sentence.replace(/ (a|the) something /g, ' something ');

    //sentence = sentence.replace(/ a ([a-z]+) -s /g, ' $1 -s ');

    sentence = sentence.replace(/ ([a-z]+) -ly /g, ' $1ly ');

    sentence = sentence.replace(/ a (?!one )(?=[aeiou])/g, ' an ');

    sentence = sentence.replace(/ new (their|my|the|a) /, (_, what) => ` ${what} new `);

    sentence = sentence.replace(/ 's (my|their|his|her) /, ` 's `); //'

    // remove extra # introduced by annotations, and not yet been replaced by value
    sentence = sentence.replace(/#/g, '');

    return sentence.trim();
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
    '!': '!',

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

function detokenizeSentence(tokens) {
    let sentence = '';
    let prevToken = '';
    for (let token of tokens) {
        sentence = detokenize(sentence, prevToken, token);
        prevToken = token;
    }
    return sentence;
}

function capitalize(word) {
    return word[0].toUpperCase() + word.substring(1);
}

const MUST_CAPITALIZE_TOKEN = new Set([
    'i',

    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
    'october', 'november', 'december',

    // HACK
    'chinese', 'italian', 'french', 'english', 'american'
]);

function postprocessNLG(answer, entities) {
    // simple true-casing: uppercase all letters at the beginning of the sentence
    // and after a period, question or exclamation mark
    answer = answer.replace(/(^| [.?!] )([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());

    answer = answer.split(' ').map((token) => {
        if (token in entities) {
            if (token.startsWith('GENERIC_ENTITY_'))
                return (entities[token].display || entities[token].value);
            return String(entities[token]);
        }

        // capitalize certain tokens that should be capitalized in English
        if (MUST_CAPITALIZE_TOKEN.has(token))
            return capitalize(token);
        return token;
    });
    answer = detokenizeSentence(answer);

    return answer;
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

const CHANGE_SUBJECT_TEMPLATES = [
    'ok , how about {}',
    'how about {} instead',
    'no {}',
    'no i said {}',
    'no , i said {}',
    'i said {}',
    'i want {} instead',
    'no instead {}',
];

const SINGLE_DEVICE_TEMPLATES = [
    ['ask $device to $command', /^(?!(?:what|when|how|who) )/],
    ['ask $device about $command', /^(?:what|when|how|who) /],
    ['ask $device for $command', /^the /],
    ['ask $device $command', /^(?:what|when|how|who) /],
    ['tell $device to $command', /^(?!(?:what|when|how|who) )/],
    ['tell $device that $command', /^(?!(?:what|when|how|who) )/],
    ['use $device to $command', /^(?!(?:what|when|how|who) )/],
    ['use $device and $command', /^(?!(?:what|when|how|who) )/],
    ['order $device to $command', /^(?!(?:what|when|how|who) )/],
    ['$command from $device', null],
    ['$command using $device', null],
    ['$command in $device', null],
    ['$command by $device', null],
    ['$command with $device', null],
    ['talk to $device and $command', /^(?!(?:what|when|how|who) )/],
    ['open $device and $command', /^(?!(?:what|when|how|who) )/],
    ['launch $device and $command', /^(?!(?:what|when|how|who) )/],
];

function pluralize(name) {
    if (!name.includes(' ')) {
        if (new Tag([name]).initial().tags[0] === 'NN')
            return new Inflectors(name).toPlural();
        return name;
    } else {
        const words = name.split(' ');
        const tags = new Tag(words).initial().tags;
        if (tags[tags.length - 1] !== 'NN')
            return name;
        else if (['VB', 'VBP', 'VBZ', 'VBD'].includes(tags[0]))
            return name;
        words[words.length - 1] = pluralize(words[words.length - 1]);
        return words.join(' ');
    }
}

function toVerbPast(phrase) {
    const words = phrase.split(' ');
    const tags = new Tag(words).initial().tags;

    if (!['VB', 'VBP', 'VBZ', 'VBD'].includes(tags[0]))
        return undefined;

    const inflected = new Inflectors(words[0]).toPast();
    return [inflected, ...words.slice(1)].join(' ');
}

function isGoodWord(word) {
    // filter out words that cannot be in the dataset,
    // because they would be either tokenized/preprocessed out or
    // they are unlikely to be used with voice
    return /^([a-zA-Z0-9-][a-zA-Z0-9.-]*|'s|,|\?)$/.test(word);
}

function isGoodSentence(sentence) {
    if (sentence.length < 3)
        return false;
    // filter out any sentence with punctuations
    for (let char of sentence) {
        if (PUNCTUATIONS.includes(char))
            return false;
    }
    // filter out any sentence starts/ends with stop words
    let words = sentence.split(' ');
    if (STOPWORDS.includes(words[0]) || STOPWORDS.includes(words[words.length-1]))
        return false;
    if (['has', 'have', 'having'].includes(words[0]))
        return false;

    // filter out sentences containing only numbers
    let allNumber = true;
    for (let word of words) {
        if (!isNumber(word) || isZipcode(word))
            allNumber = false;
    }
    if (allNumber)
        return false;

    return true;
}

function isNumber(word) {
    // numbers with optional "," every 3 digits, cannot start with "."
    return /^\d{1,3}(,?\d{3})*(\.\d+)?$/.test(word);
}

function isZipcode(word) {
    if (word.length !== 5)
        return false;
    for (let char of word) {
        if (isNaN(char))
            return false;
    }
    return true;
}

function isGoodNumber(number) {
    return /^([0-9]+)$/.test(number);
}

function isGoodPersonName(word) {
    return isGoodWord(word) || /^(\w+\s\w\s?\.)$/.test(word);
}

function posTag(tokens) {
    return new POS.Tag(tokens)
        .initial() // initial dictionary and pattern based tagging
        .smooth() // further context based smoothing
        .tags;
}

module.exports = {
    postprocessSynthetic,
    detokenize,
    postprocessNLG,

    posTag,

    pluralize,
    toVerbPast,

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
