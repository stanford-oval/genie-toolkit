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

    _tryCache(locale, sentence, expect) {
        let cache = this._getCacheForLanguage(locale);
        return cache.get(expect + ': ' + sentence);
    }

    _storeCache(locale, sentence, expect, result) {
        let cache = this._getCacheForLanguage(locale);
        cache.set(expect + ': ' + sentence, result);
    }

    async tokenize(locale, utterance, expect = null) {
        let cached = this._tryCache(locale, utterance, expect);
        if (cached)
            return cached;

        const result = this._wrapped.tokenize(locale, utterance, expect);
        this._storeCache(locale, utterance, expect, result);
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
        this._requests = new Map();
        this._nextRequest = 0;

        this._address = sockaddr(address);
        this._socket = null;
        this._ended = false;
        this._reconnect();
    }

    _onMessage(msg) {
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
    }

    _reconnect() {
        const socket = new net.Socket();
        socket.connect(this._address);
        this._socket = new JsonDatagramSocket(socket, socket, 'utf8');
        this._socket.on('data', this._onMessage.bind(this));
        this._socket.on('error', (e) => {
            console.error(`Error communicating with tokenizer: ${e.message}`);
            this._socket.destroy();
            this._socket = null;

            // tokenizer failures are always transient, because the tokenizer is
            // stateless and should be deployed redundantly and with rolling updates
            // hence, try reconnecting immediately if there are requests in flight
            if (!this._ended && this._requests.size > 0) {
                this._reconnect();
                this._retryAllRequests();
            }
        });
        this._socket.on('end', () => {
            console.error(`Connection to tokenizer closed`);
            this._socket = null;

            if (!this._ended && this._requests.size > 0) {
                this._reconnect();
                this._retryAllRequests();
            }
        });

    }

    _retryAllRequests() {
        for (let req of this._requests.values()) {
            req.attempts++;
            if (req.attempts >= 3) {
                req.reject(new Error(`Too many failures in communicating with the tokenizer`));
                this._requests.delete(req.id);
                continue;
            }

            this._socket.write(req.msg);
        }
    }

    end() {
        this._ended = true;
        this._socket.end();
    }

    tokenize(locale, utterance, expect = null) {
        const reqId = this._nextRequest++;
        return new Promise((resolve, reject) => {
            const msg = { req: reqId, utterance, languageTag: locale, expect };
            const req = { id: reqId, msg, resolve, reject, attempts: 0 };

            this._requests.set(reqId, req);
            if (this._socket === null)
                this._reconnect();
            this._socket.write(msg);
        });
    }
}

class RemoteTokenizer {
    constructor(url = 'https://almond-nl.stanford.edu') {
        this._url = url;
    }

    async tokenize(locale, utterance, expect = null) {
        const data = JSON.stringify({
            q: utterance,
            expect
        });
        const result = JSON.parse(await Tp.Helpers.Http.post(this._url + '/' + locale + '/tokenize', data, {
            dataContentType: 'application/json'
        }));
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
