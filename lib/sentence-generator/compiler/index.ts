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

export class Compiler {
    private _target : 'js' | 'ts';

    private _files = new Map<string, metaast.Grammar>();

    // map a non-terminal to its type declaration, if any
    private _typeMap = new Map<string, string>();

    // map a type to its key function, if any
    private _keyFnMap = new Map<string, string>();

    constructor(target : 'js' | 'ts') {
        this._target = target;
    }

    private async _loadFile(filename : string) {
        if (this._files.has(filename))
            return;

        const dirname = path.dirname(filename);
        const input = await pfs.readFile(filename, { encoding: 'utf8' });
        let parsed;
        try {
            parsed = metagrammar.parse(input) as metaast.Grammar;
        } catch(e) {
            e.fileName = filename;
            throw e;
        }

        this._files.set(filename, parsed);

        const allImports = new Set<string>();
        const self = this;
        parsed.visit(new class extends metaast.NodeVisitor {
            visitImport(stmt : metaast.Import) {
                const resolved = path.resolve(dirname, stmt.what);
                allImports.add(resolved);
            }

            visitContextStmt(stmt : metaast.ContextStmt) {
                if (!stmt.type)
                    return;
                for (const symbol of stmt.names)
                    self._typeMap.set(symbol, stmt.type);
            }

            visitNonTerminalStmt(stmt : metaast.NonTerminalStmt) {
                if (stmt.type === undefined || stmt.type === 'any')
                    return;
                if (!(stmt.name instanceof metaast.IdentifierNTR))
                    return;
                const symbol = stmt.name.name;

                const existing = self._typeMap.get(symbol);
                if (!existing || existing === 'any') {
                    self._typeMap.set(symbol, stmt.type);
                    return;
                }
                if (existing !== stmt.type)
                    throw new TypeError(`Invalid conflicting type annotation for non-terminal ${symbol}, have ${existing} want ${stmt.type}`);
            }

            visitKeyFunctionDeclaration(stmt : metaast.KeyFunctionDeclarationStmt) {
                for (let [type, keyfn] of stmt.decls) {
                    type = type.trim();
                    keyfn = keyfn.trim();

                    const existing = self._keyFnMap.get(type);
                    if (!existing) {
                        self._keyFnMap.set(type, keyfn);
                        continue;
                    }
                    if (existing !== keyfn)
                        throw new TypeError(`Invalid conflicting key function declaration for type ${type}`);
                }
            }
        });

        for (const import_ of allImports)
            await this._loadFile(import_);
    }

    private _assignAllTypes() {
        const self = this;
        this.visit(new class extends metaast.NodeVisitor {
            // assign a type to every usage of a non-terminal
            visitNonTerminalRuleHead(node : metaast.NonTerminalRuleHead) {
                if (!(node.category instanceof metaast.IdentifierNTR))
                    return;
                const symbol = node.category.name;
                const type = self._typeMap.get(symbol);
                if (type) {
                    node.type = type;
                    node.keyfn = self._keyFnMap.get(type.trim()) || 'undefined';
                }
                if (node.constraint && node.keyfn === 'undefined')
                    console.log(`WARNING: missing key function for type ${node.type}, which is used in constraint for non-terminal ${symbol}`);
            }

            // also assign a type to every non-terminal declaration, if
            // it doesn't have one already
            visitNonTerminalStmt(stmt : metaast.NonTerminalStmt) {
                if (stmt.type) {
                    stmt.keyfn = self._keyFnMap.get(stmt.type.trim()) || 'undefined';
                    return;
                }
                if (!(stmt.name instanceof metaast.IdentifierNTR))
                    return;
                const symbol = stmt.name.name;

                const existing = self._typeMap.get(symbol);
                if (existing) {
                    stmt.type = existing;
                    stmt.keyfn = self._keyFnMap.get(existing.trim()) || 'undefined';
                }
            }
        });
    }

    visit(visitor : metaast.NodeVisitor) {
        for (const parsed of this._files.values())
            parsed.visit(visitor);
    }

    async parse(filename : string) {
        // load all template files and extract all the type annotations
        await this._loadFile(filename);

        // assign the type annotations to all the uses of the non-terminals
        this._assignAllTypes();
    }

    async process(filename : string) : Promise<void> {
        await this.parse(filename);
        await this._outputAllFiles();
    }

    private async _outputAllFiles() {
        for (const [filename, parsed] of this._files)
            await this._outputFile(filename, parsed);
    }

    private async _outputFile(filename : string,
                              parsed : metaast.Grammar) {
        const outputFile = filename + '.' + this._target;
        let output = parsed.codegen();

        if (this._target === 'js') {
            const result = ts.transpileModule(output, {
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
            output = result.outputText;
        }

        await pfs.writeFile(outputFile, output);
    }
}


export function compile(filename : string) : Promise<void> {
    return new Compiler('ts').process(filename);
}

interface GrammarOptions {
    flags : { [flag : string] : boolean };
    debug : number;
    onlyDevices ?: string[];
    whiteList ?: string;
}

type CompiledTemplate = (runtime : typeof SentenceGeneratorRuntime,
                         options : GrammarOptions,
                         langPack : I18n.LanguagePack,
                         grammar : SentenceGenerator<any, any, any>) => Promise<void>;

export async function importGenie(filename : string,
                                  searchPath = '.') : Promise<CompiledTemplate> {
    filename = path.resolve(searchPath, filename);

    // try loading compiled js first
    let target : 'js'|'ts' = 'js';
    try {
        if (filename.endsWith('.js'))
            return (await import(filename)).default;
        else
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
        await new Compiler(target).process(filename);
    }

    return (await import(filename + '.' + target)).default;
}
