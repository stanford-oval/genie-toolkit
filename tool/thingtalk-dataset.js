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
// const Dataset = ThingTalk.Ast.Statement.Dataset;
const ProgressBar = require('./lib/progress_bar');
const FileThingpediaClient = require('./lib/file_thingpedia_client');
const TokenizerService = require('../lib/tokenizer');
const { tokenizeExample } = require('../lib/almond-cloud');


class ThingTalkDataset {
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
        }
    }
    
    async read(locale, thingpedia, datasetFile) {
        const tpClient = new FileThingpediaClient(locale, thingpedia, datasetFile);
        const dataset = await this._loadDataset(tpClient);
        
        if (this._options.debug) {
            console.log('Loaded ' + dataset.examples.length + ' templates');
        }
        this._locale = locale;
        this._dataset = dataset;
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
            throw 'keepKeys and dropKeys cannnot be set at the same time.'
        this._dataset.examples.forEach((example, index) => {
            let dropKeys = options.dropKeys;
            if (options.keepKeys) {
                dropKeys = Object.keys(example).filter(key => !options.keepKeys.includes(key));
            }
            if (dropKeys)
                dropKeys.forEach(key => this._dataset.examples[index][key] = this._defaults[key]);
            bar.add(1);
        });
    }
    
    async preprocess() {
        if (this._tokenizer == null)
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
        if (this._tokenizer == null)
            throw 'Tokenizer is not initialized.';
        const promises = utterances.map(async utterance => {
            let preprocessed = await tokenizeExample(this._tokenizer, utterance, id, language);
            return preprocessed;
        });
        return Promise.all(promises);
    }
}

class ThingTalkDatasetPreprocessor {
    constructor(options) {
        this.locale = options.locale;
        this.options = options;
        
        this._language = '';
        this._tokenizer = TokenizerService.get(process.env.GENIE_USE_TOKENIZER, true);
        this._num_examples = 0;
        this._bar = null;
        this._i = 0;
        
        if (this.locale.toLowerCase() == 'zh-tw') {
            this._opencc_t2s = new OpenCC('t2s.json');
            this._opencc_s2t = new OpenCC('s2t.json');
        }
    }

    async _transform(ex, encoding, callback) {
        if (ex.type == 'meta') {
            this._language = ex.data.language;
            this._bar = new ProgressBar('[ :bar ] :current/:total', { total: ex.data.num_examples });
        } else if (ex.type == 'example') {
            try {
                ex.data.preprocessed = await this.preprocessAll(ex.data.utterances, ex.data.id);
            } catch (e) {
                console.log(ex.data.id);
                console.log(ex.data.utterances);
                console.log(ex.data.preprocessed);
                throw e;
            }
            this._i += 1;
            this._bar.tick({ current: this._i });
        }
        callback(null, ex);
    }
    
    async preprocessAll(utterances, id) {
        const promises = utterances.map(async utterance => {
            if (this.locale.toLowerCase() == 'zh-tw')
                utterance = this._opencc_t2s.convert(utterance)
            let preprocessed = await tokenizeExample(this._tokenizer, utterance, id, this._language);
            if (this.locale.toLowerCase() == 'zh-tw')
                preprocessed = this._opencc_s2t.convert(preprocessed)
            return preprocessed;
        });
        return Promise.all(promises);
    }

    _flush(callback) {
        this._tokenizer.end();
        process.nextTick(callback);
    }
}


module.exports = {
    ThingTalkDataset
};