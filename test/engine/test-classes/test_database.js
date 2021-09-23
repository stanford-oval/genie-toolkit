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
// Author: Silei Xu <silei@cs.stanford.edu>

import { Ast } from 'thingtalk';
import * as Tp from 'thingpedia';
import * as fs from 'fs';
import * as path from 'path';
import { modules as Builtins } from '../../../lib/engine/devices/builtins';

export default class TestDatabaseDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        this.isTransient = true;
        this.uniqueId = 'org.thingpedia.builtin.test.test_database';
    }

    query(query) {
        const table = query.statements[0].expression;
        if (table.expressions.length > 1)
            return [{ foo: ':-)', bar: '(-:' }];
        const first = table.first;
        if (first instanceof Ast.InvocationExpression)
            return [{ foo: ':-)' }];
        if (first instanceof Ast.AggregationExpression)
            return [{ count: 1 }];
        return [];
    }
}

const manifest = fs.readFileSync(path.resolve(path.dirname(module.filename), 'test_database.tt')).toString('utf8');
Builtins['org.thingpedia.builtin.test.test_database'] = {
    class: manifest,
    module: TestDatabaseDevice
};
