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
// Author: Silei Xu <silei@cs.stanford.edu>

import * as fs from 'fs';
import util from 'util';
import assert from 'assert';
import { Ast, Type } from 'thingtalk';

import * as StreamUtils from '../../../lib/utils/stream-utils';
import genBaseCanonical from '../lib/base-canonical-generator';
import { clean } from '../../../lib/utils/misc-utils';
import { DEFAULT_ENTITIES } from '../lib/utils';

import {
    readJson,
    getPropertyList,
    getItemLabel,
    getPropertyAltLabels,
    argnameFromLabel
} from './utils';

import {
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
} from './manual-annotations';

async function retrieveProperties(domain, properties) {
    let list = properties.includes('default') ? await getPropertyList(domain) : [];
    for (let property of properties) {
        if (property === 'none')
            continue;
        if (property === 'default')
            continue;
        if (property.startsWith('-')) {
            property = property.slice(1);
            let index = list.indexOf(property);
            if (index > -1)
                list.splice(index, 1);
        } else if (!list.includes(property)) {
            list.push(property);
        }
    }
    return list;
}

class SchemaProcessor {
    constructor(domains, domainCanonicals, propertiesByDomain, requiredPropertiesByDomain, subtypeMap, labels,
                output, outputEntities, manual, wikidataLabels, paramDatasetsTsv) {
        this._domains = domains;
        this._domainCanonicals = domainCanonicals;
        this._propertiesByDomain = propertiesByDomain;
        this._requiredPropertiesByDomain = requiredPropertiesByDomain;
        this._subtypeMap = subtypeMap;
        this._labels = labels;
        this._output = output;
        this._outputEntities = outputEntities;
        this._entities = new Map();
        this._manual = manual;
        this._wikidataLabels = wikidataLabels;

        // Test if worth adding type mapping from paramter_datasets.tsv
        this._paramDatasetsTsv = paramDatasetsTsv;
        this._paramDatasets = { 'entity': new Set() , 'string': new Set() };
    }

    async _getArgCanonical(property, label, type) {
        if (this._manual && property in MANUAL_PROPERTY_CANONICAL_OVERRIDE)
            return MANUAL_PROPERTY_CANONICAL_OVERRIDE[property];

        const canonical = {};
        genBaseCanonical(canonical, label, type);

        if (this._wikidataLabels) {
            const altLabels = await getPropertyAltLabels(property);
            if (altLabels) {
                for (let label of altLabels)
                    genBaseCanonical(canonical, label, type);
            }
        }

        return canonical;
    }

    _addPrimEntity(type, subtype_of) {
        if (this._entities.has(type)) {
            const entity = this._entities.get(type);
            if (subtype_of && !entity.subtype_of.includes(subtype_of))
                entity.subtype_of.push(subtype_of);
        } else {
            this._entities.set(type, { 
                type: `org.wikidata:` + type, 
                name: type, 
                is_well_known: false, 
                has_ner_support: true, 
                subtype_of: subtype_of ? [subtype_of] : []
            });
        }
    }

    _addSuperEntity(type) {
        const subtypes = this._subtypeMap.get(type);
        if (subtypes) {
            for (const subtype of this._subtypeMap.get(type))
                this._addPrimEntity(subtype, type);
        }
        this._entities.set(type, { 
            type: `org.wikidata:` + type, 
            name: type, 
            is_well_known: false, 
            has_ner_support: false,  
            subtype_of: []
        });
    }

    async run() {
        const queries = {};
        const actions = {};

        // load parameter dataset file ids if available
        if (this._paramDatasetsTsv) {
            const paramDatasets = await util.promisify(fs.readFile)(this._paramDatasetsTsv, { encoding: 'utf8' });
            for (const dataset of paramDatasets.split('\n')) {
                if (dataset === '') continue;
                const data = dataset.split('\t');
                if (data[0] === 'string')
                    this._paramDatasets['string'].add(data[2]);
                 else
                    this._paramDatasets['entity'].add(data[2]);
            }
        }

        for (let domain of this._domains) {
            const domainLabel = domain in this._domainCanonicals ? this._domainCanonicals[domain] : await getItemLabel(domain);
            const domainEntityType = argnameFromLabel(domainLabel);
            const properties = this._propertiesByDomain[domain];
            const args = [
                new Ast.ArgumentDef(
                    null,
                    Ast.ArgDirection.OUT,
                    'id',
                    new Type.Entity(`org.wikidata:${domainEntityType}`), {
                    nl: { canonical: { base: ['name'], passive_verb: ['named', 'called'] } }
                })
            ];
            this._addPrimEntity(domainEntityType);
            for (let property of properties) {
                const label = this._labels.get(property);
                const name = argnameFromLabel(label);
                const type = new Type.Array(new Type.Entity(`org.wikidata:p_${name}`));
                const annotations = {
                    nl: { canonical: await this._getArgCanonical(property, label, type) },
                    impl: { wikidata_id: new Ast.Value.String(property) }
                };
                this._addSuperEntity(`p_${name}`);
                args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, name, type, annotations));
            }
            const qualifiers = { is_list: true, is_monitorable: false };
            const annotations = {
                nl: { canonical: clean(domainLabel), confirmation: clean(domainLabel) },
                impl: { wikidata_subject: new Ast.Value.String(domain) }
            };
            if (domain in this._requiredPropertiesByDomain) {
                annotations.impl.required_properties = new Ast.Value.Array(
                    this._requiredPropertiesByDomain[domain].map((p) => new Ast.Value.String(p))
                );
            }

