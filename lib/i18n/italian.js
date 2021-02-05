// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import assert from 'assert';

import ItalianTokenizer from './tokenizer/italian';
import DefaultLanguagePack from './default';

import { coin } from '../utils/random';

function replaceMeMy(sentence) {
    sentence = sentence.replace(/\b((?!(?:notifica|informa|invia a)\b)[a-zA-Z0-9]+) me\b/g, '$1 lui');

    return sentence.replace(/\b(io|me|mio|miei|mia|mie)\b/g, (what) => {
        switch (what) {
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

export default class ItalianLanguagePack extends DefaultLanguagePack {
    constructor(locale) {
        super(locale);
    }

    getTokenizer() {
        if (this._tokenizer)
            return this._tokenizer;
        return this._tokenizer = new ItalianTokenizer();
    }

    postprocessSynthetic(sentence, program, rng, forTarget = 'user') {
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

        if (!sentence.endsWith(' ?') && !sentence.endsWith(' !') && !sentence.endsWith(' .') && rng && coin(0.5, rng))
            sentence = sentence.trim() + ' .';
        if (sentence.endsWith(' ?') && rng && coin(0.5, rng))
            sentence = sentence.substring(0, sentence.length-2);

        return sentence.trim();
    }

    pluralize(noun) {
        // TODO rules are complicated and full of exceptions...
        return undefined;
    }

    toAgentSideUtterance(phrase) {
        return phrase.replace(/\b(io|me|mi[oa]|miei?)\b/g, (what) => {
            switch (what) {
            case 'io':
                return 'tu';
            case 'me':
                return 'te';
            case 'mio':
                return 'tuo';
            case 'miei':
                return 'tuoi';
            case 'mia':
                return 'tua';
            case 'mie':
                return 'tue';
            default:
                return what;
            }
        });
    }

    toVerbPast(phrase) {
        // rules for past simple (passato remoto) are positively insane
        // no way in hell this is implementable
        return undefined;
    }

    detokenize(sentence, prevtoken, token) {
        if (sentence && !this._NO_SPACE_TOKENS.has(token) && !prevtoken.endsWith("'"))
            sentence += ' ';
        sentence += token;
        return sentence;
    }

    addDefiniteArticle(phrase) {
        const words = phrase.split(' ');
        assert(words.length > 0);

        const firstWord = words[0];

        // crude heuristic
        // to do better we would need a dictionary

        if (firstWord.endsWith('i')) {
            // masculine plural
            if (/^([haeiou]|s[^haeiou]|gn|ps|pn|z)/.test(firstWord))
                return 'gli ' + phrase;
            else
                return 'i ' + phrase;
        }
        if (firstWord.endsWith('a')) {
            // feminine singular
            if (/^haeiou/.test(firstWord))
                return 'l\' ' + phrase;
            else
                return 'la ' + phrase;
        }
        if (firstWord.endsWith('e')) {
            // feminine plural
            return 'le ' + phrase;
        }

        // all other cases, assume masculine singular
        if (/^haeiou/.test(firstWord))
            return 'l\' ' + phrase;
        else if (/^(s[^haeiou]|gn|ps|pn|z)/.test(firstWord))
            return 'lo ' + phrase;
        else
            return 'il ' + phrase;
    }

    isGoodWord(word) {
        // filter out words that cannot be in the dataset,
        // because they would be either tokenized/preprocessed out or
        // they are unlikely to be used with voice
        return /^([\u00E0\u00C8\u00E8\u00E9\u00EC\u00F2\u00F9a-zA-Z0-9][\u00E0\u00C8\u00E8\u00E9\u00EC\u00F2\u00F9a-zA-Z0-9.-]*|'s|,|\?)$/.test(word);
    }

    isGoodSentence(sentence) {
        if (sentence.length < 3)
            return false;
        if (['.', ',', '?', '!', ' '].includes(sentence[0]))
            return false;
        return !/^(un|ha|per|titolo|quando|mi|i|modo|-|di|fino|sono|essere|avere|che|questa|questi|quelli|con|come|in|on|prima|dopo)$/.test(sentence);
    }

    isGoodNumber(number) {
        return /^([0-9]+)$/.test(number);
    }

    isGoodPersonName(word) {
        return this.isGoodWord(word) || /^(\w+\s\w\s?\.)$/.test(word);
    }
}

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
ItalianLanguagePack.prototype.ABBREVIATIONS = PROCESSED_ABBREVIATIONS;

// tokens that should not be preceded by a space
ItalianLanguagePack.prototype._NO_SPACE_TOKENS = new Set(['.', ',', '?', '!', ':']);

// sentence, to present to an MTurk worker for paraphrasing
ItalianLanguagePack.prototype.NO_IDEA = [
    'no idea', 'non ho idea', 'non lo so', 'non so', 'non ho capito',
    'non capisco', 'boh', 'non ha senso', 'non si capisce'
];

ItalianLanguagePack.prototype.DEFINITE_ARTICLE_REGEXP = /(il|lo|la|i|gli|le|l') /;
