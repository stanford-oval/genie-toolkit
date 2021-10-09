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
// Author: Silei Xu <silei@cs.stanford.edu>

import assert from 'assert';
import * as fs from 'fs';
import path from 'path';
import { Ast, Type } from 'thingtalk';
import * as Tp from 'thingpedia';

import * as utils from '../../../lib/utils/misc-utils';
import { makeLookupKeys } from '../../../lib/dataset-tools/mturk/sample-utils';
import EnglishLanguagePack from '../../../lib/i18n/english';
import { clean } from '../../../lib/utils/misc-utils';

import CanonicalExtractor from './canonical-extractor';
import genBaseCanonical from './base-canonical-generator';
import { PARTS_OF_SPEECH, Canonicals, CanonicalAnnotation } from './base-canonical-generator';
import { ParaphraseExample, generateExamples } from './canonical-example-constructor';
import Paraphraser from './canonical-example-paraphraser';

interface AutoCanonicalGeneratorOptions {
    dataset : 'schemaorg'|'sgd'|'multiwoz'|'wikidata'|'custom',
    paraphraser_model : string,
    remove_existing_canonicals : boolean,
    type_based_projection : boolean,
    max_per_pos ?: number,
    batch_size : number,
    filtering : boolean,
    debug : boolean
}

interface Constant {
    value ?: any,
    display : string
}

function getElemType(type : Type) : Type {
    if (type instanceof Type.Array)
        return getElemType(type.elem as Type);
    return type;
}

function typeToString(type : Type) : string {
    const elemType = getElemType(type);
    if (elemType instanceof Type.Entity)
        return elemType.type;
    return type.toString();
}

function countArgTypes(schema : Ast.FunctionDef) : Record<string, number> {
    const count : Record<string, number> = {};
    for (const arg of schema.iterateArguments()) {
        const typestr = typeToString(arg.type);
        if (!typestr)
            continue;
        count[typestr] = (count[typestr] || 0) + 1;
    }
    return count;
}

export default class AutoCanonicalGenerator {
    private class : Ast.ClassDef;
    private entities : Tp.BaseClient.EntityTypeRecord[];
    private constants : Record<string, Constant[]>;
    private functions : string[];
    private paraphraserModel : string;
    private annotatedProperties : string[];
    private langPack : EnglishLanguagePack;
    private options : AutoCanonicalGeneratorOptions;
    private entityNames : Record<string, string>;
    private childEntities : Record<string, string[]>;

    constructor(classDef : Ast.ClassDef, 
                entities : Tp.BaseClient.EntityTypeRecord[],
                constants : Record<string, any[]>, 
                functions : string[], 
                options : AutoCanonicalGeneratorOptions) {
        this.class = classDef;
        this.entities = entities;
        this.constants = constants;
        this.functions = functions ? functions : Object.keys(classDef.queries).concat(Object.keys(classDef.actions));
        this.paraphraserModel = options.paraphraser_model;
        this.annotatedProperties = [];
        this.langPack = new EnglishLanguagePack('en-US');
        this.options = options;

        this.entityNames = {};
        this.childEntities = {};
        for (const entity of this.entities) {
            this.entityNames[entity.type] = entity.name;
            if (entity.subtype_of) {
                for (const parent of entity.subtype_of) {
                    if (parent in this.childEntities)
                        this.childEntities[parent].push(entity.name);
                    else
                        this.childEntities[parent] = [entity.name];
                }
            }
        }
    }

    async generate() {
        await this._loadManualCanonicalOverride();
        const examples : ParaphraseExample[] = [];
        for (const fname of this.functions) {
            const func = this.class.queries[fname] || this.class.actions[fname];
            const typeCounts = countArgTypes(func);
            for (const arg of func.iterateArguments()) {
                // skip argument with existed annotations
                if (this.annotatedProperties.includes(arg.name) || arg.name === 'id')
                    continue;
                if (arg.name.includes('.') && this.annotatedProperties.includes(arg.name.slice(arg.name.indexOf('.') + 1)))
                    continue;
                    
                // set starting canonical annotation
                const sampleValues = this._retrieveSamples(fname, arg);
                const canonicalAnnotation = this._generateBaseCanonicalAnnotation(func, arg, typeCounts);
                examples.push(...generateExamples(func, arg, canonicalAnnotation, sampleValues));
            }
        }

        const paraphraser = new Paraphraser(this.paraphraserModel, this.options);
        const startTime = (new Date()).getTime();
        await paraphraser.paraphrase(examples);
        if (this.options.debug) {
            const time = Math.round(((new Date()).getTime() - startTime) / 1000);
            console.log(`Paraphraser took ${time} seconds to run.`);
        }

        const extractor = new CanonicalExtractor(this.class, this.functions, this.options);
        await extractor.run(examples);
        
        this._addProjectionCanonicals();
        this._trimAnnotations();
        return this.class;
    }

