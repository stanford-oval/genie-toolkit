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
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>


import Stream from 'stream';

import { shuffle } from '../../utils/random';
import { MTurkParaphraseExample } from './validator';

function quickGetFunctions(code : string) : [string[], string[]] {
    const devices : string[] = [];
    const functions : string[] = [];

    const regex = /@([a-z0-9_.]+)([a-z0-9_]+)\(/g;

    let match = regex.exec(code);
    while (match !== null) {
        devices.push(match[1]);
        functions.push(match[2]);
        match = regex.exec(code);
    }
    return [devices, functions];
}

function subset<T>(array1 : T[], array2 : T[]) : boolean {
    for (const el of array1) {
        if (array2.indexOf(el) < 0)
            return false;
    }
    return true;
}

// generate a fake paraphrase with same device(s) but different functions
function fakeParaphrase(batch : MTurkParaphraseExample[], targetCode : string) : string {
    const [devices, functions] = quickGetFunctions(targetCode);

    for (const candidate of batch) {
        const [candDevices, candFunctions] = quickGetFunctions(candidate.target_code);

        if (subset(devices, candDevices) && !subset(functions, candFunctions))
            return candidate.paraphrase;
    }

    // return something
    return 'if reddit front page updated, get a #dog gif';
}

export interface MTurkValidationExample {
    synthetic_id : string;
    target_code : string;
    synthetic : string;
    paraphrases : Array<{
        id : string;
        paraphrase : string;
    }>;
}

interface ValidationHITCreatorOptions {
    debug : boolean;
    targetSize : number;
    sentencesPerTask : number;
    rng : () => number;
}

export default class ValidationHITCreator extends Stream.Transform {
    private _batch : MTurkParaphraseExample[];
    private _i : number;
    private _buffer : Record<string, string|number>;

    private _debug : boolean;
    private _targetSize : number;
    private _sentencesPerTask : number;
    private _rng : () => number;

    constructor(batch : MTurkParaphraseExample[],
                options : ValidationHITCreatorOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });

        this._batch = batch;

        this._i = 0;
        this._buffer = {};

        this._debug = options.debug;
        this._targetSize = options.targetSize;
        this._sentencesPerTask = options.sentencesPerTask;
        this._rng = options.rng;
    }

    _transform(row : MTurkValidationExample, encoding : BufferEncoding, callback : () => void) {
        if (row.paraphrases.length < this._targetSize) {
            if (this._debug)
                console.log(`Skipped synthetic sentence ${row.synthetic_id}: not enough paraphrases`);
            callback();
            return;
        }

        const i = ++this._i;
        this._buffer[`id${i}`] = row.synthetic_id;
        this._buffer[`thingtalk${i}`] = row.target_code;
        this._buffer[`sentence${i}`] = row.synthetic;

        const fakeSame = row.synthetic;
        const fakeDifferent = fakeParaphrase(this._batch, row.target_code);
        const paraphrases = [{
            id: '-same',
            paraphrase: fakeSame
        }, {
            id: '-different',
            paraphrase: fakeDifferent,
        }].concat(row.paraphrases);

        shuffle(paraphrases, this._rng);
        this._buffer[`index_same${i}`] = 1 + paraphrases.findIndex((el) => el.id === '-same');
        this._buffer[`index_diff${i}`] = 1 + paraphrases.findIndex((el) => el.id === '-different');

        for (let j = 0; j < paraphrases.length; j++) {
            const { id, paraphrase } = paraphrases[j];
            this._buffer[`id${i}-${j+1}`] = id;
            this._buffer[`paraphrase${i}-${j+1}`] = paraphrase;
        }

        if (i === this._sentencesPerTask) {
            this.push(this._buffer);
            this._i = 0;
            this._buffer = {};
        }
        callback();
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}
