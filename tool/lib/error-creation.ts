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
import { NumberValue } from 'thingtalk/dist/ast';

// parameter names with the same type. These parameters can safely be replaced with each other
// const valid_name_changes = {
//     'area': [],
// };

const valid_values : { [name : string] : Ast.Value[] } = {
    // All Enums
    'uk.ac.cam.multiwoz.Hotel.area' : [new Ast.EnumValue('north'), new Ast.EnumValue('south'), new Ast.EnumValue('east'), new Ast.EnumValue('west'), new Ast.EnumValue('center')],
    'uk.ac.cam.multiwoz.Hotel.price_range' : [new Ast.EnumValue('cheap'), new Ast.EnumValue('moderate'), new Ast.EnumValue('expensive')],
    'uk.ac.cam.multiwoz.Hotel.type' : [new Ast.EnumValue('hotel'), new Ast.EnumValue('guest_house')],
    'uk.ac.cam.multiwoz.Hotel.book_day' : [new Ast.EnumValue('monday'), new Ast.EnumValue('tuesday'), new Ast.EnumValue('wednesday'), new Ast.EnumValue('thursday'), new Ast.EnumValue('friday'), new Ast.EnumValue('saturday'), new Ast.EnumValue('sunday')],
    'uk.ac.cam.multiwoz.Attraction.area' : [new Ast.EnumValue('north'), new Ast.EnumValue('south'), new Ast.EnumValue('east'), new Ast.EnumValue('west'), new Ast.EnumValue('center')],
    'uk.ac.cam.multiwoz.Attraction.price_range' : [new Ast.EnumValue('free'), new Ast.EnumValue('cheap'), new Ast.EnumValue('moderate'), new Ast.EnumValue('expensive')],
    'uk.ac.cam.multiwoz.Restaurant.area' : [new Ast.EnumValue('north'), new Ast.EnumValue('south'), new Ast.EnumValue('east'), new Ast.EnumValue('west'), new Ast.EnumValue('center')],
    'uk.ac.cam.multiwoz.Restaurant.price_range' : [new Ast.EnumValue('cheap'), new Ast.EnumValue('moderate'), new Ast.EnumValue('expensive')],
    'uk.ac.cam.multiwoz.Restaurant.book_day' : [new Ast.EnumValue('monday'), new Ast.EnumValue('tuesday'), new Ast.EnumValue('wednesday'), new Ast.EnumValue('thursday'), new Ast.EnumValue('friday'), new Ast.EnumValue('saturday'), new Ast.EnumValue('sunday')],
    'uk.ac.cam.multiwoz.Train.day' : [new Ast.EnumValue('monday'), new Ast.EnumValue('tuesday'), new Ast.EnumValue('wednesday'), new Ast.EnumValue('thursday'), new Ast.EnumValue('friday'), new Ast.EnumValue('saturday'), new Ast.EnumValue('sunday')],
};

// function changeArgumentName(expression : Ast.AtomBooleanExpression, schema : Ast.FunctionDef, rng : () => number) {
//     const currentName = expression.name;
//     const possibleNewNames = schema.args.filter((value) => value !== currentName); // returns a new array
//     console.log('currentName = ', currentName);
//     console.log('possibleNewNames = ', possibleNewNames);
//     const newName = random.uniform(possibleNewNames, rng);
//     expression.name = newName;
// }

// class ErrorAndFeedback {
//     erroneousUserTarget :Ast.DialogueState;
//     userFeedback: string;

//     constructor(erroneousUserTarget: Ast.DialogueState, userFeedback: string) {
//         this.erroneousUserTarget = erroneousUserTarget;
//         this.userFeedback = userFeedback;
//     }
// }

function changeArgumentValue(expression : Ast.AtomBooleanExpression|Ast.InputParam, schema : Ast.FunctionDef, rng : () => number, allFeedbacks : string[]){
    console.log('changeArgumentValue called with expression ', expression);
    // console.log(schema);
    // console.log(schema.class!.name);
    const currentValue = expression.value;
    let possibleNewValues = valid_values[schema.class!.name+'.'+expression.name]; // prepend class name to make parameter names unique
    if (!possibleNewValues){
        if (currentValue.isNumber){
            // off by one error
            possibleNewValues = [new NumberValue((<Ast.NumberValue> currentValue).value + 1), new NumberValue(Math.max((<Ast.NumberValue> currentValue).value - 1, 1))];
        }
        else {
            return;
        }
    }
    
    possibleNewValues = possibleNewValues.filter((value) => !value.equals(currentValue));
    console.log('currentValue = ', currentValue);
   
    console.log('possibleNewValues = ', possibleNewValues);
    const newValue = random.uniform(possibleNewValues, rng);
    expression.value = newValue.clone();
    console.log('expression after changed argument value: ', expression);
    allFeedbacks.push(expression.name + ' should not be ' + newValue.prettyprint());
}

function recursiveErrorFunction(node : Ast.Node, schema : Ast.FunctionDef, rng : () => number, allFeedbacks : string[]) {
    console.log('recursiveErrorFunction() called with node "', node.prettyprint(), '": ', util.inspect(node, false, 1, true));
    if (node instanceof Ast.AtomBooleanExpression || node instanceof Ast.InputParam) {
        // if (random.coin(0.5, rng))
        changeArgumentValue(node, schema, rng, allFeedbacks);
        // else
        //     changeArgumentName(node, schema, rng);
    }
    else if (node instanceof Ast.FilterExpression) {
        recursiveErrorFunction(node.expression, schema, rng, allFeedbacks);
        recursiveErrorFunction(node.filter, schema, rng, allFeedbacks);
    }
    else if (node instanceof Ast.InvocationExpression) {
        recursiveErrorFunction(node.invocation, schema, rng, allFeedbacks);
    }
    else if (node instanceof Ast.Invocation) {
        for (let i = 0 ; i < node.in_params.length ; i ++)
            recursiveErrorFunction(node.in_params[i], schema, rng, allFeedbacks);
    }
    else if (node instanceof Ast.AndBooleanExpression) {
        for (let i = 0; i < node.operands.length; i++)
            recursiveErrorFunction(node.operands[i], schema, rng, allFeedbacks);
        // recursiveErrorFunction(node.expression, schema, rng, allFeedbacks);
    }

}

export function introduceErrorsToUserTarget(userTarget : Ast.DialogueState) : [Ast.DialogueState, string] {
    const rng = seedrandom.alea('almond is awesome');
    const expressions = userTarget.history[userTarget.history.length-1].stmt.expression.expressions;
    console.log(util.inspect(expressions, false, 2, true));
    const allFeedbacks : string[] = [];
    for (let i=0 ; i < expressions.length ; i++) {
        const expression = expressions[i];
        const schema = expression.schema;
        // console.log('FilterExpression detected:');
        // console.log('Schema = ', util.inspect(schema!.args, false, 2, true));
        console.log('expression before = ', expression.prettyprint());
        recursiveErrorFunction(expression, schema!, rng, allFeedbacks);
        console.log('expression after = ', expression.prettyprint());
        console.log('----------');

    }
    return [userTarget.clone(), allFeedbacks.join('. ')];
}