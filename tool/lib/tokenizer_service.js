// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

const net = require('net');
const JsonDatagramSocket = require('./json_datagram_socket');

class CachingTokenizerService {
    constructor() {
        this._cache = {};
    }

    _getCacheForLanguage(lang) {
        let cache = this._cache[lang];
        if (!cache)
            this._cache[lang] = cache = new Map;
        return cache;
    }

    _tryCache(languageTag, sentence) {
        let cache = this._getCacheForLanguage(languageTag);
        return cache.get(sentence);
    }

    _storeCache(languageTag, sentence, result) {
        let cache = this._getCacheForLanguage(languageTag);
        cache.set(sentence, result);
    }
}

class LocalTokenizerService extends CachingTokenizerService {
    constructor() {
        super();

        const socket = new net.Socket();
        socket.connect({
            host: '127.0.0.1',
            port: 8888
        });
        this._socket = new JsonDatagramSocket(socket, socket, 'utf8');
        this._socket.on('data', (msg) => {
            let req = this._requests.get(msg.req);
            if (!req)
                return;
            this._requests.delete(msg.req);

            if (msg.error) {
                req.reject(new Error(msg.error));
            } else {
                req.resolve({
                    tokens: msg.tokens,
                    entities: msg.values
                });
            }
        });

        this._requests = new Map();
        this._nextRequest = 0;
    }

    end() {
        this._socket.end();
    }

    async tokenize(languageTag, utterance) {
        let cached = this._tryCache(languageTag, utterance);
        if (cached)
            return cached;
    
        const reqId = this._nextRequest++;
        const result = await new Promise((resolve, reject) => {
            this._requests.set(reqId, { resolve, reject });

            this._socket.write({ req: reqId, utterance, languageTag });
        });
        this._storeCache(languageTag, utterance, result);
        return result;
    }
}

class AlmondNLTokenizer extends CachingTokenizerService {
    async tokenize(languageTag, utterance) {
        let cached = this._tryCache(languageTag, utterance);
        if (cached)
            return cached;

        let url = 'https://almond-nl.stanford.edu/' + languageTag + '/tokenize?q=' + encodeURIComponent(utterance);
        const result = JSON.parse(await Tp.Helpers.Http.get(url));
        this._storeCache(languageTag, utterance, result);
        return result;
    }

    end() {}
}

module.exports = {
    get() {
        if (process.env.GENIE_USE_TOKENIZER === 'local')
            return new LocalTokenizerService();
        else
            return new AlmondNLTokenizer();
    },
};
