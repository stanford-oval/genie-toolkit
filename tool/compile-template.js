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
//          Mehrad Moradshahi <mehrad@cs.stanford.edu>


import { compile } from '../lib/sentence-generator/compiler';

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('compile-template', {
        add_help: true,
        description: "Compile templates into TypeScript code, ready to be compiled into JS."
    });
    parser.add_argument('input_file', {
        help: "The entrypoint to compile."
    });
}

export async function execute(args) {
    try {
        await compile(args.input_file);
    } catch(e) {
        if (e.name !== 'SyntaxError')
            throw e;

        console.error(`Syntax error in ${e.fileName} at line ${e.location.start.line}: ${e.message}`);
        process.exit(1);
    }
}
