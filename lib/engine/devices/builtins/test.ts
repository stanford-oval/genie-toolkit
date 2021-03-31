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
const PollingStream = Tp.Helpers.PollingStream;

function genFakeData(size : number, fill : number) {
    return String(Buffer.alloc(size, fill));
}

interface TriggerStateBinder {
    get(k : 'last-poll') : number|undefined;
    get(k : string) : unknown|undefined;

    set(k : 'last-poll', v : number) : void;
    set(k : string, v : unknown) : void;
}

export default class TestDevice extends Tp.BaseDevice {
    private _sequenceNumber : number;

    constructor(engine : Tp.BaseEngine, state : { kind : string }) {
        super(engine, state);
        this.uniqueId = 'org.thingpedia.builtin.test';
        this.isTransient = true;

        this._sequenceNumber = 0;
    }

    async *get_next_sequence() {
        yield { number: this._sequenceNumber ++ };
    }

    async *get_get_data({ size, count } : { size : number, count : number }) {
        if (!(count >= 0))
            count = 1;
        console.log(`Generating ${size} bytes of fake data, ${count} times`);

        for (let i = 0; i < count; i++)
            yield { data: genFakeData(size, '!'.charCodeAt(0) + i) };
    }
    /**
     * @returns {stream.Readable}
     */
    subscribe_get_data(args : { size : number }, state : TriggerStateBinder) {
        let count = 0;
        return new PollingStream(state, 1000, () => {
            console.log(`Triggering ${args.size} bytes of data`);
            return [{ data: genFakeData(args.size, '!'.charCodeAt(0) + (count++)) }];
        });
    }

    async *get_get_data2({ size, count } : { size : number, count : number }) {
        if (!(count >= 0))
            count = 1;
        for (let i = 0; i < count; i++)
            yield ({ data: genFakeData(size, 'A'.charCodeAt(0) + i) });
    }

    async get_dup_data({ data_in } : { data_in : string }) {
        return [{ data_out: data_in + data_in }];
    }
    do_eat_data(args : { data : string }) {
        console.log(`Ate data`, args.data);
    }
}
