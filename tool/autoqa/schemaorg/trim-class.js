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


import assert from 'assert';
import * as ThingTalk from 'thingtalk';
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
import * as fs from 'fs';
import util from 'util';

import * as StreamUtils from '../../../lib/utils/stream-utils';
import {
    WHITELISTED_PROPERTIES_BY_DOMAIN,
    BLACKLISTED_PROPERTIES_BY_DOMAIN,
    PROPERTIES_DROP_WITH_GEO,
    STRING_FILE_OVERRIDES
} from './manual-annotations';

import { titleCase, DEFAULT_ENTITIES } from '../lib/utils';

async function loadClassDef(thingpedia) {
    const library = ThingTalk.Syntax.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
    assert(library instanceof ThingTalk.Ast.Library && library.classes.length === 1);
    return library.classes[0];
}

class SchemaTrimmer {
    constructor(classDef, data, entities, domain) {
        this._classDef = classDef;
        this._className = classDef.name;
        this._data = data;
        this._entities = entities;

        this._propertyWhitelist = domain ? WHITELISTED_PROPERTIES_BY_DOMAIN[domain] : null;
        this._propertyBlacklist = domain ? BLACKLISTED_PROPERTIES_BY_DOMAIN[domain] : null;
    }

    get class() {
        return this._classDef;
    }

    trim() {
        for (let tablename in this._classDef.queries)
            this._maybeMarkTableWithData(tablename);

        for (let tablename in this._classDef.queries)
            this._removeArgumentsWithoutData(tablename);

        this._updateEntityDeclarations();
    }

    _markHasData(annotations) {
        if (!annotations.org_schema_has_data)
            annotations.org_schema_has_data = new Ast.Value.Boolean(true);
    }

    _markTableHasData(tabledef) {
        this._markHasData(tabledef.annotations);
        this._markHasData(tabledef.getArgument('id').annotations);

        // if a table has data, then recursively all parents have data (= they should be included)
        for (let _extend of tabledef.extends)
            this._markTableHasData(tabledef.class.queries[_extend]);
    }

    _markTableHasName(tabledef) {
        if (!tabledef.annotations.org_schema_has_name)
            tabledef.annotations.org_schema_has_name = new Ast.Value.Boolean(true);

        // if a table has data, then recursively all parents have data (= they should be included)
        for (let _extend of tabledef.extends)
            this._markTableHasName(tabledef.class.queries[_extend]);
    }

    _markArgumentHasData(arg, value) {
        if (value === null || value === undefined ||
            (Array.isArray(value) && value.length === 0))
            return false;

        if (Array.isArray(value)) {
            for (let elem of value) {
                if (this._markArgumentHasData(arg, elem))
                    return true;
            }
            return false;
        }

        let type = arg.type;
        while (type.isArray)
            type = type.elem;

        if (type.isCompound) {
            let hasAny = false;
            for (let fieldname in type.fields) {
                if (this._markArgumentHasData(type.fields[fieldname], value[fieldname]))
                    hasAny = true;
            }
            if (hasAny) {
                this._markHasData(arg.annotations);
                return true;
            } else {
                return false;
            }
        } else {
            this._markHasData(arg.annotations);
            return true;
        }
    }

    _markObjectHasData(tabledef, obj) {
        for (let key in obj) {
            if (key === '@id' || key === '@type' || key === '@context')
                continue;
            if (key === 'name' && obj[key] && obj[key].length)
                this._markTableHasName(tabledef);

            const arg = tabledef.getArgument(key);
            if (!arg)
                throw new Error(`Unexpected field ${key} in ${tabledef.name}, data is not normalized`);
            this._markArgumentHasData(arg, obj[key]);

            for (let _extend of tabledef.extends) {
                let parent = tabledef.class.queries[_extend];
                if (parent.args.includes(key))
                    this._markArgumentHasData(parent.getArgument(key), obj[key]);
            }
        }
    }

    _maybeMarkTableWithData(tablename) {
        let tabledef = this._classDef.queries[tablename];
        const data = this._data[tabledef.name];

        for (let objId in data) {
            // if we enter the loop, we have at least one element of this table
            this._markTableHasData(tabledef);

            const obj = data[objId];
            this._markObjectHasData(tabledef, obj);
        }
    }

    _removeFieldsWithoutData(arg, prefix='') {
        let type = arg.type;
        while (type.isArray)
            type = type.elem;

        if (!type.isCompound)
            return;

        prefix = prefix + `${arg.name}.`;

        for (let fieldname in type.fields) {
            const field = type.fields[fieldname];
            if (this._whiteListed(`${prefix}${fieldname}`))
                continue;
            if (!field.annotations['org_schema_has_data']
                || !field.annotations['org_schema_has_data'].value
                || this._blackListed(`${prefix}${fieldname}`)) {
                delete type.fields[fieldname];
                continue;
            }

            this._removeFieldsWithoutData(field, prefix);
        }
    }

