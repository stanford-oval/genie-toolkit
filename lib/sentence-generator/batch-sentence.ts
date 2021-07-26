// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import assert from 'assert';
import stream from 'stream';

import * as I18n from '../i18n';
import * as Utils from '../utils/entity-utils';
import * as ThingTalkUtils from '../utils/thingtalk';

import SentenceGenerator from './generator';
import { Derivation } from './runtime';


interface BasicGeneratorOptions {
    targetPruningSize : number;
    maxDepth : number;
    maxConstants ?: number;
    idPrefix ?: string;
    locale : string;
    timezone : string|undefined;
    templateFiles : string[];
    flags : { [key : string] : boolean };
    debug : number;
    rng : () => number;

    // options passed to the templates
    thingpediaClient : Tp.BaseClient;
    schemaRetriever : ThingTalk.SchemaRetriever;
    onlyDevices ?: string[];
    whiteList ?: string;
}

/**
 * Generate a dataset of single-sentence commands and their associated logical forms.
 */
export default class BasicSentenceGenerator extends stream.Readable {
    private _idPrefix : string;
    private _locale : string;
    private _langPack : I18n.LanguagePack;
    private _rng : () => number;
    private _generator : SentenceGenerator;
    private _initialization : Promise<void>|null;
    private _i : number;

    constructor(options : BasicGeneratorOptions) {
        super({ objectMode: true });
        this._idPrefix = options.idPrefix || '';
        this._locale = options.locale;
        this._langPack = I18n.get(options.locale);
        this._rng = options.rng;
        this._generator = new SentenceGenerator({
            locale: options.locale,
            timezone: options.timezone,
            templateFiles: options.templateFiles,
            forSide: 'user',
            contextual: false,
            flags: options.flags,
            targetPruningSize: options.targetPruningSize,
            maxDepth: options.maxDepth,
            maxConstants: options.maxConstants || 5,
            debug: options.debug,
            rng: options.rng,

            thingpediaClient: options.thingpediaClient,
            schemaRetriever: options.schemaRetriever,
            entityAllocator: new ThingTalk.Syntax.SequentialEntityAllocator({}),
            onlyDevices: options.onlyDevices,
            whiteList: options.whiteList
        });
        this._generator.on('progress', (value : number) => {
            this.emit('progress', value);
        });

        this._initialization = null;
        this._i = 0;
    }

    _read() : void {
        if (this._initialization === null)
            this._initialization = this._generator.initialize();

        this._initialization!.then(() => {
            for (const derivation of this._generator.generate([], '$root'))
                this._output(derivation);
            this.emit('progress', this._generator.progress);
            this.push(null);
        }).catch((e) => {
            console.error(e);
            this.emit('error', e);
        });
    }

    private _postprocessSentence(derivation : Derivation<ThingTalk.Ast.Input>, program : ThingTalk.Ast.Input) {
        let utterance = derivation.sampleSentence(this._rng);
        utterance = utterance.replace(/ +/g, ' ');
        utterance = this._langPack.postprocessSynthetic(utterance, program, this._rng, 'user');
        return utterance;
    }

    private _output(derivation : Derivation<ThingTalk.Ast.Input>) {
        const program = derivation.value.optimize();
        assert(program !== null); // not-null even after optimize
        let preprocessed = this._postprocessSentence(derivation, program);
        const tokens = preprocessed.split(' ');
        const entities = Utils.makeDummyEntities(preprocessed);
        const tokenized = { tokens, entities };
        const contextEntities = {};
        Utils.renumberEntities(tokenized, contextEntities);
        preprocessed = tokenized.tokens.join(' ');

        let sequence;
        try {
            sequence = ThingTalkUtils.serializePrediction(program, [], tokenized.entities, {
                locale: this._locale
            });
        } catch(e) {
            console.error(preprocessed);
            console.error(program.prettyprint().trim());
            console.error(sequence);

            this.emit('error', e);
            return;
        }
        let id = String(this._i++);
        id = this._idPrefix + derivation.depth + '000000000'.substring(0,9-id.length) + id;
        const flags = {
            synthetic: true
        };
        this.push({ id, flags, preprocessed, target_code: sequence.join(' ') });
    }
}

