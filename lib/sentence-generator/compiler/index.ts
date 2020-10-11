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

import { promises as pfs } from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import * as metagrammar from './grammar';
import * as metaast from './meta_ast';

import type * as SentenceGeneratorRuntime from '../runtime';
import type * as I18n from '../../i18n';
import type SentenceGenerator from '../generator';

const COMPILER_OPTIONS : ts.CompilerOptions = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2018,
    allowJs: true,
    esModuleInterop: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    resolveJsonModule: true,
    noUnusedLocals: false,
    strict: false,
};

async function processFilename(filename : string,
                               target : 'js' | 'ts') : Promise<void> {
    let input = await pfs.readFile(filename, { encoding: 'utf8' });

    let parsed;
    try {
        parsed = metagrammar.parse(input) as metaast.Grammar;
    } catch(e) {
        e.fileName = filename;
        console.error(e);
        process.exit(1);
    }

    input = parsed.codegen();

    if (target === 'js') {
        const result = ts.transpileModule(input, {
            compilerOptions: COMPILER_OPTIONS,
            fileName: filename,
            reportDiagnostics: true,
        });
        if (result.diagnostics && result.diagnostics.length > 0) {
            let error = '';
            result.diagnostics.forEach((diagnostic) => {
                if (diagnostic.file) {
                    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
                    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
                    error += `${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}\n`;
                } else {
                    error += ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n') + '\n';
                }
            });
            throw new Error(`TypeScript compilation failed: ${error}`);
        }
    }

    const output = filename + '.' + target;
    await pfs.writeFile(output, input);
}


export function compile(filename : string) : Promise<void> {
    return processFilename(filename, 'ts');
}

interface GrammarOptions {
    flags : { [flag : string] : boolean };
}

type CompiledTemplate = (runtime : typeof SentenceGeneratorRuntime,
                         options : GrammarOptions,
                         langPack : I18n.LanguagePack,
                         grammar : SentenceGenerator<any, any>) => Promise<void>;

export async function importGenie(filename : string,
                                  searchPath = '.') : Promise<CompiledTemplate> {
    filename = path.resolve(searchPath, filename);

    // try loading compiled js first
    let target : 'js'|'ts' = 'js';
    try {
        return (await import(filename + '.' + target)).default;
    } catch(e) {
        if (e.code !== 'MODULE_NOT_FOUND')
            throw e;
    }

    // if that did not work, try compiling the template on-demand
    // we compile to .ts if we're running in ts-node or nyc with the
    // typescript extensions
    // and compile to js ourselves otherwise
    // (in the latter case, type errors won't be reported across modules)

    target = require.extensions['.ts'] ? 'ts' : 'js';
    try {
        await pfs.access(filename + '.' + target);
    } catch(e) {
        if (e.code !== 'ENOENT')
            throw e;
        await processFilename(filename, target);
    }

    return (await import(filename + '.' + target)).default;
}
