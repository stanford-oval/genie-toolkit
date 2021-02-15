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

export default class JapaneseLanguagePack extends DefaultLanguagePack {
    constructor(locale) {
        super(locale);
    }

    isGoodWord(word) {
        // filter out words that cannot be in the dataset,
        // because they would be either tokenized/preprocessed out or
        // they are unlikely to be used with voice
        return /^([\u30A0-\u30FF\u3041-\u3096\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6Aあいうえおoかきくけこがぎぐげごさしすせそざじずぜぞたちつてとだぢづでどなにぬねのはひふへほばびぶべぼぱぴぷぺぽまみむめもやゆよらりるれろわをんn/\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef0-9\u4e00-\u9fafa-zA-Z0-9][\u30A0-\u30FF\u3041-\u3096\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6Aあいうえおoかきくけこがぎぐげごさしすせそざじずぜぞたちつてとだぢづでどなにぬねのはひふへほばびぶべぼぱぴぷぺぽまみむめもやゆよらりるれろわをんn/\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf\u4e00-\u9faf0-9.,。，一-]*)$/.test(word);
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
}
