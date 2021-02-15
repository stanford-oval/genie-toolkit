// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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

import { EvaluationResult } from '../../lib/dataset-tools/evaluation/sentence_evaluator';

function csvDisplay(args : any,
                    complexity : number|string|null,
                    result : Record<string, EvaluationResult>,
                    device : string,
                    with_numeric = false,
                    without_numeric = false) {
    let buffer = '';
    if (args.csv_prefix)
        buffer = args.csv_prefix + ',';

    if (args.split_by_device)
        buffer += device + ',';

    let prefix = '';
    if (with_numeric) {
        prefix = `with_numeric_`;
        if (!result[`${prefix}total`])
            return;

        buffer += `with_numeric,` + String(result[`${prefix}total`]);
    } else if (without_numeric) {
        prefix = `without_numeric_`;
        if (!result[`${prefix}total`])
            return;

        buffer += `without_numeric,` + String(result[`${prefix}total`]);
    } else if (complexity === null) {
        buffer += 'all,';
        buffer += String(result.total);
    } else {
        prefix = `complexity_${complexity}/`;
        if (!result[`${prefix}total`])
            return;

        buffer += String(complexity) + ',' + String(result[`${prefix}total`]);
    }
    for (const key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax']) {
        const fullkey = `${prefix}${key}`;
        result[fullkey].length = parseInt(process.env.CSV_LENGTH || '1');
        buffer += ',';
        buffer += String(result[fullkey]);
    }

    args.output.write(buffer + '\n');
}

export function outputResult(args : any, result : Record<string, EvaluationResult>) {
    const devices = Object.keys(result);
    devices.sort((d1, d2) => {
        // sort 'generic' first, then alphabetical
        // sadly, 'g' > '@'
        if (d1 === d2)
            return 0;
        if (d1 === 'generic')
            return -1;
        if (d2 === 'generic')
            return 1;
        if (d1 < d2)
            return -1;
        else
            return 1;
    });

    for (const device of devices) {
        if (args.csv) {
            csvDisplay(args, null, result[device], device);
            if (args.min_complexity > 0)
                csvDisplay(args, '<=' + args.min_complexity, result[device], device);
            else
                csvDisplay(args, 0, result[device], device);
            if (args.max_complexity) {
                for (let complexity = args.min_complexity + 1; complexity < args.max_complexity; complexity++)
                    csvDisplay(args, complexity, result[device], device);
                csvDisplay(args, '>=' + args.max_complexity, result[device], device);
            } else {
                for (let complexity = args.min_complexity + 1; complexity < 10; complexity++)
                    csvDisplay(args, complexity, result[device], device);
            }
            csvDisplay(args, null, result, device, true);
            csvDisplay(args, null, result, device, false, true);
        } else {
            for (const key in result[device]) {
                if (Array.isArray(result[device][key]))
                    args.output.write(`${device + ', ' + key} = [${result[device][key].join(', ')}]\n`);
                else
                    args.output.write(`${device + ', ' + key} = ${result[device][key]}\n`);
            }
        }
    }
    args.output.end();
}
