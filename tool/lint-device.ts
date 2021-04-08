// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Thingpedia
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

import * as argparse from 'argparse';
import * as ThingTalk from 'thingtalk';
import * as Tp from 'thingpedia';
import { promises as pfs } from 'fs';

import { splitParams } from '../lib/utils/misc-utils';

import { getConfig, DEFAULT_THINGPEDIA_URL } from './lib/argutils';

const ALLOWED_ARG_METADATA = new Set(['canonical', 'prompt', 'counted_object', 'question']);
const ALLOWED_FUNCTION_METADATA = new Set(['canonical', 'canonical_short', 'confirmation', 'confirmation_remote', 'formatted', 'result', 'on_error']);
const ALLOWED_CLASS_METADATA = new Set(['name', 'description', 'thingpedia_name', 'thingpedia_description', 'canonical', 'help']);
const SUBCATEGORIES = new Set(['service','media','social-network','communication','home','health','data-management']);

function warning(msg : string) {
    console.error(`WARNING: ${msg}`);
}

let _anyError = false;
function error(msg : string) {
    _anyError = true;
    console.error(`ERROR: ${msg}`);
}

function validateMetadata(metadata : Record<string, unknown>, allowed : Set<string>) {
    for (const name of Object.getOwnPropertyNames(metadata)) {
        if (!allowed.has(name))
            warning(`Invalid natural language annotation ${name}`);
    }
}

function parseNewOrOldSyntax(code : string) {
    try {
        return ThingTalk.Syntax.parse(code);
    } catch(e1) {
        if (e1.name !== 'SyntaxError')
            throw e1;
        try {
            const parsed = ThingTalk.Syntax.parse(code, ThingTalk.Syntax.SyntaxType.Legacy);
            warning('WARNING: manifest.tt and dataset.tt use legacy syntax, you should migrate to ThingTalk 2.0');
            return parsed;
        } catch(e2) {
            if (e2.name !== 'SyntaxError')
                throw e2;
            throw e1;
        }
    }
}

class SimplePlatform extends Tp.BasePlatform {
    private _developerKey : string|null;
    private _prefs : Tp.Preferences;

    constructor(developerKey : string|null) {
        super();
        this._developerKey = developerKey;
        this._prefs = new Tp.Helpers.MemoryPreferences();
    }
    get type() {
        return 'simple';
    }
    get locale() {
        return 'en-US';
    }
    get timezone() {
        return 'America/Los_Angeles';
    }
    hasCapability() {
        return false;
    }
    getCapability() {
        return null;
    }
    getSharedPreferences() {
        return this._prefs;
    }
    getDeveloperKey() {
        return this._developerKey;
    }
}


async function loadClassDef(args : any, classCode : string, datasetCode : string) : Promise<[ThingTalk.Ast.ClassDef, ThingTalk.Ast.Dataset]> {
    const tpClient = new Tp.HttpClient(new SimplePlatform(args.developer_key), args.thingpedia_url);
    const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, true);

    let parsed;
    try {
        parsed = await parseNewOrOldSyntax(`${classCode}\n${datasetCode}`).typecheck(schemaRetriever, true);
    } catch(e) {
        if (e.name === 'SyntaxError' && e.location) {
            let lineNumber = e.location.start.line;
            // add 1 for the \n that we add to separate classCode and datasetCode
            console.log(classCode);
            const classLength = 1 + classCode.split('\n').length;
            const fileName = lineNumber > classLength ? 'dataset.tt' : 'manifest.tt';
            // mind the 1-based line numbers...
            lineNumber = lineNumber > classLength ? lineNumber - classLength + 1 : lineNumber;
            throw new Error(`Syntax error in ${fileName} line ${lineNumber}: ${e.message}`);
        } else {
            throw new Error(e.message);
        }
    }

    if (!(parsed instanceof ThingTalk.Ast.Library) || parsed.classes.length !== 1)
        throw new Error("Invalid manifest file: must contain exactly one class, with the same identifier as the device");
    const classDef = parsed.classes[0];

    if (parsed.datasets.length > 1 || (parsed.datasets.length > 0 && parsed.datasets[0].name !== parsed.classes[0].kind))
        error("Invalid dataset file: must contain exactly one dataset, with the same identifier as the class");
    const dataset = parsed.datasets.length > 0 ? parsed.datasets[0] :
        new ThingTalk.Ast.Dataset(null, parsed.classes[0].kind, [], {});

    return [classDef, dataset];
}

