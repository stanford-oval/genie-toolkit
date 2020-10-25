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


import assert from 'assert';
import path from 'path';
import * as fs from 'fs';
const pfs = fs.promises;

import { DialogueParser, DatasetParser } from '../lib/dataset-tools/parsers';

import { readAllLines } from './lib/argutils';

function measure(corpus, name) {
    let words = new Set();
    for (const sentence of corpus) {
        for (const token of sentence.split(' '))
            words.add(token);
    }

    words = Array.from(words);
    words.sort();
    words.unshift('</s>');
    words.unshift('<s>');
    const vocab = new Map;
    for (let i = 0; i < words.length; i++)
        vocab.set(words[i], i);
    words = null;

    const start_id = vocab.get('<s>');
    const eos_id = vocab.get('</s>');

    const V = vocab.size;
    console.error(`${name} corpus has ${V} words`);

    const bigrams = new Map;
    for (const sentence of corpus) {
        const words = sentence.split(' ');

        for (let i = 0; i < words.length+1; i++) {
            let curr = i < words.length ? vocab.get(words[i]) : eos_id;
            let prev = i > 0 ? vocab.get(words[i-1]) : start_id;
            let id = prev * V + curr;
            bigrams.set(id, (bigrams.get(id) || 0) + 1);
        }
    }

    let total = 0;
    for (let count of bigrams.values()) {
        assert(count > 0);
        total += count;
    }

    let entropy = 0;
    for (let count of bigrams.values()) {
        // normalize to a probability
        const probability = count/total;

        // compute the entropy term
        entropy -= probability * Math.log(probability);
    }

    return entropy;
}

async function existsSafe(path) {
    try {
        await pfs.access(path, fs.constants.F_OK);
        return true;
    } catch(e) {
        if (e.code === 'ENOENT')
            return false;
        if (e.code === 'ENOTDIR')
            return false;
        throw e;
    }
}

function readByLine(filename) {
    return readAllLines([fs.createReadStream(filename)]);
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('measure-training-set', {
        add_help: true,
        description: "Compute useful statistics about a training set."
    });
    parser.add_argument('datadir', {
        help: 'Training set directory to measure; must contain synthetic.txt, user/train.tsv'
    });
}

export async function execute(args) {
    let numDialogues = 0;
    let numTurns = 0;
    const syntheticTxt = path.resolve(args.datadir, 'synthetic.txt');
    if (await existsSafe(syntheticTxt)) {
        for await (const dlg of readByLine(syntheticTxt).pipe(new DialogueParser())) {
            numDialogues += 1;
            numTurns += dlg.length;
        }
    }
    console.error('Counted dialogues');

    let numSyntheticSentences = 0;

    for await (const _ of readByLine(path.resolve(args.datadir, 'user/synthetic.user.tsv')))
        numSyntheticSentences += 1;

    console.error('Counted synthetic sentences');

    const sentenceCorpus = [];
    const contextCorpus = [];
    const targetCorpus = [];
    let numTrainingSentences = 0;
    for await (const ex of readByLine(path.resolve(args.datadir, 'user/train.tsv')).pipe(new DatasetParser({ contextual: true }))) {
        sentenceCorpus.push(ex.preprocessed);
        contextCorpus.push(ex.context);
        targetCorpus.push(ex.target_code);
        numTrainingSentences += 1;
    }

    console.error('Loaded training set');

    const sentenceEntropy = measure(sentenceCorpus, 'sentence');
    const contextEntropy = measure(contextCorpus, 'context');
    const targetEntropy = measure(targetCorpus, 'target');
    const numContexts = (new Set(contextCorpus)).size;

    console.log([args.datadir, numDialogues, numSyntheticSentences, numTrainingSentences,
                 contextEntropy, sentenceEntropy, targetEntropy,
                 numTurns/numDialogues, numContexts].join('\t'));
}
