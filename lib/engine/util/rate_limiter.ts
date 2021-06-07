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


import LinkedList from './linked_list';

export default class RateLimiter {
    private _queue : LinkedList<number>;
    private _burst : number;
    private _interval : number;

    constructor(burst : number, interval : number) {
        this._queue = new LinkedList();
        this._burst = burst;
        this._interval = interval;
    }

    hit() {
        const now = Date.now();

        while (this._queue.size >= this._burst) {
            const oldest = this._queue.peek()!;
            if (now - oldest > this._interval)
                this._queue.pop();
            else
                return false;
        }
        this._queue.unshift(now);
        return true;
    }
}
