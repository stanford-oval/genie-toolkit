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

const DefaultLanguagePack = require('./default');

module.exports = class JapaneseLanguagePack extends DefaultLanguagePack {
    isGoodWord(word) {
        // filter out words that cannot be in the dataset,
        // because they would be either tokenized/preprocessed out or
        // they are unlikely to be used with voice
        // + allow English names
        return /^([\u30A0-\u30FF\u3041-\u3096\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6Aあいうえおoかきくけこがぎぐげごさしすせそざじずぜぞたちつてとだぢづでどなにぬねのはひふへほばびぶべぼぱぴぷぺぽまみむめもやゆよらりるれろわをんn/\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef0-9\u4e00-\u9faf][\u30A0-\u30FF\u3041-\u3096\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6Aあいうえおoかきくけこがぎぐげごさしすせそざじずぜぞたちつてとだぢづでどなにぬねのはひふへほばびぶべぼぱぴぷぺぽまみむめもやゆよらりるれろわをんn/\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf\u4e00-\u9fafa-zA-Z0-9.,。，一-]*)$/.test(word);
    }

    isGoodSentence(sentence) {
        if (sentence.length < 3)
            return false;
        if (['.', '？', '。', '!', ' '].includes(sentence[0]))
            return false;
        // (for|me|and|or|that|this|in|with|from|on|before|after)$
        return !/^(の|私|と|または|それ|これ|で|と|から|に|以前|後)$/.test(sentence);
    }

    isGoodNumber(number) {
        // [English numbers]
        return /^([A-Za-z]*[0-9]+)$/.test(number);
    }

    isGoodPersonName(word) {
        return this.isGoodWord(word) || /^([\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf0-9]+\s[\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]\s?\.)$/.test(word);
    }
};
