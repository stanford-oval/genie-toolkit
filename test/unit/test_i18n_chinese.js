// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2019 National Taiwan University
//
// Author: Johnny Hsu <johnny.chhsu01@gmail.com>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const zh_tw = require('../lib/i18n/traditional-chinese');

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
    for (let i = 0; i < SENTENCE_TEST_CASES.length; i++) {
        let [original, processed] = SENTENCE_TEST_CASES[i];
        let result = zh_tw.postprocessSynthetic(original, "");
        assert.strictEqual(processed, result);
    }
}

async function main() {
    testPostProcessSynthetic();
}
module.exports = main;
if (!module.parent)
    main();
