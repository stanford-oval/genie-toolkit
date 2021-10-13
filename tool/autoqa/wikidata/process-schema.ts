// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as argparse from 'argparse';
import * as fs from 'fs';
import { Ast, Type } from 'thingtalk';
import type * as Tp from 'thingpedia';

import * as StreamUtils from '../../../lib/utils/stream-utils';
import genBaseCanonical from '../lib/base-canonical-generator';
import { clean } from '../../../lib/utils/misc-utils';
import {
    readJson,
    getPropertyAltLabels,
    argnameFromLabel,
    Domains
} from './utils';
import { MANUAL_PROPERTY_CANONICAL_OVERRIDE } from './manual-annotations';

function canonical(domain : string) {
    if (domain === 'common_name')
        return ['person', 'people'];
    return clean(domain);
}

interface SchemaProcessorOptions {
    domains : Domains,
    properties : Map<string, string[]>,
    labels : Map<string, string>,
    typeSystem : 'entity-plain' | 'entity-hierarchical' | 'string',
    subtypeMap : Map<string, string[]>,
    output : NodeJS.WritableStream,
    outputEntities : NodeJS.WritableStream,
    manual : boolean,
    useWikidataAltLabels : boolean
}

class SchemaProcessor {
    private _domains : Domains;
    private _propertiesByDomain : Map<string, string[]>;
    private _labels : Map<string, string>;
    private _typeSystem : 'entity-plain' | 'entity-hierarchical' | 'string';
    private _subtypeMap : Map<string, string[]>;
    private _output : NodeJS.WritableStream;
    private _outputEntities : NodeJS.WritableStream;
    private _entities : Map<string, Tp.BaseClient.EntityTypeRecord>;
    private _manual : boolean;
    private _useWikidataAltLabels : boolean;

    constructor(options : SchemaProcessorOptions) {
        this._domains = options.domains;
        this._propertiesByDomain = options.properties;
        this._labels = options.labels;
        this._typeSystem = options.typeSystem;
        this._subtypeMap = options.subtypeMap;
        this._output = options.output;
        this._outputEntities = options.outputEntities;
        this._entities = new Map();
        this._manual = options.manual;
        this._useWikidataAltLabels = options.useWikidataAltLabels;
    }

    private async _getArgCanonical(property : string, label : string, type : InstanceType<typeof Type>) {
        if (this._manual && property in MANUAL_PROPERTY_CANONICAL_OVERRIDE)
            return MANUAL_PROPERTY_CANONICAL_OVERRIDE[property];
        const canonical = {};
        genBaseCanonical(canonical, label, type);
        if (this._useWikidataAltLabels) {
            const altLabels = await getPropertyAltLabels(property);
            if (altLabels) {
                for (const label of altLabels)
                    genBaseCanonical(canonical, label, type);
            }
        }

        return canonical;
    }

    private _addPrimEntity(type : string, subtype_of ?: string) {
        if (this._entities.has(type)) {
            const entity = this._entities.get(type)!;
            if (subtype_of && !entity.subtype_of!.includes(subtype_of))
                entity.subtype_of!.push(`org.wikidata:` + subtype_of);
        } else {
            this._entities.set(type, { 
                type: `org.wikidata:` + type, 
                name: clean(type), 
                is_well_known: false, 
                has_ner_support: true, 
                subtype_of: subtype_of ? [`org.wikidata:` + subtype_of] : []
            });
        }
    }

    private _addSuperEntity(type : string) {
        const subtypes = this._subtypeMap.get(type);
        if (subtypes) {
            for (const subtype of this._subtypeMap.get(type)!)
                this._addPrimEntity(subtype, type);
        }
        this._entities.set(type, { 
            type: `org.wikidata:` + type, 
            name: clean(type.slice('p_'.length)), 
            is_well_known: false, 
            has_ner_support: false,  
            subtype_of: ['org.wikidata:entity']
        });
    }

