// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 National Taiwan University
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
// Author: Elvis Yu-Jing Lin <r06922068@ntu.edu.tw> <elvisyjlin@gmail.com>


import * as fs from 'fs';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
const Grammar = ThingTalk.Grammar;
const Library = ThingTalk.Ast.Input.Library;

import ProgressBar from './progress_bar';
import { tokenizeExample } from '../../lib/utils/misc-utils';
import * as I18n from '../../lib/i18n';

export default class ThingTalkDataset {
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
        const tpClient = new Tp.FileClient({ locale, thingpedia, dataset });
        const parsed = await this._loadDataset(tpClient);

        if (this._options.debug)
            console.log('Loaded ' + parsed.examples.length + ' templates');
        this._locale = locale;
        this._dataset = parsed;
    }

    write(outputFile, callback) {
        const output = new Library(null, [], [
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
            this._tokenizer = I18n.get(this._locale).getTokenizer();
        const language = this._dataset.language;
        const bar = new ProgressBar(this._dataset.examples.length);
        for (let index in this._dataset.examples) {
            try {
                this._dataset.examples[index].preprocessed = await this.preprocessAll(
                    this._dataset.examples[index].utterances, this._dataset.examples[index].id, language
                );
            } catch(e) {
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
}
