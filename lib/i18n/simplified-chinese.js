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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>, Jian Li <jianli19@cs.stanford.edu>


import ChineseTokenizer from './tokenizer/chinese';
import DefaultLanguagePack from './default';

let keys = [
    ["on", "开"],["off", "关"],["drip coffee","滴流 咖啡"],["espresso","意式 浓缩"],["latte","拿铁"],["flat white", "牛奶 咖啡"],["white mocha","白 摩卡"],
    ["caramel mocha","焦糖 摩卡"],["mocha","摩卡"],["macchiato","黑糖 玛奇朵"],["caramel macchiato","焦糖 玛奇朵"],["cappuccino","卡布奇诺"],["americano","美式 咖啡"],
    ["heat","暖气"],["cool","冷气"],["track","歌曲"],["normal","普通"],["vibrate","振动"],["silent","静音"],["auto","自动"],["away","不在"],["pool","拼车"],["select","uber 精选"],
    ["suv","越野车"],["assist","uber 关怀"],["best of youtube","热门"],["recommended","推荐"],["paid","付费"],["music","音乐"],["comedy","喜剧"],["film and entertainment","电影 与 娱乐"],
    ["gaming","游戏"],["beauty and fashion","流行"],["from_tv","电视"],["automotive","汽车"],["animation","动画"],["sports","运动"],["diy","自己 动手"],["tech","技术"],["science","科学"],
    ["cooking","烹饪"],["causes","起因"],["news and politics","政治"],["lifestyle","生活 风格"],["raining","下雨"],["cloudy","多云"],["sunny","晴天"],["snowy","下 雪"],["sleety","下 冰雹"],
    ["drizzling","毛毛雨"],["windy","刮风"],["politics","政治"],["opinions","评论"],["local","地区"],["national","国家"],["world","国际"],["powerpost","焦点"],
    ["capital weather gang","首都 天气"],["morning mix","早间 新闻"],["world news","世界 新闻"],["us business","美国 商业"],["business","商业"],["markets","市场"],
    ["technology","科技"],["cat","猫"],["dog","狗"],["horse","马"],["snail","蜗牛"],["year","年"],["yoda","尤达"],["shakespeare","莎士比亚"],["vulcan","瓦肯人"],["klingon","克林贡"],
    ["viral","传阅"],["rising","上升"],["uber_black","尊荣"]
];

/**
 * Language pack for Mandarin Chinese written with simplified characters, with
 * focus on Mandarin as commonly spoken in PRC.
 */
export default class SimplifiedChineseLanguagePack extends DefaultLanguagePack {
    constructor(locale) {
        super(locale);
    }

    getTokenizer() {
        if (this._tokenizer)
            return this._tokenizer;
        return this._tokenizer = new ChineseTokenizer();
    }

    postprocessSynthetic(sentence, program) {
        keys.forEach((key) => {
            let re = new RegExp("\\b" + key[0] + "\\b", "g");
            if (sentence.match(re))
                sentence = sentence.replace(key[0], key[1]);
        });
        return sentence;
    }
    
    detokenize(buffer, prevtoken, token) {
        // join without space
        return buffer + token;
    }

    pluralize(noun) {
        // pluralize pronouns
        if (/^[我你他她它]$/u.test(noun))
            return noun + '们';

        // no plural form
        return undefined;
    }

    toVerbPast(phrase) {
        return phrase + '了';
    }

    isGoodWord(word) {
        // filter out words that cannot be in the dataset,
        // because they would be either tokenized/preprocessed out or
        // they are unlikely to be used with voice
        // + allow English names
        // [CJK Unified Ideographs| CJK Strokes| CJK Compatibility| English characters ...]
        return /^([\u4e00-\u9fff\u31C0-\u31EF\u3300-\u33FF0-9][\u4e00-\u9fff\u31C0-\u31EF\u3300-\u33FFa-zA-Z0-9.,。，一-]*)$/.test(word);
    }

    isGoodSentence(sentence) {
        if (sentence.length < 3)
            return false;
        if (['.', '？', '。', '!', ' '].includes(sentence[0]))
            return false;
        // (for|me|and|or|that|this|in|with|from|on|before|after)$
        return !/^(为|我|和|或|此|在|中|在|之前|之后)$/.test(sentence);
    }

    isGoodNumber(number) {
        // [English numbers| Chines numbers?]
        return /^([0-9]+)$/.test(number);
    }

    isGoodPersonName(word) {
        return this.isGoodWord(word) || /^([\u4e00-\u9fff\u31C0-\u31EF\u3300-\u33FF0-9]+\s[\u4e00-\u9fff\u31C0-\u31EF\u3300-\u33FF]+\s?\.)$/.test(word);
    }
}

const ABBREVIATIONS = [
    ['公司', '有限公司', '股份有限公司'],
    ['高铁', '高速铁路'],
    ['网路', '网络'],
    ['&', '和'],
];
const PROCESSED_ABBREVIATIONS = {};
for (let abbr of ABBREVIATIONS) {
    for (let variant of abbr)
        PROCESSED_ABBREVIATIONS[variant] = abbr;
}
SimplifiedChineseLanguagePack.prototype.ABBREVIATIONS = PROCESSED_ABBREVIATIONS;

SimplifiedChineseLanguagePack.prototype.NO_IDEA = [
    '不知道', '不懂', '不晓得', '不了解',
    '不了', '看不懂', '不清楚'
];
