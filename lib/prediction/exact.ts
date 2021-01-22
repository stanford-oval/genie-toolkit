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

import { promises as pfs } from 'fs';

import Trie, { WILDCARD } from '../utils/trie';
import { BTrie } from '../utils/btrie';

// at most 20 parses for each sentence
const LIMIT = 20;

function findSpan(sequence : string[], substring : string[]) {
    for (let i = 0; i < sequence.length-substring.length+1; i++) {
        let found = true;
        for (let j = 0; j < substring.length; j++) {
            if (sequence[i+j] !== substring[j]) {
                found = false;
                break;
            }
        }
        if (found)
            return i;
    }
    return -1;
}

export default class ExactMatcher {
    private _btrie : BTrie|null;
    private _trie ! : Trie<string, string, Set<string>>;

    constructor() {
        this._btrie = null;
        this._createTrie();
    }

    clear() {
        this._btrie = null;
        this._createTrie();
    }

    private _createTrie() {
        this._trie = new Trie((existing, newValue) => {
            if (existing === undefined) {
                existing = new Set<string>();
            } else {
                if (existing.has(newValue))
                    existing.delete(newValue);
            }
            existing.add(newValue);
            if (existing.size > LIMIT) {
                const res = existing.keys().next();
                if (!res.done) {
                    const { value:first } = res;
                    existing.delete(first);
                }
            }
            return existing;
        });
    }

    *[Symbol.iterator]() : IterableIterator<[Array<string | typeof WILDCARD>, string]> {
        for (const [key, valueSet] of this._trie) {
            if (!valueSet)
                continue;
            for (const value of valueSet)
                yield [key, value];
        }
    }

    async load(filename : string) {
        let buffer;
        try {
            const mmap = (await import('mmap-io')).default;
            const fd = await pfs.open(filename, 'r');
            const stats = await fd.stat();
            buffer = mmap.map(Math.ceil(stats.size / mmap.PAGESIZE) * mmap.PAGESIZE,
                mmap.PROT_READ, mmap.MAP_SHARED | mmap.MAP_POPULATE, fd.fd, 0, mmap.MADV_RANDOM);

            // we created the mapping, so we can close the file and remove it - the kernel
            // keeps a reference to it
            // at the next load, we'll overwrite _btrie, which will cause the buffer to go unreferenced
            // later, the GC will release buffer, unmap it, and _only then_ will the file actually be
            // closed and deleted
            await fd.close();
        } catch(e) {
            if (e.code !== 'MODULE_NOT_FOUND')
                throw e;
            buffer = await pfs.readFile(filename);
        }
        this._btrie = new BTrie(buffer);

        // assume that the binary file contains all modifications made afterwards, and clear the trie
        this._createTrie();
    }

    add(utterance : string[], target_code : string[]) {
        let inString = false;
        let spanBegin = 0;

        const tokens : Array<string | typeof WILDCARD> = utterance.slice();
        target_code = target_code.slice();
        for (let i = 0; i < target_code.length; i++) {
            const token = target_code[i];
            if (token !== '"')
                continue;
            inString = !inString;
            if (inString) {
                spanBegin = i+1;
            } else {
                const spanEnd = i;
                const span = target_code.slice(spanBegin, spanEnd);
                const beginIndex = findSpan(utterance, span);
                const endIndex = beginIndex + span.length;

                for (let j = beginIndex; j < endIndex; j++)
                    tokens[j] = WILDCARD;
                for (let j = spanBegin; j < spanEnd; j++)
                    target_code[j] = '\\' + (beginIndex + j - spanBegin);
            }
        }
        if (tokens[utterance.length-1] === '.')
            tokens.pop();

        this._trie.insert(tokens, target_code.join(' '));
    }

    get(utterance : string[]) : string[][]|null {
        if (utterance[utterance.length-1] === '.') {
            // make a copy so we can pop the last token
            utterance = utterance.slice();
            utterance.pop();
        }

        // combine both the results from the binary file, and from the in-memory trie
        // this way, we can override a single sentence without creating a new file,
        // but everytime the dataset is updated we'll release the memory and go back to
        // the efficient memory mapped file
        const fileResults : string|undefined = this._btrie ? this._btrie.search(utterance) : undefined;
        const localResults : Iterable<string>|undefined = this._trie.search(utterance);

        let results : string[];
        if (fileResults === undefined && localResults === undefined)
            return null;
        if (fileResults === undefined)
            results = Array.from(localResults!);
        else if (localResults === undefined)
            results = fileResults.split('\0');
        else
            results = fileResults.split('\0').concat(Array.from(localResults));
        results.reverse();

        const mapped : string[][] = [];
        for (let i = 0; i < results.length; i++) {
            const code = results[i].split(' ');
            mapped[i] = code;
            for (let j = 0; j < code.length; j++) {
                const token = code[j];
                if (/^\\[0-9]+$/.test(token))
                    code[j] = utterance[parseInt(token.substring(1), 10)];
            }
        }
        return mapped;
    }
}
