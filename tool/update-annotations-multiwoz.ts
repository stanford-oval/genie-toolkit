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

import * as argparse from 'argparse';
import * as fs from 'fs';
import { Ast, Syntax } from 'thingtalk';

import { DialogueSerializer, DialogueParser } from '../lib/dataset-tools/parsers';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('update-annotations', {});
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('-in', '--input', {
        required: true,
        help: 'Input dialog file'
    });
}

export async function execute(args: any) {
    const out = new DialogueSerializer({annotations: true});
    out.pipe(fs.createWriteStream(args.output));

    for await (const dlg of fs.createReadStream('in.txt', { encoding: 'utf8'}).pipe(new DialogueParser())) {
        for (const turn of dlg) {
            const parsed = Syntax.parse(turn.user_target, Syntax.SyntaxType.Legacy);
            parsed.visit(new class extends Ast.NodeVisitor {
                visitLocationValue(node: Ast.LocationValue) : boolean {
                    
                    return true;
                }
            });
        }
    }
    
}