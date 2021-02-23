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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import assert from 'assert';

import * as I18n from '../../lib/i18n';

const TEST_CASES = [
    // order is input, raw, processed, entities

    // note: stuff that is implemented by the base tokenizer is only tested for English

    // basics: split every character
    // "I'm looking for the best restaurant in the north part of town"
    // (proper tokenization would be: 我 想 要 在 城市 的 北边 最 好 的 饭馆)
    ['我想要在城市的北边最好的饭馆', '我 想 要 在 城 市 的 北 边 最 好 的 饭 馆', '我 想 要 在 城 市 的 北 边 最 好 的 饭 馆', {}],
    // "I can help you! What cuisine would you like?"
    // (proper would be: "我 可以 帮助 你 ！ 你 想 什么 菜 ？"
    // note that NFKD normalization converted the ideographic punctuation to ASCII one
    ['我可以帮助你！你想要什么菜？', '我 可 以 帮 助 你 ! 你 想 要 什 么 菜 ?', '我 可 以 帮 助 你 ! 你 想 要 什 么 菜 ?', {}],
    // "Italian cuisine. Do you have a cheap one?"
    // (proper would be "意大利 菜 ！ 你 有 一 家 便宜 的 吗 ？"
    ['意大利菜！你有一家便宜的吗？', '意 大 利 菜 ! 你 有 一 家 便 宜 的 吗 ?', '意 大 利 菜 ! 你 有 一 家 便 宜 的 吗 ?', {}],
    // "I am sorry, There are no cheap Italian restaurants in the north part of town."
    ['对不起！城市的北边没有便宜的意大利菜饭馆。', '对 不 起 ! 城 市 的 北 边 没 有 便 宜 的 意 大 利 菜 饭 馆 。', '对 不 起 ! 城 市 的 北 边 没 有 便 宜 的 意 大 利 菜 饭 馆 。', {}],

    // numbers and measurements
    ['3gb', '3 gb', '3 gb', {}],
    ['25gb', '25 gb', '25 gb', {}],
    ['-3gb', '-3 gb', '-3 gb', {}],
    ['-25gb', '-25 gb', '-25 gb', {}],
    ['1.75gb', '1.75 gb', '1.75 gb', {}],
    ['1.75,', '1.75 ,', '1.75 ,', {}],
    ['25,', '25 ,', '25 ,', {}],
    ['25,000', '25000', '25000', {}],
    ['25,00', '2500', '2500', {}],
    ['一', '一', '一', {}],
    ['五', '5', '5', {}],
    ['十二', '12', '12', {}],
    ['十三', '13', '13', {}],
    ['二十', '20', '20', {}],
    ['二十一', '21', '21', {}],
    ['二十二', '22', '22', {}],
    ['二十九', '29', '29', {}],
    ['九十一', '91', '91', {}],
    ['九十二', '92', '92', {}],
    ['一万', '10000', '10000', {}],
    ['一百万', '1000000', '1000000', {}],
    ['二百万', '2000000', '2000000', {}],
    ['一百万二千三百', '1002300', '1002300', {}],
    // trailing multiplier can be omitted
    ['一百万二千三', '1002300', '1002300', {}],
    // but "零" resets
    ['一百二十万零三', '1200003', '1200003', {}],
    ['一百', '100', '100', {}],
    ['一百一', '110', '110', {}],
    ['一千', '1000', '1000', {}],
    ['一千一', '1100', '1100', {}],
    ['二千二百', '2200', '2200', {}],
    ['二千三百四十五', '2345', '2345', {}],
    ['三十万', '300000', '300000', {}],
    ['三十一万五千', '315000', '315000', {}],
    ['三十一万五', '315000', '315000', {}],
    ['一万零二百', '10200', '10200', {}],
    ['一万二百零三', '10203', '10203', { }],
    ['一万零二百三', '10230', '10230', {}],
    ['一万二百三', '10230', '10230', {}],
    ['一万二', '12000', '12000', {}],
    ['一百二十万', '1200000', '1200000', {}],
    ['一百万零二千', '1002000', '1002000', {}],
    // the following is invalid, we can parse it however we like
    ['一百万二', '1002000', '1002000', {}],

    // ordinals
    ['我要第1个', '我 要 第 1 个', '我 要 第 1 个', {}],
    ['我要第13个', '我 要 第 13 个', '我 要 第 13 个', {}],
    ['我要第21个', '我 要 第 21 个', '我 要 第 21 个', {}],
    ['我要第一个', '我 要 第 一 个', '我 要 第 一 个', {}],
    ['我要第五个', '我 要 第 5 个', '我 要 第 5 个', {}],
    ['我要第十二个', '我 要 第 12 个', '我 要 第 12 个', {}],
    ['我要第十三个', '我 要 第 13 个', '我 要 第 13 个', {}],
    ['我要第二十个', '我 要 第 20 个', '我 要 第 20 个', {}],
    ['我要第二十一个', '我 要 第 21 个', '我 要 第 21 个', {}],
    ['我要第二十二个', '我 要 第 22 个', '我 要 第 22 个', {}],
    ['我要第二十九个', '我 要 第 29 个', '我 要 第 29 个', {}],
    ['我要第九十一个', '我 要 第 91 个', '我 要 第 91 个', {}],
    ['我要第一百万个', '我 要 第 1000000 个', '我 要 第 1000000 个', {}],

    // currencies
    ['它$50', '它 50usd', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['它$50', '它 50usd', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['它$1,000', '它 1000usd', '它 CURRENCY_0', { CURRENCY_0: { value: 1000, unit: 'usd' }}],
    ['它€50', '它 50eur', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'eur' }}],
    ['它50美元', '它 50usd', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['它50美金', '它 50usd', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['它50刀', '它 50usd', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'usd' }}],
    ['它50元', '它 50cny', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'cny' }}],
    ['它50块', '它 50cny', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'cny' }}],
    ['它50元钱', '它 50cny 钱', '它 CURRENCY_0 钱', { CURRENCY_0: { value: 50, unit: 'cny' }}],
    ['它50块钱', '它 50cny 钱', '它 CURRENCY_0 钱', { CURRENCY_0: { value: 50, unit: 'cny' }}],
    ['它50eur', '它 50eur', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'eur' }}],
    ['它50欧', '它 50eur', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'eur' }}],
    ['它50cny', '它 50cny', '它 CURRENCY_0', { CURRENCY_0: { value: 50, unit: 'cny' }}],

    // times

    // simple numeric times
    ['现在7:15', '现 在 7:15:00', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['现在7:15:22', '现 在 7:15:22', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 15, second: 22 } }],
    ['现在3:15', '现 在 3:15:00', '现 在 TIME_0', { TIME_0: { hour: 3, minute: 15, second: 0 } }],
    ['现在15:15', '现 在 15:15:00', '现 在 TIME_0', { TIME_0: { hour: 15, minute: 15, second: 0 } }],
    ['现在19:15', '现 在 19:15:00', '现 在 TIME_0', { TIME_0: { hour: 19, minute: 15, second: 0 } }],

    // colloquial times
    ['现在7点15分', '现 在 7:15:00', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['现在7点', '现 在 7:00:00', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 0, second: 0 } }],
    ['现在7点15分22秒', '现 在 7:15:22', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 15, second: 22 } }],
    ['现在七点十五分', '现 在 7:15:00', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['现在七点', '现 在 7:00:00', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 0, second: 0 } }],
    ['现在七点一刻', '现 在 7:15:00', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 15, second: 0 } }],
    ['现在七点半', '现 在 7:30:00', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 30, second: 0 } }],
    ['现在七点三刻', '现 在 7:45:00', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 45, second: 0 } }],
    ['现在七点十五分二十二秒', '现 在 7:15:22', '现 在 TIME_0', { TIME_0: { hour: 7, minute: 15, second: 22 } }],

    // dates
    ['6月1号', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['6月1日', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['6月1日星期天', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['6月1日，星期天', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['6月1日星期一', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['2020年6月1号', '2020-06-01', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['六月一号', 'XXXX-06-01', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['二〇二〇年六月一号', '2020-06-01', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['12月1号', 'XXXX-12-01', 'DATE_0', { DATE_0: { year: -1, month: 12, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['2020年12月1号', '2020-12-01', 'DATE_0', { DATE_0: { year: 2020, month: 12, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['十二月一号', 'XXXX-12-01', 'DATE_0', { DATE_0: { year: -1, month: 12, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['2020年十二月一号', '2020-12-01', 'DATE_0', { DATE_0: { year: 2020, month: 12, day: 1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['十二月三十一号', 'XXXX-12-31', 'DATE_0', { DATE_0: { year: -1, month: 12, day: 31, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['2020年十二月三十一号', '2020-12-31', 'DATE_0', { DATE_0: { year: 2020, month: 12, day: 31, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['4月3号', 'XXXX-04-03', 'DATE_0', { DATE_0: { year: -1, month: 4, day: 3, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['2020年4月3号', '2020-04-03', 'DATE_0', { DATE_0: { year: 2020, month: 4, day: 3, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['2020年6月', '2020-06-XX', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: -1, hour: 0, minute: 0, second: 0, timezone: undefined } }],
    ['2020年六月', '2020-06-XX', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: -1, hour: 0, minute: 0, second: 0, timezone: undefined } }],

    // three special dates which are normally referred in abbreviation
    // these turn into small numbers and the neural network learns to predict a date
    ['六一', '6 一', '6 一', {}],
    ['五一', '5 一', '5 一', {}],
    ['十一', '11', '11', {}],

    // with times
    ['6月1号1:15', 'XXXX-06-01T01:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 1, minute: 15, second: 0, timezone: undefined } }],
    ['6月1号在1:15', 'XXXX-06-01T01:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 1, minute: 15, second: 0, timezone: undefined } }],
    ['6月1号星期天1:15', 'XXXX-06-01T01:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 1, minute: 15, second: 0, timezone: undefined } }],
    ['6月1号星期天在1:15', 'XXXX-06-01T01:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 1, minute: 15, second: 0, timezone: undefined } }],
    ['6月1号7:15', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['六月一号在7:15', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['六月一号在7点15分', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['六月一号在7点一刻', 'XXXX-06-01T07:15:00', 'DATE_0', { DATE_0: { year: -1, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],

    // again, with years
    ['2020年6月1号1:15', '2020-06-01T01:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 1, minute: 15, second: 0, timezone: undefined } }],
    ['2020年6月1号在1:15', '2020-06-01T01:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 1, minute: 15, second: 0, timezone: undefined } }],
    ['2020年6月1号7:15', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['2020年六月一号在7:15', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['2020年六月一号在7点15分', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
    ['2020年六月一号在7点一刻', '2020-06-01T07:15:00', 'DATE_0', { DATE_0: { year: 2020, month: 6, day: 1, hour: 7, minute: 15, second: 0, timezone: undefined } }],
];

function main() {
    const langPack = I18n.get('zh-CN');
    const tokenizer = langPack.getTokenizer();

    let anyFailed = false;
    for (let [input, raw, processed, entities] of TEST_CASES) {
        const tokenized = tokenizer.tokenize(input);
        try {
            assert.strictEqual(tokenized.rawTokens.join(' '), raw);
            assert.strictEqual(tokenized.tokens.join(' '), processed);
            assert.deepStrictEqual(tokenized.entities, entities);
        } catch(e) {
            console.error(`Test case "${input}" failed`); //"
            console.error(e);
            anyFailed = true;
            throw e;
        }
    }
    if (anyFailed)
        throw new Error('Some test failed');
}
export default main;
if (!module.parent)
    main();
