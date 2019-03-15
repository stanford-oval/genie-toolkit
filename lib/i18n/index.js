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

class UnsupportedLocaleError extends Error {
    constructor(locale) {
        super(`Unsupported locale ${locale}`);
        this.code = 'ENOSUP';
        this.locale = locale;
    }
}

module.exports = {
    // all English is American English, cause 'Murrica
    'en': require('./american-english'),

    'it': require('./italian'),

    // accept both BGP47 forms (either with Script code or with Country code)
    'zh-cn': require('./simplified-chinese'),
    'zh-hans': require('./simplified-chinese'),
    
    'zh-tw': require('./traditional-chinese'),
    'zh-hant': require('./traditional-chinese')
};
Object.defineProperty(module.exports, 'get', {
    configurable: true,
    enumerable: false,
    value: function(locale) {
        locale = locale.toLowerCase();
        const chunks = locale.split('-');
        for (let i = chunks.length; i >= 1; i--) {
            const candidate = chunks.slice(0, i).join('-');
            if (candidate in this)
                return this[candidate];
        }
        throw new UnsupportedLocaleError(locale);
    }
});
