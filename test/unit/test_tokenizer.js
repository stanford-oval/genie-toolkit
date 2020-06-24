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

// we run a "mock" version of almond-tokenizer in process, to test that things go
// back and forth reasonably, and the client can handle network errors

const net = require('net');
const assert = require('assert');
const JsonDatagramSocket = require('../../lib/utils/json_datagram_socket');

const { LocalTokenizer } = require('../../lib/tokenizer');

function delay(ms) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    });
}

function tokenize(string) {
        var tokens = string.split(/(\s+|[,."'!?])/g);
        return tokens.filter((t) => !(/^\s*$/).test(t)).map((t) => t.toLowerCase());
}

function mockTokenize(string) {
    const entities = {};
    let num = 0;

    const rawTokens = tokenize(string);
    const tokens = rawTokens.map((token) => {
        if (/^[0-9]+$/.test(token) && token !== '1' && token !== '0' && token !== '911') {
            const tok = `NUMBER_${num}`;
            num++;
            entities[tok] = parseInt(token);
            return tok + '*1';
        } else {
            return token;
        }
    });
    return [rawTokens, tokens, entities];
}

let cnt = 0;
function handleConnection(socket) {
    const wrapped = new JsonDatagramSocket(socket, socket, 'utf8');

    wrapped.on('data', (msg) => {
        try {
            assert.strictEqual(msg.languageTag, 'en');
            if (msg.utterance === '$destroy') {
                socket.destroy();
                return;
            }
            if (msg.utterance === '$destroyonce' && cnt === 0) {
                cnt++;
                socket.destroy();
                return;
            }
            if (msg.utterance === '$error')
                throw new Error('nope');

            const [rawTokens, tokens, values] = mockTokenize(msg.utterance);
            wrapped.write({
                req: msg.req,
                tokens,
                values,
                rawTokens,
                pos: rawTokens.map(() => 'NN'),
                sentiment: 'neutral'
            });

            if (msg.utterance === '$end') {
                socket.end();
                return;
            }
        } catch(e) {
            if (e.message !== 'nope')
                console.error(e);
            wrapped.write({
                req: msg.req,
                error: e.message
            });
        }
    });
}

function startServer() {
    const server = net.createServer();
    server.on('connection', handleConnection);
    server.listen(8888);
    return server;
}

async function testSimple() {
    const tok = new LocalTokenizer();

    assert.deepStrictEqual(await tok.tokenize('en', 'get a cat picture'), {
        entities: {},
        pos_tags: ['NN','NN','NN','NN'],
        raw_tokens: ['get', 'a', 'cat', 'picture'],
        sentiment: 'neutral',
        tokens: ['get', 'a', 'cat', 'picture']
    });

    assert.deepStrictEqual(await tok.tokenize('en', 'get 3 cat pictures'), {
        entities: {
            'NUMBER_0': 3
        },
        pos_tags: ['NN','NN','NN','NN'],
        raw_tokens: ['get', '3', 'cat', 'pictures'],
        sentiment: 'neutral',
        tokens: ['get', 'NUMBER_0', 'cat', 'pictures']
    });

    await tok.end();
}


async function testParallel() {
    const tok = new LocalTokenizer();

    const r1 = tok.tokenize('en', 'get a cat picture');
    const r2 = tok.tokenize('en', 'get 3 cat pictures');

    assert.deepStrictEqual(await r1, {
        entities: {},
        pos_tags: ['NN','NN','NN','NN'],
        raw_tokens: ['get', 'a', 'cat', 'picture'],
        sentiment: 'neutral',
        tokens: ['get', 'a', 'cat', 'picture']
    });

    assert.deepStrictEqual(await r2, {
        entities: {
            'NUMBER_0': 3
        },
        pos_tags: ['NN','NN','NN','NN'],
        raw_tokens: ['get', '3', 'cat', 'pictures'],
        sentiment: 'neutral',
        tokens: ['get', 'NUMBER_0', 'cat', 'pictures']
    });

    await tok.end();
}

async function testInflight() {
    const tok = new LocalTokenizer();
    tok.tokenize('en', 'get a cat picture');

    // end before the request comes
    tok.end();
}

async function testErrors() {
    const tok = new LocalTokenizer();
    await assert.rejects(() => tok.tokenize('en', '$error'), new Error('nope'));

    await assert.rejects(() => tok.tokenize('en', '$destroy'), new Error('Too many failures in communicating with the tokenizer'));

    // the same tokenizer is still ok for a different sentence
    assert.deepStrictEqual(await tok.tokenize('en', 'get a cat picture'), {
        entities: {},
        pos_tags: ['NN','NN','NN','NN'],
        raw_tokens: ['get', 'a', 'cat', 'picture'],
        sentiment: 'neutral',
        tokens: ['get', 'a', 'cat', 'picture']
    });

    // handle transient failures
    assert.deepStrictEqual(await tok.tokenize('en', '$destroyonce'), {
        entities: {},
        pos_tags: ['NN'],
        raw_tokens: ['$destroyonce'],
        sentiment: 'neutral',
        tokens: ['$destroyonce']
    });

    // handle different kind of transient failures
    assert.deepStrictEqual(await tok.tokenize('en', '$end'), {
        entities: {},
        pos_tags: ['NN'],
        raw_tokens: ['$end'],
        sentiment: 'neutral',
        tokens: ['$end']
    });

    // wait until the connection actually closed
    await delay(1000);

    assert.deepStrictEqual(await tok.tokenize('en', 'get a cat picture'), {
        entities: {},
        pos_tags: ['NN','NN','NN','NN'],
        raw_tokens: ['get', 'a', 'cat', 'picture'],
        sentiment: 'neutral',
        tokens: ['get', 'a', 'cat', 'picture']
    });

    await tok.end();
}

async function main() {
    const server = startServer();
    try {
        await testSimple();
        await testParallel();
        await testInflight();
        await testErrors();
    } finally {
        server.close();
    }
}
module.exports = main;
if (!module.parent)
    main();
