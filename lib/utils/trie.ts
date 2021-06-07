// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
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

export const WILDCARD = {};

class TrieNode<K, V, VCombined> {
    private _valueCombine : (one : VCombined|undefined, two : V) => VCombined;
    value : VCombined|undefined;
    children : Map<K | typeof WILDCARD, TrieNode<K, V, VCombined>>;

    constructor(valueCombine : (one : VCombined|undefined, two : V) => VCombined) {
        this._valueCombine = valueCombine;
        this.value = undefined;
        this.children = new Map;
    }

    *iterate(keyPrefix : Array<K | typeof WILDCARD>) : Generator<[Array<K | typeof WILDCARD>, VCombined|undefined]> {
        if (this.value !== undefined)
            yield [keyPrefix, this.value];

        for (const [key, child] of this.children) {
            keyPrefix.push(key);
            yield* child.iterate(keyPrefix);
            keyPrefix.pop();
        }
    }

    addValue(value : V) {
        this.value = this._valueCombine(this.value, value);
    }

    addChild(key : K | typeof WILDCARD) : TrieNode<K, V, VCombined> {
        const child = new TrieNode<K, V, VCombined>(this._valueCombine);
        this.children.set(key, child);
        return child;
    }

    getChild(key : K | typeof WILDCARD, allowWildcard = false) {
        let child = this.children.get(key);
        if (allowWildcard && !child)
            child = this.children.get(WILDCARD);
        return child;
    }
}

/**
  A simple Trie-based key-value store.
*/
export default class Trie<K, V, VCombined> {
    root : TrieNode<K, V, VCombined>;

    constructor(valueCombine : (one : VCombined|undefined, two : V) => VCombined) {
        this.root = new TrieNode(valueCombine);
    }

    [Symbol.iterator]() : Iterator<[Array<K | typeof WILDCARD>, VCombined|undefined]> {
        return this.root.iterate([]);
    }

    insert(sequence : Array<K | typeof WILDCARD>, value : V) {
        let node = this.root;
        for (const key of sequence) {
            let child = node.getChild(key);
            if (!child)
                child = node.addChild(key);
            node = child;
        }
        node.addValue(value);
    }

    search(sequence : K[]) : VCombined|undefined {
        let node = this.root;
        for (const key of sequence) {
            const child = node.getChild(key, true);
            if (!child)
                return undefined;
            node = child;
        }
        return node.value;
    }
}
