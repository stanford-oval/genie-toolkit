// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Tp = require('thingpedia');
const qs = require('querystring');

module.exports = class ParserClient {
    constructor(baseUrl, locale) {
        this._locale = locale;
        this._baseUrl = baseUrl + '/' + this._locale;
    }

    tokenize(utterance) {
        const data = {
            q: utterance,
        };

        let url = `${this._baseUrl}/tokenize?${qs.stringify(data)}`;

        return Tp.Helpers.Http.get(url).then((data) => {
            var parsed = JSON.parse(data);

            if (parsed.error)
                throw new Error('Error received from Genie-Parser server: ' + parsed.error);

            return parsed;
        });
    }

    sendUtterance(utterance, tokenized) {
        const data = {
            q: utterance,
            store: 'no',
            tokenized: tokenized ? '1' : '',
            thingtalk_version: ThingTalk.version,
            skip_typechecking: '1'
        };

        let url = `${this._baseUrl}/query?${qs.stringify(data)}`;

        return Tp.Helpers.Http.get(url).then((data) => {
            var parsed = JSON.parse(data);

            if (parsed.error)
                throw new Error('Error received from Genie-Parser server: ' + parsed.error);

            return parsed;
        });
    }
};
