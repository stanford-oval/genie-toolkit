// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import DefaultLanguagePack from './default';
import English from './english';
import Italian from './italian';
import Persian from './persian';
import Arabic from './arabic';
import German from './german';
import Japanese from './japanese';
import Turkish from './turkish';
import Tagalog from './tagalog';
import Spanish from './spanish';
import Finnish from './finnish';
import Polish from './polish';
import SimplifiedChinese from './simplified-chinese';
import TraditionalChinese from './traditional-chinese';

import BaseTokenizer, { TokenizerResult } from './tokenizer/base';
export { BaseTokenizer, TokenizerResult };

export type LanguagePack = DefaultLanguagePack;

interface LPClass {
    new(locale : string) : LanguagePack;
}

const _classes : { [locale : string] : LPClass } = {
    'en': English,

    'it': Italian,

    'fa': Persian,
    'ar': Arabic,

    'de': German,
    'ja': Japanese,
    'tr': Turkish,
    'tl': Tagalog,
    'es': Spanish,
    'fi': Finnish,
    'pl': Polish,

    // accept both BCP47 forms (either with Script code or with Country code)
    // default to simplified chinese
    'zh': SimplifiedChinese,
    'zh-cn': SimplifiedChinese,
    'zh-hans': SimplifiedChinese,

    'zh-tw': TraditionalChinese,
    'zh-hant': TraditionalChinese,
};

const _instances = new Map<string, LanguagePack>();

export function get(locale : string) : LanguagePack {
    locale = locale.toLowerCase();
    if (_instances.has(locale))
        return _instances.get(locale)!;

    const chunks = locale.split('-');
    for (let i = chunks.length; i >= 1; i--) {
        const candidate = chunks.slice(0, i).join('-');
        if (candidate in _classes) {
            const instance = new (_classes[candidate])(locale);
            _instances.set(locale, instance);
            return instance;
        }
    }
    console.error(`Locale ${locale} is not fully supported.`);
    const instance = new DefaultLanguagePack(locale);
    _instances.set(locale, instance);
    return instance;
}
