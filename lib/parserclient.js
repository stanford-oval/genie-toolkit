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

const Tp = require('thingpedia');

const URL = 'https://almond-nl.stanford.edu';

module.exports = class ParserClient {
    constructor(baseUrl, locale, prefs) {
        this._locale = locale || 'en_US';
        this._baseUrl = (baseUrl || URL) + '/' + this._locale;
        this._prefs = prefs;

        console.log('Using Almond-NNParser at ' + this._baseUrl);
    }

    onlineLearn(utterance, code, store = 'automatic') {
        const data = `q=${encodeURIComponent(utterance)}&target=${code.map(encodeURIComponent).join('+')}&store=${store}`;
        Tp.Helpers.Http.post(this._baseUrl + '/learn', data, { dataContentType: 'application/x-www-form-urlencoded' }).then(() => {
            console.log(`Sent "${utterance}" to Almond-NNParser for learning`);
        }).catch((e) => {
            console.error(`Failed to send "${utterance}" to Almond-NNParser for learning: ${e.message}`);
        });
    }

    sendUtterance(utterance, expecting, choices) {
        const store = this._prefs.get('sabrina-store-log') || 'no';
        let url = `${this._baseUrl}/query?store=${store}&q=${encodeURIComponent(utterance)}`;// / <- fix spurious warning
        if (expecting)
            url += '&expect=' + encodeURIComponent(expecting);
        if (choices) {
            choices.forEach((c, i) => {
                if (c)
                    url += `&choices[${i}]=${encodeURIComponent(c.title)}`;
            });
        }
        return Tp.Helpers.Http.get(url).then((data) => {
            var parsed = JSON.parse(data);

            if (parsed.error)
                throw new Error('Error received from Almond-NNParser server: ' + parsed.error);

            return parsed;
        });
    }
};