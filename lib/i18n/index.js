// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const DefaultLanguagePack = require('./default');
const _classes = {
    // all English is American English, cause 'Murrica
    'en': require('./american-english'),

    'it': require('./italian'),

    'fa': require('./persian'),
    'ar': require('./arabic'),

    'de': require('./german'),
    'ja': require('./japanese'),

    'tr': require('./turkish'),
    'tl': require('./tagalog'),
    'es': require('./spanish'),
    'fi': require('./finnish'),

    'pl': require('./polish'),

    // accept both BCP47 forms (either with Script code or with Country code)
    // default to simplified chinese
    'zh': require('./simplified-chinese'),
    'zh-cn': require('./simplified-chinese'),
    'zh-hans': require('./simplified-chinese'),
    
    'zh-tw': require('./traditional-chinese'),
    'zh-hant': require('./traditional-chinese'),
};

const _instances = new Map;

module.exports = {
    get(locale) {
        locale = locale.toLowerCase();
        if (_instances.has(locale))
            return _instances.get(locale);

        const chunks = locale.split('-');
        for (let i = chunks.length; i >= 1; i--) {
            const candidate = chunks.slice(0, i).join('-');
            if (candidate in _classes) {
                const instance = new (_classes[candidate])();
                _instances.set(locale, instance);
                return instance;
            }
        }
        console.error(`Locale ${locale} is not fully supported.`);
        const instance = new DefaultLanguagePack();
        _instances.set(locale, instance);
        return instance;
    }
};
