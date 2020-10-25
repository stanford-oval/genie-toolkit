// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 National Taiwan University
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
// Author: Johnny Hsu <johnny.chhsu01@gmail.com>


import assert from 'assert';

import * as I18n from '../../lib/i18n';

const SENTENCE_TEST_CASES = [
    ["給 我 一杯 drip coffee", "給 我 一杯 濾掛式 咖啡"],
    ["給 我 一杯 white mocha", "給 我 一杯 白摩卡"],
    ["幫 我 放 music", "幫 我 放 音樂"],
    ["今天 天氣 是 raining", "今天 天氣 是 下雨"],
    ["台北 的 天氣 cloudy", "台北 的 天氣 多雲"],
    ["給 我 powerpost 版 新聞", "給 我 焦點 版 新聞"],
    ["福斯 新聞 的 us business 新聞", "福斯 新聞 的 美國 商業 新聞"],
    ["叫 一 輛 uber uber_black", "叫 一 輛 uber 尊榮"],
];

function testPostProcessSynthetic() {
    const langPack = I18n.get('zh-tw');

    for (let i = 0; i < SENTENCE_TEST_CASES.length; i++) {
        let [original, processed] = SENTENCE_TEST_CASES[i];
        let result = langPack.postprocessSynthetic(original, "");
        assert.strictEqual(processed, result);
    }
}

async function main() {
    testPostProcessSynthetic();
}
export default main;
if (!module.parent)
    main();
