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
"use strict";

const fs = require('fs');
const util = require('util');
const path = require('path');

const metagrammar = require('./grammar');

const runtime = require('../runtime');

class Queue {
    constructor() {
        this.head = null;
        this.tail = null;
    }

    get empty() {
        return this.head === null;
    }

    push(data) {
        if (this.tail === null) {
            this.head = this.tail = {
                data: data,
                next: null
            };
        } else {
            this.tail.next = {
                data: data,
                next: null
            };
            this.tail = this.tail.next;
        }
    }

    peek() {
        if (this.head === null)
            return null;
        else
            return this.head.data;
    }

    pop() {
        if (this.head === null)
            return null;

        const data = this.head.data;
        this.head = this.head.next;
        if (this.head === null)
            this.tail = this.head;

        return data;
    }
}

const _importCache = {};
module.exports = async function compile(entrypoint) {
    entrypoint = path.resolve(entrypoint);

    const queue = new Queue();
    async function parse(filename) {
        if (_importCache[filename])
            return;

        const input = (await util.promisify(fs.readFile)(filename)).toString();

        // race-condition with parallel parse
        if (_importCache[filename])
            return;

        let parsed;
        try {
            parsed = metagrammar.parse(input);
        } catch(e) {
            e.fileName = filename;
            console.error(e);
            throw e;
        }

        const dirname = path.dirname(filename);
        function recursiveQueue(statements) {
            for (let stmt of statements) {
                if (stmt.isImport) {
                    stmt.what = path.resolve(dirname, stmt.what);
                    if (!stmt.what.endsWith('.genie'))
                        stmt.what = stmt.what + '.genie';

                    queue.push(() => parse(stmt.what));
                } else if (stmt.isIf) {
                    recursiveQueue(stmt.iftrue);
                    recursiveQueue(stmt.iffalse);
                } else if (stmt.isFor) {
                    recursiveQueue(stmt.statements);
                }
            }
        }
        recursiveQueue(parsed.statements);

        function require_(req) {
            if (req.startsWith('./') || req.startsWith('../'))
                return require(path.resolve(dirname, req));
            else
                return require(req);
        }
        function import_(what) {
            return _importCache[what];
        }

        let compiled;
        try {
            compiled = (new Function('require', '$import', '$runtime', parsed.codegen()))(require_, import_, runtime);
        } catch(e) {
            console.error(parsed.codegen());
            throw e;
        }
        _importCache[filename] = compiled;
    }

    queue.push(() => parse(entrypoint));
    while (!queue.empty) {
        const next = queue.pop();
        await next();
    }

    return _importCache[entrypoint];
};
module.exports._importCache = _importCache;
