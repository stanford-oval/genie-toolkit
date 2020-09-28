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
"use strict";

import * as Tp from 'thingpedia';
import * as TT from 'thingtalk';
const PollingStream = Tp.Helpers.PollingStream;

function genFakeData(size, fill) {
    return String(Buffer.alloc(size, fill));
}

export default class TestDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);
        this.uniqueId = 'org.thingpedia.builtin.test';
        this.isTransient = true;

        this._sequenceNumber = 0;
    }

    get_next_sequence() {
        return [{ number: this._sequenceNumber ++ }];
    }

    get_get_data({ size, count }) {
        if (!(count >= 0))
            count = 1;
        console.log(`Generating ${size} bytes of fake data, ${count} times`);

        let ret = [];
        for (let i = 0; i < count; i++)
            ret.push({ data: genFakeData(size, '!'.charCodeAt(0) + i) });
        return ret;
    }
    subscribe_get_data(args, state) {
        let count = 0;
        return new PollingStream(state, 1000, () => {
            console.log(`Triggering ${args.size} bytes of data`);
            return [{ data: genFakeData(args.size, '!'.charCodeAt(0) + (count++)) }];
        });
    }
    get_dup_data({ data_in }) {
        return [{ data_out: data_in + data_in }];
    }
    do_eat_data(args) {
        console.log(`Ate data`, args.data);
    }
    do_ask(args, env) {
        return env.askQuestion(TT.Type.String, args.question);
    }
}
