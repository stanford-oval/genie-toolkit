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

function isGoodWord(word) {
    // filter out words that cannot be in the dataset,
    // because they would be either tokenized/preprocessed out or
    // they are unlikely to be used with voice
    return /^([a-zA-Záéíóúüñ¿¡0-9][a-zA-Záéíóúüñ¿¡0-9.-]*|\u060C|\u061F)$/.test(word);
}

function isGoodSentence(sentence) {
    if (sentence.length < 3)
        return false;
    if (['.', '\u060C', '\u061F', '!', ' '].includes(sentence[0]))
        return false;
    // (for|me|and|or|that|this|in|with|from|on|before|after)$
    return !/^(o|yo|y|o|eso|esto|en|con|de|en|antes|después)$/.test(sentence);

}

function isGoodNumber(number) {
    // [English numbers| Persian numbers]
    return /^([A-Za-z]*[0-9|\u0660-\u0669]+)$/.test(number);
}

function isGoodPersonName(word) {
    return isGoodWord(word) || /^([a-zA-Záéíóúüñ¿¡]+\s[a-zA-Záéíóúüñ¿¡]+\s?\.?)$/.test(word);
}

module.exports = {
    isGoodWord,
    isGoodSentence,
    isGoodNumber,
    isGoodPersonName
};
