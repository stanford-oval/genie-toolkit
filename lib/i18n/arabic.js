// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Mehrad Moradshahi <mehrad@cs.stanford.edu>


import DefaultLanguagePack from './default';

export default class ArabicLanguagePack extends DefaultLanguagePack {
    constructor(locale) {
        super(locale);
    }

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
}
