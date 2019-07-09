// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// A tool to manipulate ThingTalk datasets
//
// Copyright 2019 National Taiwan University
//
// Author: Elvis Yu-Jing Lin <r06922068@ntu.edu.tw> <elvisyjlin@gmail.com>
//
// See COPYING for details
"use strict";

const fs = require('fs');

const ThingTalk = require('thingtalk');
const Grammar = ThingTalk.Grammar;
const Library = ThingTalk.Ast.Input.Library;
const ProgressBar = require('./progress_bar');
const FileThingpediaClient = require('./file_thingpedia_client');
const TokenizerService = require('../../lib/tokenizer');
const { tokenizeExample } = require('../../lib/utils');

module.exports = class ThingTalkDataset {
    constructor(options) {
        this._options = options;
        this._locale = null;
        this._dataset = null;
        this._tokenizer = null;

        this._defaults = {
            'id': -1,
            'type': '',
            'annotations': {},
            'utterances': [],
            'preprocessed': []
        };
    }

    async read(locale, thingpedia, dataset) {
        const tpClient = new FileThingpediaClient({ locale, thingpedia, dataset });
        const parsed = await this._loadDataset(tpClient);

        if (this._options.debug)
            console.log('Loaded ' + parsed.examples.length + ' templates');
        this._locale = locale;
        this._dataset = parsed;
    }

    write(outputFile, callback) {
        const output = new Library([], [
            this._dataset
        ]);
        const writerStream = fs.createWriteStream(outputFile);
        writerStream.on('finish', () => callback());
        writerStream.write(output.prettyprint());
        writerStream.end();
    }

    clean(options) {
        const bar = new ProgressBar(this._dataset.examples.length);
        if (options.keepKeys && options.dropKeys)
            throw new Error('keepKeys and dropKeys cannnot be set at the same time.');
        this._dataset.examples.forEach((example, index) => {
            let dropKeys = options.dropKeys;
            if (options.keepKeys)
                dropKeys = Object.keys(example).filter((key) => !options.keepKeys.includes(key));
            if (dropKeys)
                dropKeys.forEach((key) => this._dataset.examples[index][key] = this._defaults[key]);
            bar.add(1);
        });
    }

    async preprocess() {
        if (this._tokenizer === null)
            this._tokenizer = TokenizerService.get(process.env.GENIE_USE_TOKENIZER, true);
        const language = this._dataset.language;
        const bar = new ProgressBar(this._dataset.examples.length);
        for (let index in this._dataset.examples) {
            try {
                this._dataset.examples[index].preprocessed = await this.preprocessAll(
                    this._dataset.examples[index].utterances, this._dataset.examples[index].id, language
                );
            } catch (e) {
                console.log(this._dataset.examples[index].id);
                console.log(this._dataset.examples[index].utterances);
                console.log(this._dataset.examples[index].preprocessed);
                throw e;
            }
            bar.add(1);
        }
    }

    async _loadDataset(tpClient) {
        const code = await tpClient.getAllExamples();
        const parsed = await Grammar.parse(code);
        return parsed.datasets[0];
    }

    async preprocessAll(utterances, id, language) {
        if (this._tokenizer === null)
            throw new Error('Tokenizer is not initialized.');
        const promises = utterances.map(async (utterance) => {
            let preprocessed = await tokenizeExample(this._tokenizer, utterance, id, language);
            return preprocessed;
        });
        return Promise.all(promises);
    }
};