    private async  _genFunctionDef(domain : string) {
        const args = [
            new Ast.ArgumentDef(
                null,
                Ast.ArgDirection.OUT,
                'id',
                new Type.Entity(`org.wikidata:${domain}`), {
                nl: { canonical: { base: ['name'], passive_verb: ['named', 'called'] } }
                })
        ];
        this._addPrimEntity(domain);
        for (const property of this._propertiesByDomain.get(domain)!) {
            const label = this._labels.get(property)!;
            const name = argnameFromLabel(label);
            // in case the property has the same name as the domain, drop it
            // it happens for country entities, probably added for the completeness of the kb
            if (name === domain) 
                continue;
            let type;
            if (this._typeSystem === 'string') {
                type = new Type.Array(Type.String);
            } else {
                type = new Type.Array(new Type.Entity(`org.wikidata:p_${name}`));
                if (this._typeSystem === 'entity-plain')
                    this._addPrimEntity(`p_${name}`);
                else if (this._typeSystem === 'entity-hierarchical')
                    this._addSuperEntity(`p_${name}`);
            }
            const annotations : Ast.AnnotationSpec = {
                nl: { canonical: await this._getArgCanonical(property, label, type) },
                impl: { wikidata_id: new Ast.Value.String(property) }
            };
            if (this._typeSystem === 'string') 
                annotations.nl!.string_values = 'p_' + name;
            args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, name, type, annotations));  
        }
        const qualifiers = { is_list: true, is_monitorable: false };
        const annotations = {
            nl: { canonical: [canonical(domain), ...this._domains.getWikidataTypeLabels(domain)] },
            impl: { 
                handle_thingtalk: new Ast.Value.Boolean(true),
                csqa_type: new Ast.Value.String(this._domains.getCSQAType(domain)),
                wikidata_types: new Ast.Value.Array(this._domains.getWikidataTypes(domain).map((t) => new Ast.Value.String(t))),
                wikidata_subject: new Ast.Value.Array(this._domains.getWikidataSubjects(domain).map((t) => new Ast.Value.String(t)))
            }
        };
        return new Ast.FunctionDef(null, 'query', null, domain, [], qualifiers, args, annotations);
    }

    async run() {
        const queries : Record<string, Ast.FunctionDef> = {};
        const actions : Record<string, Ast.FunctionDef> = {};
        for (const domain of this._domains.domains) 
            queries[domain] = await this._genFunctionDef(domain);
        
        const imports = [
            new Ast.MixinImportStmt(null, ['loader'], 'org.thingpedia.v2', []),
            new Ast.MixinImportStmt(null, ['config'], 'org.thingpedia.config.none', [])
        ];

        // add super entity type that is ancestor of every entity type
        this._entities.set('entity', { 
            type: `org.wikidata:entity`, 
            name: 'generic wikidata entity', 
            is_well_known: false, 
            has_ner_support: false,  
            subtype_of: []
        });
        const entities = Array.from(this._entities.values()).map((entity) => {
            return new Ast.EntityDef(
                null, 
                entity.type.slice('org.wikidata:'.length), 
                entity.subtype_of!.map((e) => e.slice('org.wikidata:'.length)), 
                { impl: { has_ner: new Ast.Value.Boolean(!!entity.has_ner_support) } }
            );
        });
        
        const classdef = new Ast.ClassDef(null, 'org.wikidata', null,
            { imports, queries, actions, entities }, {
                nl: {
                    name: `Wikidata QA`,
                    description: 'Natural language dialogues over Wikidata knowledge base.'
                },
            }, {
                is_abstract: false
            });

        this._output.end(classdef.prettyprint());
        this._outputEntities.end(JSON.stringify({
            result: 'ok',
            data: Array.from(this._entities.values())
        }, undefined, 2));
        await StreamUtils.waitFinish(this._output);
        await StreamUtils.waitFinish(this._outputEntities);
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('wikidata-process-schema', {
        add_help: true,
        description: "Generate schema.tt given a list of domains. "
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--entities', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--domains', {
        required: true,
        help: 'the path to the file containing type mapping for each domain'
    });
    parser.add_argument('--properties', {
        required: true,
        help: 'properties by each domain'
    });
    parser.add_argument('--property-labels', {
        required: true,
        help: 'path to the JSON file containing default label for each property'
    });
    parser.add_argument('--type-system', {
        required: true,
        choices: ['entity-plain', 'entity-hierarchical', 'string'],
        help: 'design choices for the type system:\n' +
            'entity-plain: one entity type per property\n' +
            'entity-hierarchical: one entity type for each value, and the property type is the supertype of all types of its values\n' +
            'string: all property has a string type except id',
        default: 'entity-hierarchical'
    });
    parser.add_argument('--subtypes', {
        required: false,
        help: 'path to the JSON file containing subtypes for each property'
    });
    parser.add_argument('--manual', {
        action: 'store_true',
        help: 'Enable manual annotations.',
        default: false
    });
    parser.add_argument('--use-wikidata-alt-labels', {
        action: 'store_true',
        help: 'Enable wikidata alternative labels as annotations.',
        default: false
    });
}

export async function execute(args : any) {
    const domains = new Domains({ path: args.domains });
    await domains.init();
    const properties = await readJson(args.properties);
    const subtypeMap = await readJson(args.subtypes);
    const labels = await readJson(args.property_labels);
    const schemaProcessor = new SchemaProcessor({
        domains,
        properties,
        labels,
        typeSystem: args.type_system,
        subtypeMap,
        output: args.output,
        outputEntities: args.entities,
        manual: args.manual,
        useWikidataAltLabels: args.use_wikidata_alt_labels

    });
    schemaProcessor.run();
}
