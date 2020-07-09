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

module.exports = class TurkishLanguagePack extends DefaultLanguagePack {
    isGoodWord(word) {
        // filter out words that cannot be in the dataset,
        // because they would be either tokenized/preprocessed out or
        // they are unlikely to be used with voice
        return /^([abcçdefgğhıijklmnoöprsştuüvyz0-9-][abcçdefgğhıijklmnoöprsştuüvyz0-9.-]*|\u060C|\u061F)$/.test(word);
    }

    isGoodSentence(sentence) {
        if (sentence.length < 3)
            return false;
        if (['.', '\u060C', '\u061F', '!', ' '].includes(sentence[0]))
            return false;
        // (for|me|and|or|that|this|in|with|from|on|before|after)$
        return !/^(için|benim|ve|veya|o|bu|de|ile|den|üzerinde|önce|sonra)$/.test(sentence);
    }

    isGoodNumber(number) {
        // [English numbers| Persian numbers]
        return /^([A-Za-z]*[0-9|\u0660-\u0669]+)$/.test(number);
    }

    isGoodPersonName(word) {
        return this.isGoodWord(word) || /^([abcçdefgğhıijklmnoöprsştuüvyz]+\s[abcçdefgğhıijklmnoöprsştuüvyz]+\s?\.?)$/.test(word);
    }
};
