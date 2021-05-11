// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
//         Sina Semnani <sinaj@cs.stanford.edu>

import * as random from '../../lib/utils/random';
import seedrandom from 'seedrandom';
import * as util from 'util';
import { Ast } from 'thingtalk';

// parameter names with the same type. These parameters can safely be replaced with each other
// const valid_name_changes = {
//     'area': [],
// };

// const valid_values = {
//     'area': ['north', 'south', 'east', 'west']
// }

function changeArgumentName(expression : Ast.AtomBooleanExpression, schema : Ast.FunctionDef, rng : () => number) {
    const currentName = expression.name;
    const possibleNewNames = schema.args.filter((value) => value !== currentName); // returns a new array
    console.log('currentName = ', currentName);
    console.log('possibleNewNames = ', possibleNewNames);
    const newName = random.uniform(possibleNewNames, rng);
    expression.name = newName;
}

function changeArgumentValue(expression : Ast.AtomBooleanExpression, schema : Ast.FunctionDef, rng : () => number) {
    const currentValue = expression.value;
    // const possibleNewValues = schema.args.filter((value) => value !== currentValue); // returns a new array
    console.log('currentValue = ', currentValue);
    for (const a of schema.iterateArguments())
        console.log('iterateArguments = ', a);
    // console.log('possibleNewValues = ', possibleNewValues);
    // const newName = random.uniform(possibleNewNames, rng);
    // expression.name = newName;
}

function recursiveErrorFunction(node : Ast.Node, schema : Ast.FunctionDef, rng : () => number) {
    console.log('recursiveErrorFunction() called with node "', node.prettyprint(), '": ', util.inspect(node, false, 1, true));
    if (node instanceof Ast.AtomBooleanExpression) {
        if (random.coin(0.5, rng))
            changeArgumentValue(node, schema, rng);
        else
            changeArgumentName(node, schema, rng);
    }
    else if (node instanceof Ast.FilterExpression) {
        recursiveErrorFunction(node.expression, schema, rng);
        recursiveErrorFunction(node.filter, schema, rng);
    }
    else if (node instanceof Ast.InvocationExpression) {
        recursiveErrorFunction(node.invocation, schema, rng);
    }
    else if (node instanceof Ast.Invocation) {
        for (let i = 0 ; i < node.in_params.length ; i ++)
        recursiveErrorFunction(node.in_params[i], schema, rng);
    }
    else if (node instanceof Ast.AndBooleanExpression) {
        for (let i = 0; i < node.operands.length; i++)
            recursiveErrorFunction(node.operands[i], schema, rng);
        // recursiveErrorFunction(node.expression, schema, rng);
    }
}

export function introduceErrorsToUserTarget(userTarget : Ast.DialogueState) : Ast.DialogueState {
    const rng = seedrandom.alea('almond is awesome');
    const expressions = userTarget.history[userTarget.history.length-1].stmt.expression.expressions;
    console.log(util.inspect(expressions, false, 2, true));
    for (let i=0 ; i < expressions.length ; i++) {
        const expression = expressions[i];
        const schema = expression.schema;
        // console.log('FilterExpression detected:');
        // console.log('Schema = ', util.inspect(schema!.args, false, 2, true));
        console.log('expression before = ', expression.prettyprint());
        recursiveErrorFunction(expression, schema!, rng);
        console.log('expression after = ', expression.prettyprint());
        console.log('----------');

    }
    return userTarget.clone();
}