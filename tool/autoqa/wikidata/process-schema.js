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
"use strict";

const fs = require('fs');
const util = require('util');
const assert = require('assert');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

const StreamUtils = require('../../../lib/utils/stream-utils');
const { clean } = require('../../../lib/utils/misc-utils');
const { cleanEnumValue, snakecase, titleCase, DEFAULT_ENTITIES } = require('../lib/utils');
const genBaseCanonical = require('../lib/base-canonical-generator');
const {
    getPropertyList,
    getItemLabel,
    getPropertyLabel,
    getPropertyAltLabels,
    getValueTypeConstraint,
    getOneOfConstraint,
    getAllowedUnits,
    getRangeConstraint,
    getSchemaorgEquivalent
} = require('./utils');

const {
    PROPERTY_TYPE_OVERRIDE,
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_TABLE_CANONICAL_OVERRIDE
} = require('./manual-annotations');

function argnameFromLabel(label) {
    return snakecase(label)
        .replace(/'/g, '') // remove apostrophe
        .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // remove accent
}

function getElementType(type) {
    if (type.isArray)
        return getElementType(type.elem);
    return type;
}

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
    constructor(domains, propertiesByDomain, requiredPropertiesByDomain, output, outputEntities, manual, wikidataLabels, schemaorgManifest) {
        this._domains = domains;
        this._propertiesByDomain = propertiesByDomain;
        this._requiredPropertiesByDomain = requiredPropertiesByDomain;
        this._output = output;
        this._outputEntities = outputEntities;
        this._entities = DEFAULT_ENTITIES.slice();
        this._manual = manual;
        this._wikidataLabels = wikidataLabels;
        this._schemaorgManifest = schemaorgManifest;
        this._schemaorgProperties = {};
    }

    async _getType(domain, property) {
        if (property in PROPERTY_TYPE_OVERRIDE)
            return PROPERTY_TYPE_OVERRIDE[property];

        const enumEntries = await getOneOfConstraint(property);
        if (enumEntries.length > 0)
            return Type.Enum(enumEntries.map(cleanEnumValue));

        const label = await getPropertyLabel(property);
        if (label.startsWith('date of'))
            return Type.Date;

        const units = await getAllowedUnits(property);
        if (units.length > 0) {
            if (units.includes('kilogram'))
                return Type.Measure('kg');
            if (units.includes('metre'))
                return Type.Measure('m');
            if (units.includes('second'))
                return Type.Measure('ms');
            if (units.includes('degree Celsius'))
                return Type.Measure('C');
            if (units.includes('metre per second'))
                return Type.Measure('mps');
            if (units.includes('square metre'))
                return Type.Measure('sqm');
            if (units.includes('percent'))
                return Type.Number;
            throw new TypeError('Unsupported measurement type with unit ' + units[0]);
        }

        const range = await getRangeConstraint(property);
        if (range)
            return Type.Number;

        /**  FIXME: create better heuristic to determine if something is plural.
            Most properties are actually Array(Type.String) so that may be a
            better default.
        */
        const stringTypes = ['native language', 'medical condition', 'subreddit'];
        if (label.startsWith('place of') || label.startsWith('manner of')
            || label.startsWith('cause of') || stringTypes.includes(label))
            return Type.String;
        else if (label === 'image' || label === 'signature')
            return Type.Entity(`tt:picture`);

        const types = await getValueTypeConstraint(property);
        // FIXME: choose based on examples in domain when multiple types available
        if (types.length > 0) {
            // human type: Q5: human, Q215627: person
            if (types.some((type) => type.label === 'human' || type.label === 'person'))
                return Type.Entity(`org.wikidata:human`);

            // location type: Q618123: geographic object, Q2221906: geographic location
            if (types.some((type) => type.label === 'geographical object' || type.label === 'geographical location'))
                return Type.Location;
        }

        const schemaorgEquivalent = await getSchemaorgEquivalent(property);
        if (schemaorgEquivalent && schemaorgEquivalent in this._schemaorgProperties)
            return this._schemaorgProperties[schemaorgEquivalent];

        // majority or arrays of string so this may be better default.
        return Type.Array(Type.String);

    }

    async _getArgCanonical(property, name, label, type) {
        if (this._manual && name in MANUAL_PROPERTY_CANONICAL_OVERRIDE)
            return MANUAL_PROPERTY_CANONICAL_OVERRIDE[name];

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

    _addEntity(type, name, has_ner_support) {
        if (!this._entities.some((entity) => entity.type === type))
            this._entities.push({ type, name, is_well_known: false, has_ner_support});
    }

    async run() {
        const queries = {};
        const actions = {};

        // load schema.org manifest if available
        if (this._schemaorgManifest) {
            const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(this._schemaorgManifest, { encoding: 'utf8' }));
            assert(library.isLibrary && library.classes.length === 1);
            const classDef = library.classes[0];

            for (let fn in classDef.queries) {
                const fndef = classDef.queries[fn];
                for (let argname of fndef.args) {
                    let key = argname;
                    if (argname.includes('.'))
                        key = argname.substring(argname.lastIndexOf('.') + 1);
                    if (!(argname in this._schemaorgProperties))
                        this._schemaorgProperties[key] = fndef.getArgType(argname);
                }
            }
        }

        for (let domain of this._domains) {
            const domainLabel = await getItemLabel(domain);
            const properties = this._propertiesByDomain[domain];
            const args = [
                new Ast.ArgumentDef(
                    null,
                    Ast.ArgDirection.OUT,
                    'id',
                    Type.Entity(`org.wikidata:${snakecase(domainLabel)}`), {
                    nl: { canonical: { base: ['name'], passive_verb: ['named', 'called'] } }
                })
            ];
            this._addEntity(`org.wikidata:${snakecase(domainLabel)}`, titleCase(domainLabel), true);
            for (let property of properties) {
                const type = await this._getType(domain, property);
                const label = await getPropertyLabel(property);
                const name = argnameFromLabel(label);
                const annotations = {
                    nl: { canonical: await this._getArgCanonical(property, name, label, type) },
                    impl: { wikidata_id: new Ast.Value.String(property) }
                };
                const elemType = getElementType(type);
                if (elemType.isString)
                    annotations.impl['string_values'] = new Ast.Value.String(`org.wikidata:${domainLabel}_${name}`);
                if (elemType.isEntity && elemType.type.startsWith('org.wikidata:'))
                    this._addEntity(type.type, titleCase(label), true);
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
                null, 'query', null, domainLabel, null, qualifiers, args, annotations);
        }

        const imports = [
            new Ast.ImportStmt.Mixin(null, ['loader'], 'org.thingpedia.v2', []),
            new Ast.ImportStmt.Mixin(null, ['config'], 'org.thingpedia.config.none', [])
        ];

        const classdef = new Ast.ClassDef(null, 'org.wikidata', null,
            { imports, queries, actions }, {
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
            data: this._entities
        }, undefined, 2));
        await StreamUtils.waitFinish(this._output);
        await StreamUtils.waitFinish(this._outputEntities);
    }
}