            queries[domainLabel] = new Ast.FunctionDef(
                null, 'query', null, argnameFromLabel(domainLabel), null, qualifiers, args, annotations);
        }

        const imports = [
            new Ast.MixinImportStmt(null, ['loader'], 'org.thingpedia.v2', []),
            new Ast.MixinImportStmt(null, ['config'], 'org.thingpedia.config.none', [])
        ];

        const entities = Array.from(this._entities.values()).map((entity) => {
            return new Ast.EntityDef(
                null, 
                entity.type.slice('org.wikidata:'.length), 
                entity.subtype_of, 
                { impl: { has_ner: new Ast.Value.Boolean(entity.has_ner_support) }}
            );
        });
        
        const classdef = new Ast.ClassDef(null, 'org.wikidata', null,
            { imports, queries, actions, entities }, {
                nl: {
                    name: `Wikidata for domain ${this._domains.join(', ')}`,
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

export function initArgparse(subparsers) {
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
        help: 'domains (by item id) to include in the schema, split by comma (no space)'
    });
    parser.add_argument('--domain-canonicals', {
        required: false,
        help: 'the canonical form for the given domains, used as the query names, split by comma (no space);\n' +
            'if absent, use Wikidata label by default.'
    });
    parser.add_argument('--properties', {
        nargs: '+',
        required: true,
        help: 'properties to include for each domain, properties are split by comma (no space);\n' +
            'use "default" to include properties included in P1963 (properties of this type);\n' +
            'exclude a property by placing a minus sign before its id (no space)'
    });
    parser.add_argument('--property-labels', {
        required: true,
        help: 'path to the JSON file containing default label for each property'
    }); 
    parser.add_argument('--subtypes', {
        required: true,
        help: 'path to the JSON file containing subtypes for each property'
    });
    parser.add_argument('--manual', {
        action: 'store_true',
        help: 'Enable manual annotations.',
        default: false
    });
    parser.add_argument('--wikidata-labels', {
        action: 'store_true',
        help: 'Enable wikidata labels as annotations.',
        default: false
    });
    parser.add_argument('--required-properties', {
        nargs: '+',
        required: false,
        help: 'the subset of properties that are required to be non-empty for all retrieved entities;\n' +
            'use "none" to indicate no required property needed;\n' +
            'use "default" to include properties included in P1963 (properties of this type);\n' +
            'exclude a property by placing a minus sign before its id (no space)'
    });
    parser.add_argument('--parameter-datasets', {
        required: true,
        help: 'Path to parammeter_datasets.tsv; used for entity/string type mapping'
    });
}

export async function execute(args) {
    const domains = args.domains.split(',');

    const domainCanonicals = {};

    if (args.domain_canonicals) {
        const canonicals = args.domain_canonicals.split(',');
        assert.strictEqual(canonicals.length, domains.length);
        for (let i = 0; i < domains.length; i++)
            domainCanonicals[domains[i]] = canonicals[i];
    }

    const requiredPropertiesByDomain = {};
    if (args.required_properties) {
        // if provided, property lists should match the number of domains
        assert(Array.isArray(args.required_properties) && args.required_properties.length === domains.length);
        for (let i = 0; i < domains.length; i++) {
            const domain = domains[i];
            requiredPropertiesByDomain[domain] = await retrieveProperties(domain, args.required_properties[i].split(','));
        }
    }

    const propertiesByDomain = {};
    // if provided, property lists should match the number of domains
    assert(Array.isArray(args.properties) && args.properties.length === domains.length);
    for (let i = 0; i < domains.length; i++) {
        const domain = domains[i];
        const properties = args.properties[i].split(',');
        propertiesByDomain[domain] = await retrieveProperties(domain, properties);
    }

    const subtypeMap = await readJson(args.subtypes);
    const labels = await readJson(args.property_labels);

    const schemaProcessor = new SchemaProcessor(
        domains, domainCanonicals, propertiesByDomain, requiredPropertiesByDomain, subtypeMap, labels,
        args.output, args.entities, args.manual, args.wikidata_labels
    );
    schemaProcessor.run();
}