function validateDevice(classDef : ThingTalk.Ast.ClassDef) {
    if (!classDef.metadata.thingpedia_name)
        warning(`Missing required class annotation #_[thingpedia_name]`);
    if (!classDef.metadata.thingpedia_description)
        warning(`Missing required class annotation #_[thingpedia_description]`);

    for (const annot of ['license', 'license_gplcompatible', 'subcategory']) {
        if (!classDef.annotations[annot]) {
            warning(`Missing required class annotation #[${annot}]`);
            continue;
        }

        if (annot === 'subcategory') {
            const value = classDef.annotations[annot].toJS() as string;
            if (!SUBCATEGORIES.has(value))
                error(`Invalid device category ${value}`);
        }
    }

    validateMetadata(classDef.metadata, ALLOWED_CLASS_METADATA);

    if (!classDef.is_abstract) {
        if (!classDef.loader)
            error("loader mixin missing from class declaration");
        if (!classDef.config)
            classDef.imports.push(new ThingTalk.Ast.MixinImportStmt(null, ['config'], 'org.thingpedia.config.none', []));
    }

    validateAllInvocations(classDef, {
        checkPollInterval: !classDef.is_abstract,
    });
}

function validateDataset(dataset : ThingTalk.Ast.Dataset, kind : string) {
    const names = new Set;
    dataset.examples.forEach((ex, i) => {
        try {
            let foundOurDevice = false;
            for (const [, prim] of ex.iteratePrimitives(false)) {
                if (prim.selector.kind === kind) {
                    foundOurDevice = true;
                    break;
                }
            }
            if (!foundOurDevice)
                warning(`Example ${i+1} does not use any function from this device`);

            // validate placeholders in all utterances
            if (ex.utterances.length === 0) {
                if (Object.prototype.hasOwnProperty.call(ex.annotations, 'utterances'))
                    throw new Error(`utterances must be a natural language annotation (with #_[]), not an implementation annotation`);
                else
                    throw new Error(`missing utterances annotation`);
            }

            if (ex.annotations.name) {
                const name = ex.annotations.name.toJS();
                if (typeof name !== 'string')
                    throw new Error(`invalid #[name] annotation (must be a string)`);
                if (name.length > 128)
                    throw new Error(`the #[name] annotation must be at most 128 characters`);
                if (names.has(name))
                    throw new Error(`duplicate name`);
                names.add(name);
            }

            for (const utterance of ex.utterances)
                validateUtterance(ex.args, utterance);
        } catch(e) {
            error(`Error in example ${i+1}: ${e.message}`);
        }
    });
}

function validateUtterance(args : Record<string, ThingTalk.Type>, utterance : string) {
    if (/_{4}/.test(utterance))
        throw new Error('Do not use blanks (4 underscores or more) in utterance, use placeholders');

    const placeholders = new Set;
    for (const chunk of splitParams(utterance.trim())) {
        if (chunk === '')
            continue;
        if (typeof chunk === 'string')
            continue;

        const [match, param1, param2, opt] = chunk;
        if (match === '$$')
            continue;
        const param = param1 || param2;
        if (!(param in args))
            throw new Error(`Invalid placeholder ${param}`);
        if (opt && opt !== 'const' && opt !== 'no-undefined')
            throw new Error(`Invalid placeholder option ${opt} for ${param}`);
        placeholders.add(param);
    }

    for (const arg in args) {
        if (!placeholders.has(arg))
            throw new Error(`Missing placeholder for argument ${arg}`);
    }
}