module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('wikidata-process-schema', {
            addHelp: true,
            description: "Generate schema.tt given a list of domains. "
        });
        parser.add_argument('-o', '--output', {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--entities', {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--domains', {
            required: true,
            help: 'domains (by item id) to include in the schema, split by comma (no space)'
        });
        parser.addArgument('--properties', {
            nargs: '+',
            required: false,
            help: 'properties to include for each domain, properties are split by comma (no space);\n' +
                'use "default" to include properties included in P1963 (properties of this type);\n' +
                'exclude a property by placing a minus sign before its id (no space)'
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
        parser.add_argument('--schemaorg-manifest', {
            required: false,
            help: 'Path to manifest.tt for schema.org; used for predict the type of wikidata properties'
        });
        parser.addArgument('--required-properties', {
            nargs: '+',
            required: false,
            help: 'the subset of properties that are required to be non-empty for all retrieved entities;\n' +
                'use "none" to indicate no required property needed;\n' +
                'use "default" to include properties included in P1963 (properties of this type);\n' +
                'exclude a property by placing a minus sign before its id (no space)'

        });
    },

    async execute(args) {
        const domains = args.domains.split(',');

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
        if (args.properties) {
            // if provided, property lists should match the number of domains
            assert(Array.isArray(args.properties) && args.properties.length === domains.length);
            for (let i = 0; i < domains.length; i++) {
                const domain = domains[i];
                const properties = args.properties[i].split(',');
                propertiesByDomain[domain] = await retrieveProperties(domain, properties);
            }
        } else {
            for (let domain of domains)
                propertiesByDomain[domain] = await getPropertyList(domain);
        }
        const schemaProcessor = new SchemaProcessor(
            domains, propertiesByDomain, requiredPropertiesByDomain, args.output, args.entities,
            args.manual, args.wikidata_labels, args.schemaorg_manifest
        );
        schemaProcessor.run();
    }
};