    private async _loadManualCanonicalOverride() {
        const file = path.resolve(path.dirname(module.filename), `../${this.options.dataset}/manual-annotations.js`);
        if (!fs.existsSync(file))
            return;
        const manualAnnotations = await import(`../${this.options.dataset}/manual-annotations.js`);
        if (manualAnnotations.PROPERTY_CANONICAL_OVERRIDE)
            this.annotatedProperties = Object.keys(manualAnnotations.PROPERTY_CANONICAL_OVERRIDE);
    }

    private _generateBaseCanonicalAnnotation(func : Ast.FunctionDef, 
                                             arg : Ast.ArgumentDef, 
                                             typeCounts : Record<string, number>) : CanonicalAnnotation {
        const canonicalAnnotation : CanonicalAnnotation = {};
        if (this.options.remove_existing_canonicals) {
            genBaseCanonical(canonicalAnnotation, arg.name, arg.type);
        } else {
            const existingCanonical : Record<string, any> = arg.getNaturalLanguageAnnotation('canonical') || {};
            if (typeof existingCanonical === 'string') 
                canonicalAnnotation.base = [existingCanonical];
            else if (Array.isArray(existingCanonical))
                canonicalAnnotation.base = existingCanonical;
            else if (typeof existingCanonical === 'object') 
                Object.assign(canonicalAnnotation, existingCanonical);
        } 

        // remove function name in arg name, normally it's repetitive
        for (const [key, value] of Object.entries(canonicalAnnotation)) {
            if (PARTS_OF_SPEECH.includes(key)) {
                canonicalAnnotation[key as keyof Canonicals] = value.map((c : string) => {
                    if (c.startsWith(func.name.toLowerCase() + ' '))
                        return c.slice(func.name.toLowerCase().length + 1);
                    return c;
                });
            }
        }

        // copy base canonical if property canonical is missing
        if (canonicalAnnotation.base && !canonicalAnnotation.property)
            canonicalAnnotation.property = [...canonicalAnnotation.base];

        const typestr = typeToString(func.getArgType(arg.name)!);
        if (typestr && typeCounts[typestr] === 1) {
            // if an entity is unique, allow dropping the property name entirely
            // FIXME: consider type hierarchy, or probably drop it entirely
            if (canonicalAnnotation.property && !this.functions.includes(typestr.substring(typestr.indexOf(':') + 1))) {
                if (!canonicalAnnotation.property.includes('#'))
                    canonicalAnnotation.property.push('#');
            }

            // if property is missing, use the type information
            if (!('property' in canonicalAnnotation)) {
                const base = utils.clean(typestr.substring(typestr.indexOf(':') + 1));
                canonicalAnnotation['property'] = [base];
                canonicalAnnotation['base'] = [base];
            }

            // if it's the only people entity, adding adjective form
            // E.g., author for review - bob's review
            //       byArtist for MusicRecording - bob's song
            if (typestr.endsWith(':Person'))
                canonicalAnnotation.adjective = ["# 's", '#'];

            // if it's the only date, adding argmin/argmax/base_projection
            if (typestr === 'Date') {
                canonicalAnnotation.adjective_argmax = ["most recent", "latest", "last", "newest"];
                canonicalAnnotation.adjective_argmin = ["earliest", "first", "oldest"];
                canonicalAnnotation.base_projection = ['date'];
            }
        }
        return canonicalAnnotation;
    }

