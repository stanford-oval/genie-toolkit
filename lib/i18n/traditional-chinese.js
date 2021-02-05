// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 National Taiwan University
//           2019-2020 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>, Johnny Hsu <johnny.chhsu01@gmail.com>


let keys = [
    ["on", "開"],["off", "關"],["drip coffee","濾掛式 咖啡"],["espresso","義式 濃縮"],["latte","拿鐵"],["flat white", "牛奶 咖啡"],["white mocha","白摩卡"],
    ["caramel mocha","星冰樂"],["mocha","摩卡"],["macchiato","瑪琪雅朵"],["caramel macchiato","白瑪琪雅朵"],["cappuccino","卡布其諾"],["americano","美式"],
    ["heat","暖氣"],["cool","冷氣"],["track","歌曲"],["normal","普通"],["vibrate","振動"],["silent","靜音"],["auto","自動"],["away","不在"],["pool","共乘"],["select","uber 精選"],
    ["suv","休旅車"],["assist","uber 關懷"],["best of youtube","熱門"],["recommended","推薦"],["paid","付費"],["music","音樂"],["comedy","喜劇"],["film and entertainment","電影 與 娛樂"],
    ["gaming","遊戲"],["beauty and fashion","流行"],["from_tv","電視"],["automotive","汽車"],["animation","動畫"],["sports","動畫"],["diy","動手做"],["tech","科技"],["science","科學 與 自然"],
    ["cooking","烹飪"],["causes","起因"],["news and politics","政治"],["lifestyle","生活 風格"],["raining","下雨"],["cloudy","多雲"],["sunny","晴天"],["snowy","下 雪"],["sleety","下 冰雹"],
    ["drizzling","毛毛雨"],["windy","刮風"],["politics","政治"],["opinions","社論"],["local","地區"],["sports","運動"],["national","國家"],["world","國際"],["powerpost","焦點"],
    ["capital weather gang","首都 天氣"],["morning mix","晨間 新聞"],["wonkblog"],["world news","世界 新聞"],["us business","美國 商業"],["business","商業"],["markets","市場"],
    ["technology","科技"],["cat","貓"],["dog","狗"],["horse","馬"],["snail","蝸牛"],["year","年"],["yoda","尤達"],["shakespeare","莎士比亞"],["vulcan","瓦肯人"],["klingon","克林貢"],
    ["viral","傳閱"],["rising","上升"],["uber_black","尊榮"]
];

import ChineseTokenizer from './tokenizer/chinese';
import DefaultLanguagePack from './default';

/**
 * Language pack for Mandarin Chinese written with traditional characters, with
 * focus on Mandarin as commonly spoken in Taiwan.
 */
export default class TraditionalChineseLanguagePack extends DefaultLanguagePack {
    constructor(locale) {
        super(locale);
    }

    getTokenizer() {
        if (this._tokenizer)
            return this._tokenizer;
        // TODO: the Chinese tokenizer only recognizes simplified characters
        // for numbers and dates
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
        // TODO
        return undefined;
    }

    toVerbPast(phrase) {
        return phrase + '了';
    }
}

const ABBREVIATIONS = [
    ['公司', '有限公司', '股份有限公司'],
    ['高鐵', '高速鐵路'],
    ['網路', '網際網路'],
    ['&', '和'],
];
const PROCESSED_ABBREVIATIONS = {};
for (let abbr of ABBREVIATIONS) {
    for (let variant of abbr)
        PROCESSED_ABBREVIATIONS[variant] = abbr;
}
TraditionalChineseLanguagePack.prototype.ABBREVIATIONS = PROCESSED_ABBREVIATIONS;

TraditionalChineseLanguagePack.prototype.NO_IDEA = [
    '不知道', '不懂', '不曉得', '不了解',
    '不了', '看不懂', '不清楚'
];