function validateAllInvocations(classDef : ThingTalk.Ast.ClassDef, options : { checkPollInterval ?: boolean } = {}) {
    const entities = new Set<string>();
    const stringTypes = new Set<string>();
    validateInvocation(classDef.kind, classDef.actions, 'action', entities, stringTypes, options);
    validateInvocation(classDef.kind, classDef.queries, 'query', entities, stringTypes, options);
    return [Array.from(entities), Array.from(stringTypes)];
}

function validateInvocation(kind : string,
                            where : Record<string, ThingTalk.Ast.FunctionDef>,
                            what : 'action'|'query',
                            entities : Set<string>,
                            stringTypes : Set<string>,
                            options : { checkPollInterval ?: boolean } = {}) {
    for (const name in where) {
        const fndef = where[name];

        validateMetadata(fndef.metadata, ALLOWED_FUNCTION_METADATA);

        if (fndef.annotations.confirm) {
            if (fndef.annotations.confirm.isEnum) {
                if (!['confirm', 'auto', 'display_result'].includes(fndef.annotations.confirm.toJS() as string))
                    error(`Invalid #[confirm] annotation for ${name}, must be a an enum "confirm", "auto", "display_result"`);
            } else if (!where[name].annotations.confirm.isBoolean) {
                error(`Invalid #[confirm] annotation for ${name}, must be a Boolean`);
            }
        }
        if (options.checkPollInterval && what === 'query' && where[name].is_monitorable) {
            if (!fndef.annotations.poll_interval)
                error(`Missing poll interval for monitorable query ${name}`);
            else if (fndef.annotations.poll_interval.toJS() as number < 0)
                error(`Invalid negative poll interval for monitorable query ${name}`);
        }

        for (const argname of where[name].args) {
            const arg = fndef.getArgument(argname)!;
            let type = arg.type;
            while (type instanceof ThingTalk.Type.Array)
                type = type.elem as ThingTalk.Type;
            validateMetadata(arg.metadata, ALLOWED_ARG_METADATA);

            if (type instanceof ThingTalk.Type.Entity) {
                entities.add(type.type);
                if (arg.annotations['string_values'])
                    stringTypes.add(arg.annotations['string_values'].toJS() as string);
            } else if (type.isString) {
                if (arg.annotations['string_values'])
                    stringTypes.add(arg.annotations['string_values'].toJS() as string);
            } else {
                if (arg.annotations['string_values'])
                    error('The string_values annotation is valid only for String-typed parameters');
            }
        }
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('lint-device', {
        add_help: true,
        description: "Check the manifest for a Thingpedia device."
    });
    parser.add_argument('--thingpedia-url', {
        required: false,
        help: `base URL of Thingpedia server to contact; defaults to '${DEFAULT_THINGPEDIA_URL}'`
    });
    parser.add_argument('--developer-key', {
        required: false,
        default: '',
        help: `developer key to use when contacting Thingpedia`
    });
    parser.add_argument('--manifest', {
        required: true,
        help: "ThingTalk class definition file."
    });
    parser.add_argument('--dataset', {
        required: true,
        help: "ThingTalk dataset file with the class's primitive templates."
    });
}

export async function execute(args : any) {
    if (!args.thingpedia_url)
        args.thingpedia_url = await getConfig('thingpedia.url', process.env.THINGPEDIA_URL || DEFAULT_THINGPEDIA_URL);
    if (!args.developer_key)
        args.developer_key = await getConfig('thingpedia.developer-key', process.env.THINGPEDIA_DEVELOPER_KEY || null);

    const manifestCode = await pfs.readFile(args.manifest, { encoding: 'utf8' });
    const datasetCode = await pfs.readFile(args.dataset, { encoding: 'utf8' });

    const [classDef, dataset] = await loadClassDef(args, manifestCode, datasetCode);

    validateDevice(classDef);
    validateDataset(dataset, classDef.kind);

    if (_anyError)
        throw new Error(`Some errors occurred`);
}
