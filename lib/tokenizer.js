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
const sockaddr = require('sockaddr');

const JsonDatagramSocket = require('./json_datagram_socket');

class CachingTokenizerWrapper {
    constructor(wrapped) {
        this._wrapped = wrapped;
        this._cache = {};
    }

    end() {
        return this._wrapped.end();
    }

    _getCacheForLanguage(locale) {
        let cache = this._cache[locale];
        if (!cache)
            this._cache[locale] = cache = new Map;
        return cache;
    }

    _tryCache(locale, sentence) {
        let cache = this._getCacheForLanguage(locale);
        return cache.get(sentence);
    }

    _storeCache(locale, sentence, result) {
        let cache = this._getCacheForLanguage(locale);
        cache.set(sentence, result);
    }

    async tokenize(locale, utterance) {
        let cached = this._tryCache(locale, utterance);
        if (cached)
            return cached;

        const result = this._wrapped.tokenize(locale, utterance);
        this._storeCache(locale, utterance, result);
        return result;
    }
}

function cleanTokens(tokens) {
    return tokens.map((t) => {
        if (/^[A-Z].*\*/.test(t))
            return t.split('*')[0];
        else
            return t;
    });
}

class LocalTokenizer {
    constructor(address = '127.0.0.1:8888') {
        const socket = new net.Socket();
        socket.connect(sockaddr(address));
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
                    tokens: cleanTokens(msg.tokens),
                    entities: msg.values,
                    raw_tokens: msg.rawTokens,
                    pos_tags: msg.pos,
                    sentiment: msg.sentiment
                });
            }
        });

        this._requests = new Map();
        this._nextRequest = 0;
    }

    end() {
        this._socket.end();
    }

    tokenize(locale, utterance) {
        const languageTag = locale.split('-')[0];
        const reqId = this._nextRequest++;
        return new Promise((resolve, reject) => {
            this._requests.set(reqId, { resolve, reject });

            this._socket.write({ req: reqId, utterance, languageTag });
        });
    }
}

class RemoteTokenizer {
    constructor(url = 'https://almond-nl.stanford.edu') {
        this._url = url;
    }

    async tokenize(locale, utterance) {
        let url = this._url + '/' + locale + '/tokenize?q=' + encodeURIComponent(utterance);
        const result = JSON.parse(await Tp.Helpers.Http.get(url));
        return result;
    }

    end() {}
}

module.exports = {
    LocalTokenizer,
    RemoteTokenizer,

    get(which, cached) {
        let tokenizer;
        if (which === 'local')
            tokenizer = new LocalTokenizer();
        else
            tokenizer = new RemoteTokenizer();
        if (cached)
            return new CachingTokenizerWrapper(tokenizer);
        else
            return tokenizer;
    },
};