    _removeArgumentsWithoutData(tablename) {
        let tabledef = this._classDef.queries[tablename];
        if (!tabledef.annotations['org_schema_has_data'] || !tabledef.annotations['org_schema_has_data'].value) {
            this._entities.push({
                type: this._className + ':' + tablename,
                name: titleCase(Array.isArray(tabledef.canonical) ? tabledef.canonical[0] : tabledef.canonical),
                is_well_known: false,
                has_ner_support: false
            });
            delete this._classDef.queries[tablename];
            return;
        }

        const hasName = !!tabledef.getImplementationAnnotation('org_schema_has_name');
        this._entities.push({
            type: this._className + ':' + tablename,
            name: titleCase(Array.isArray(tabledef.canonical) ? tabledef.canonical[0] : tabledef.canonical),
            is_well_known: false,
            has_ner_support: hasName
        });

        let newArgs = [];
        let hasAddress = false;
        let hasGeo = false;
        for (let argname of tabledef.args) {
            if (argname === 'name')
                continue;
            if (argname.indexOf('.') >= 0)
                continue;
            const arg = tabledef.getArgument(argname);

            // set id to non-filterable for table without name (e.g., Review)
            if (argname === 'id' && !hasName)
                arg.impl_annotations.filterable = new Ast.Value.Boolean(false);

            if (!this._whiteListed(argname)) {
                if (!(arg.annotations['org_schema_has_data'] && arg.annotations['org_schema_has_data'].value))
                    continue;
            }

            if (this._blackListed(argname))
                continue;

            this._removeFieldsWithoutData(arg);

            newArgs.push(arg);

            if (argname === 'address')
                hasAddress = arg;
            if (argname === 'geo')
                hasGeo = arg;
        }

        if (tabledef.args.includes('geo') && hasAddress && !hasGeo) {
            const implAnnotations = {
                org_schema_type: new Ast.Value.String('GeoCoordinates'),
                org_schema_has_data: new Ast.Value.Boolean(false)
            };
            const stringfileId = `${this._className}:${tablename}_geo`;
            if (stringfileId in STRING_FILE_OVERRIDES)
                implAnnotations.string_values = new Ast.Value.String(STRING_FILE_OVERRIDES[stringfileId]);
            const arg = new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, 'geo', Type.Location, {
                nl: {
                    canonical: { base:["location", "address"] }
                },
                impl: implAnnotations
            });
            newArgs.push(arg);
            hasGeo = arg;
        }

        // remove streetAddress & addressLocality if we already have geo
        if (hasAddress && hasGeo) {
            for (let field of PROPERTIES_DROP_WITH_GEO)
                delete hasAddress.type.fields[field];
        }
        if (tabledef.hasArgument('address') && tabledef.hasArgument('geo')) {
            for (let _extend of tabledef.extends) {
                if (_extend in this._classDef.queries) {
                    const parent = this._classDef.queries[_extend];
                    const address = parent.getArgument('address');
                    if (address) {
                        for (let field of PROPERTIES_DROP_WITH_GEO)
                            delete address.type.fields[field];
                    }
                }
            }
        }

        this._classDef.queries[tablename] = new Ast.FunctionDef(null, 'query', this._classDef,
            tablename, tabledef.extends, tabledef._qualifiers, newArgs, {
                nl: tabledef.metadata,
                impl: tabledef.annotations,
            });
    }

    _updateEntityDeclarations() {
        const usedEntities = new Set();

        for (let tablename in this._classDef.queries) {
            for (let arg of this._classDef.queries[tablename].iterateArguments()) {
                if (arg.type.isEntity && arg.type.type.startsWith(this._className))
                    usedEntities.add(arg.type.type.slice(`${this._className}:`.length));
            }
        }

        this._classDef.entities = Array.from(usedEntities).map((name) => {
            let hasNER = false;
            if (name in this._classDef.queries)
                hasNER = !!this._classDef.queries[name].getImplementationAnnotation('org_schema_has_name');
            return new Ast.EntityDef(null, name, null, { impl : { has_ner: new Ast.Value.Boolean(hasNER) }});
        });
    }

    _whiteListed(property) {
        return this._propertyWhitelist && this._propertyWhitelist.includes(property);
    }

    _blackListed(property) {
        return this._propertyBlacklist && this._propertyBlacklist.includes(property);
    }
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('schemaorg-trim-class', {
        add_help: true,
        description: "Reduce a schema.org class file to the subset of fields that have data."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--entities', {
        required: true,
        help: 'Where to store the generated entities.json file',
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--data', {
        required: true,
        help: 'Path to JSON file with normalized WebQA data.'
    });
    parser.add_argument('--domain', {
        required: false,
        help: 'The domain of current experiment, used for domain-specific manual overrides.'
    });
    parser.add_argument('--debug', {
        action: 'store_true',
        help: 'Enable debugging.',
        default: true
    });
    parser.add_argument('--no-debug', {
        action: 'store_false',
        dest: 'debug',
        help: 'Disable debugging.',
    });
}

export async function execute(args) {
    const classDef = await loadClassDef(args.thingpedia);
    const data = JSON.parse(await util.promisify(fs.readFile)(args.data, { encoding: 'utf8' }));
    const entities = DEFAULT_ENTITIES.slice();

    const trimmer = new SchemaTrimmer(classDef, data, entities, args.domain);
    trimmer.trim();

    args.output.end(trimmer.class.prettyprint());
    await StreamUtils.waitFinish(args.output);
    await util.promisify(fs.writeFile)(args.entities, JSON.stringify({
        result: 'ok',
        data: entities
    }, undefined, 2));
}
