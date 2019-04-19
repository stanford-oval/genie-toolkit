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

const stream = require('stream');
const ProgressBar = require('progress');

const ThingTalk = require('thingtalk');
const Grammar = ThingTalk.Grammar;
const Library = ThingTalk.Ast.Input.Library;
const Dataset = ThingTalk.Ast.Statement.Dataset;
const TokenizerService = require('../lib/tokenizer');
const OpenCC = require('opencc');


class ThingTalkDatasetCleaner extends stream.Transform {
    constructor(options) {
        super({ objectMode: true });
        
        if (options.keepKeys && options.dropKeys)
            throw 'keepKeys and dropKeys cannnot be set at the same time.'
        this.keepKeys = options.keepKeys;
        this.dropKeys = options.dropKeys;
        this.options = options;
        
        this._defaults = {
            'id': -1,
            'type': '',
            'annotations': {},
            'utterances': [],
            'preprocessed': []
        }
    }

    _transform(ex, encoding, callback) {
        if (ex.type == 'example') {
            let dropKeys = this.dropKeys;
            if(this.keepKeys) {
                dropKeys = Object.keys(ex.data).filter(key => !this.keepKeys.includes(key));
            }
            if (dropKeys)
                dropKeys.forEach(key => ex.data[key] = this._defaults[key]);
        }
        callback(null, ex);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

class ThingTalkDatasetPreprocessor extends stream.Transform {
    constructor(options) {
        super({ objectMode: true });
        
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
        const promises = await utterances.map(async utterance => {
            if (this.locale.toLowerCase() == 'zh-tw')
                utterance = this._opencc_t2s.convertSync(utterance)
            let preprocessed = await tokenizeExample(this._tokenizer, utterance, id, this._language);
            if (this.locale.toLowerCase() == 'zh-tw')
                preprocessed = this._opencc_s2t.convertSync(preprocessed)
            return preprocessed;
        });
        const preprocessedAll = await Promise.all(promises);
        return preprocessedAll;
    }

    _flush(callback) {
        this._tokenizer.end();
        process.nextTick(callback);
    }
}

class ThingTalkDatasetReader extends stream.Readable {
    constructor(options) {
        super({ objectMode: true });
        this._tpClient = options.thingpediaClient;
        
        this._options = options;
        
        this._initialization = null;
        this._dataset = null;
        this._i = null;
    }
    
    _read() {
        if (this._initialization === null)
            this._initialization = this._initialize();

        this._initialization.then(() => this._output()).catch((e) => {
            console.error(e);
            this.emit('error', e);
        });
    }
    
    _output() {
        if (this._i == this._dataset.examples.length) {  // done
            this.push(null);
            return;
        } else if (this._i == -1) {
            this.push({
                type: 'meta',
                data: {
                    name: this._dataset.name,
                    language: this._dataset.language,
                    annotations: this._dataset.annotations,
                    num_examples: this._dataset.examples.length
                }
            });
        } else {
            this.push({
                type: 'example',
                data: this._dataset.examples[this._i]
            });
        }
        this._i++;
    }
    
    async _initialize() {
        this._dataset = await this._loadDataset();
        this._i = -1;
        
        if (this._options.debug) {
            console.log('Loaded ' + this._dataset.examples.length + ' templates');
        }
    }
    
    async _loadDataset() {
        const code = await this._tpClient.getAllExamples();
        const parsed = await Grammar.parse(code);
        return parsed.datasets[0];
    }
}

class ThingTalkDatasetWriter extends stream.Writable {
    constructor(options) {
        super({ objectMode: true });
        
        this.outputStream = options.outputStream;
        this.options = options;
        
        this._meta = null;
        this._examples = [];
    }
    
    _write(buf, enc, next) {
        if (buf.type == 'meta') {
            if(this._meta)
                throw 'Meta data has be set.';
            this._meta = buf.data;
        } else if(buf.type == 'example') {
            this._examples.push(buf.data);
        } else {
            throw `Unsupported buffer type: ${buf.type}`;
        }
        process.nextTick(next);
    }
    
    _final(callback) {
        const output = new Library([], [
            new Dataset(
                this._meta.name,
                this._meta.language,
                this._examples,
                this._meta.annotations
            )
        ]);
        this.outputStream.write(output.prettyprint());
        
        this._meta = null;
        this._examples = [];
    }
}

module.exports = {
    ThingTalkDatasetCleaner,
    ThingTalkDatasetPreprocessor,
    ThingTalkDatasetReader,
    ThingTalkDatasetWriter
};

/* The following part is modified from Almond-Cloud
 * https://github.com/stanford-oval/almond-cloud/blob/master/util/tokenize.js
 * https://github.com/stanford-oval/almond-cloud/blob/master/util/validation.js
 */
const PARAM_REGEX = /\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})/;

function* split(pattern, regexp) {
    // a split that preserves capturing parenthesis

    let clone = new RegExp(regexp, 'g');
    let match = clone.exec(pattern);

    let i = 0;
    while (match !== null) {
        if (match.index > i)
            yield pattern.substring(i, match.index);
        yield match;
        i = clone.lastIndex;
        match = clone.exec(pattern);
    }
    if (i < pattern.length)
        yield pattern.substring(i, pattern.length);
}

function splitParams(utterance) {
    return Array.from(split(utterance, PARAM_REGEX));
}

async function tokenizeExample(tokenizer, utterance, id, language) {
    let replaced = '';
    let params = [];

    for (let chunk of splitParams(utterance.trim())) {
        if (chunk === '')
            continue;
        if (typeof chunk === 'string') {
            replaced += chunk;
            continue;
        }

        let [match, param1, param2, opt] = chunk;
        if (match === '$$') {
            replaced += '$';
            continue;
        }
        let param = param1 || param2;
        replaced += ' ____ ';
        params.push([param, opt]);
    }

    let tokens = [], entities = [];
    try {
        const tokenized = await tokenizer.tokenize(language, replaced);
        tokens = tokenized.tokens;
        entities = tokenized.entities;
    } catch (e) {
        console.log(utterance);
        console.log(replaced);
        console.log(language);
        throw e;
    }
    
    if (Object.keys(entities).length > 0) {
        console.log(utterance);
        console.log(replaced);
        console.log(entities);
        throw new Error(`Error in Example ${id}: Cannot have entities in the utterance`);
    }

    let preprocessed = '';
    let first = true;
    for (let token of tokens) {
        if (token === '____') {
            let [param, opt] = params.shift();
            if (opt)
                token = '${' + param + ':' + opt + '}';
            else
                token = '${' + param + '}';
        } else if (token === '$') {
            token = '$$';
        }
        if (!first)
            preprocessed += ' ';
        preprocessed += token;
        first = false;
    }

    return preprocessed;
}