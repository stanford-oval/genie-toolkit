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

module.exports = class ArabicLanguagePack extends DefaultLanguagePack {
    isGoodWord(word) {
        // filter out words that cannot be in the dataset,
        // because they would be either tokenized/preprocessed out or
        // they are unlikely to be used with voice
        // [Arabic_chars| Arabic_Digits| Persian_supplements| English digits ...]
        return /^([\u0600-\u06ff\u0660-\u0669\uFB50–\uFDFF0-9][\u0600-\u06ff\u0660-\u0669\uFB50–\uFDFF0-9.-]*|\u060C|\u061F)$/.test(word);
    }

    isGoodSentence(sentence) {
        if (sentence.length < 3)
            return false;
        if (['.', '\u060C', '\u061F', '!', ' '].includes(sentence[0]))
            return false;
        // (for|me|and|or|that|this|in|with|from|on|before|after)$
        return !/^(لـ|أنا|و|أو|ان|هذا|مع|من|في|قبل|بعد)$/.test(sentence);
    }

    isGoodNumber(number) {
        // [English numbers| Persian numbers]
        return /^([A-Za-z]*[0-9|\u0660-\u0669]+)$/.test(number);
    }

    isGoodPersonName(word) {
        return this.isGoodWord(word) || /^([\u0600-\u06ff\uFB50–\uFDFF]+\s[\u0600-\u06ff\uFB50–\uFDFF]+\s?\.?)$/.test(word);
    }
};
