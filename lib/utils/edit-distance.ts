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

import assert from 'assert';

export default function editDistance(one : string|string[], two : string|string[]) : number {
    if (typeof one === 'string' && typeof two === 'string') {
        if (one === two)
            return 0;
        if (one.indexOf(two) >= 0)
            return one.length-two.length;
        if (two.indexOf(one) >= 0)
            return two.length-one.length;
    }

    const R = one.length+1;
    const C = two.length+1;
    const matrix = new Array<number>(R*C);
    function set(i : number, j : number, v : number) {
        assert(i*C + j < R*C);
        matrix[i*C + j] = v;
    }
    function get(i : number, j : number) : number {
        assert(i*C + j < R*C);
        return matrix[i*C + j];
    }

    for (let j = 0; j < C; j++)
        set(0, j, j);
    for (let i = 1; i < R; i++)
        set(i, 0, i);
    for (let i = 1; i <= one.length; i++) {
        for (let j = 1; j <= two.length; j++) {
            if (one[i-1] === two[j-1])
                set(i, j, get(i-1, j-1));
            else
                set(i, j, 1 + Math.min(Math.min(get(i-1, j), get(i, j-1)), get(i-1, j-1)));
        }
    }

    return get(one.length, two.length);
}