    private _addProjectionCanonicals() {
        for (const fname of this.functions) {
            const func = this.class.queries[fname] || this.class.actions[fname];
            for (const arg of func.iterateArguments()) {
                if (this.annotatedProperties.includes(arg.name) || arg.name === 'id')
                    continue;
                if (arg.type.isBoolean)
                    continue;

                const canonicals = arg.metadata.canonical;
                if (!canonicals)
                    continue;
                if (typeof canonicals === 'string' || Array.isArray(canonicals))
                    continue;
                    
                const elemType = arg.type instanceof Type.Array ? arg.type.elem: arg.type;
                assert(elemType instanceof Type);
                if (elemType instanceof Type.Entity && this.options.type_based_projection && !('base_projection' in canonicals)) {
                    const entityType = elemType.type;
                    if (this.entityNames[entityType])
                        canonicals['base_projection'] = [this.entityNames[entityType]];
                    if (this.childEntities[entityType])
                        canonicals['base_projection'].push(...this.childEntities[entityType]);
                }

                for (const cat in canonicals) {
                    if (['default', 'adjective', 'implicit_identity', 'projection_pronoun'].includes(cat))
                        continue;
                    if (cat.endsWith('_projection'))
                        continue;
                    if (cat.endsWith('_argmin') || cat.endsWith('_argmax'))
                        continue;
                    if (`${cat}_projection` in canonicals)
                        continue;

                    if (cat === 'passive_verb' || cat === 'verb') {
                        canonicals[cat + '_projection'] = canonicals[cat].map((canonical : string) => {
                            return this._processProjectionCanonical(canonical, cat);
                        }).filter(Boolean).map((c : string) => {
                            const tokens = c.split(' ');
                            if (tokens.length === 1)
                                return c;
                            if (['IN', 'TO', 'PR'].includes(this.langPack.posTag(tokens)[tokens.length - 1]))
                                return [...tokens.slice(0, -1), '//', tokens[tokens.length - 1]].join(' ');
                            return c;
                        }).filter((v : string, i : number, self : string[]) => self.indexOf(v) === i);
                    } else {
                        canonicals[cat + '_projection'] = canonicals[cat].map((canonical : string) => {
                            return this._processProjectionCanonical(canonical, cat);
                        }).filter(Boolean).filter((v : string, i : number, self : string[]) => self.indexOf(v) === i);
                    }
                }
            }
        }
    }

    private _processProjectionCanonical(canonical : string, cat : string) {
        if (canonical.includes('#') && !canonical.endsWith(' #'))
            return null;
        canonical = canonical.replace(' #', '');

        if (canonical.endsWith(' a') || canonical.endsWith(' an') || canonical.endsWith(' the'))
            canonical = canonical.substring(0, canonical.lastIndexOf(' '));

        if (canonical.split(' ').length > 1 && cat === 'preposition')
            return null;

        return canonical;
    }

    private _retrieveSamples(qname : string, arg : Ast.ArgumentDef) : string[] {
        //TODO: also use enum canonicals?
        if (arg.type instanceof Type.Enum) 
            return arg.type.entries!.slice(0, 10).map(clean);

        const keys = makeLookupKeys('@' + this.class.kind + '.' + qname, arg.name, arg.type);
        let sampleConstants : Constant[] = [];
        for (const key of keys) {
            if (this.constants[key]) {
                sampleConstants = this.constants[key];
                break;
            }
        }
        return sampleConstants.map((v) => {
            if (arg.type.isString || (arg.type instanceof Type.Array && (arg.type.elem as Type).isString))
                return v.value;
            return v.display;
        });
    }

    private _trimAnnotations() {
        if (!this.options.max_per_pos)
            return;
        for (const fname of this.functions) {
            const func = this.class.queries[fname] || this.class.actions[fname];
            for (const arg of func.iterateArguments()) {
                if (this.annotatedProperties.includes(arg.name) || arg.name === 'id')
                    continue;

                const canonicalAnnotation = arg.metadata.canonical;
                for (const pos in canonicalAnnotation) {
                    if (pos === 'default')
                        continue;
                    canonicalAnnotation[pos] = canonicalAnnotation[pos].slice(0, this.options.max_per_pos);
                }
            }
        }
    }
}
