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


import { Inflectors } from 'en-inflectors';
import * as Tp from 'thingpedia';
import { Type, Syntax, Ast } from 'thingtalk';
import * as fs from 'fs';
import util from 'util';

import { clean } from '../../../lib/utils/misc-utils';
import EnglishLanguagePack from '../../../lib/i18n/english';
import * as StreamUtils from '../../../lib/utils/stream-utils';

import genBaseCanonical from '../lib/base-canonical-generator';

import {
    BUILTIN_TYPEMAP,
    BLACKLISTED_TYPES,
    BLACKLISTED_PROPERTIES,
    STRUCTURED_HIERARCHIES,
    NON_STRUCT_TYPES,
    PROPERTY_CANONICAL_OVERRIDE,
    PROPERTY_NAME_OVERRIDE_BY_DOMAIN,
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_PROPERTY_CANONICAL_OVERRIDE_BY_DOMAIN,
    TABLE_CANONICAL_OVERRIDE,
    MANUAL_TABLE_CANONICAL_OVERRIDE,
    MANUAL_COUNTED_OBJECT_OVERRIDE,
    PROPERTY_FORCE_NOT_ARRAY,
    PROPERTY_FORCE_ARRAY,
    PROPERTY_TYPE_OVERRIDE,
    PROPERTIES_NO_FILTER,
    PROPERTIES_DROP_WITH_GEO,
    STRUCT_INCLUDE_THING_PROPERTIES,
    STRING_FILE_OVERRIDES
} from './manual-annotations';

const keepAnnotation = false;

function isHumanEntity(type) {
    if (type instanceof Type.Entity)
        return isHumanEntity(type.type);
    if (type instanceof Type.Array)
        return isHumanEntity(type.elem);
    if (typeof type !== 'string')
        return false;
    if (['tt:contact', 'tt:username', 'org.wikidata:human'].includes(type))
        return true;
    if (type.startsWith('org.schema') && type.endsWith(':Person'))
        return true;
    return false;
}

function getId(id) {
    if (id.startsWith('http://schema.org/'))
        id = id.substring('http://schema.org/'.length);
    // add "_" prefix for id starts with a number
    if (/^\d/.test(id))
        id = '_' + id;
    return id;
}

function getIncludes(includes) {
    if (Array.isArray(includes))
        return includes.map((incl) => getId(incl['@id']));
    else
        return [getId(includes['@id'])];
}

function getItemType(typename, typeHierarchy) {
    // use conventions on the typename to convert an array type to its element type

    for (let suffix of ['List', 'Collection', 'Section', 'Catalog']) {
        if (typename.endsWith(suffix)) {
            const itemname = typename.substring(0, typename.length - suffix.length);
            if (itemname in typeHierarchy)
                return itemname;
            else
                return 'Thing';
        }
    }

    console.error(`ItemList subclass ${typename} does not have a recognized suffix`);
    return 'Thing';
}

function recursiveAddStringValues(arg, fileId) {
    let type = arg.type;
    while (type.isArray)
        type = type.elem;

    if (fileId in PROPERTIES_NO_FILTER)
        return;

    if ((type.isEntity || type.isLocation) && STRING_FILE_OVERRIDES[fileId]) {
        arg.annotations['string_values'] = new Ast.Value.String(STRING_FILE_OVERRIDES[fileId]);
        return;
    }

    if (type.isString) {
        arg.annotations['string_values'] = new Ast.Value.String(STRING_FILE_OVERRIDES[fileId] || fileId);
        return;
    }

    if (type.isCompound) {
        for (let field in type.fields) {
            if (field.indexOf('.') >= 0)
                continue;
            recursiveAddStringValues(type.fields[field], fileId + '_' + field);
        }
    }
}

class SchemaProcessor {
    constructor(args) {
        this._domain = args.domain;
        this._output = args.output;
        this._cache = args.cache_file;
        this._className = args.class_name;
        this._url = args.url;
        this._manual = args.manual;
        this._always_base_canonical = args.always_base_canonical;
        this._hasGeo = false;
        this._prefix = `${this._className}:`;
        this._white_list = args.white_list.split(',');
        this._entities = [];

        this._wikidata_path = args.wikidata_path;
        this._wikidata_labels = {};

        this._langPack = new EnglishLanguagePack('en-US');
    }


    typeToThingTalk(propname, typename, typeHierarchy, manualAnnotation) {
        if (typename in BUILTIN_TYPEMAP)
            return BUILTIN_TYPEMAP[typename];

        if (typeHierarchy[typename].isItemList)
            return new Type.Array(this.typeToThingTalk(propname, typeHierarchy[typename].itemType, typeHierarchy, manualAnnotation));
        if (typeHierarchy[typename].isEnum && typeHierarchy[typename].enum.length > 0)
            return new Type.Enum(typeHierarchy[typename].enum);
        if (typeHierarchy[typename].representAsStruct)
            return this.makeCompoundType(propname, typename, typeHierarchy[typename], typeHierarchy, manualAnnotation);

        return new Type.Entity(this._prefix + typename);
    }

    getBestPropertyType(propname, property, typeHierarchy, manualAnnotation) {
        if (BLACKLISTED_PROPERTIES.has(propname))
            return [undefined, undefined];

        let best = undefined, bestScore = -Infinity;

        // if the property is defined as taking ItemList and something else, we make an array of that something else
        let isArray = property.types.some((type) => typeHierarchy[type] && typeHierarchy[type].isItemList);

        // if the property comment starts with "A " or "An ", we assume there can be multiple values
        // because if it starts with "The ", we assume it can only have one value
        // this is a pretty coarse heuristic, but it works sometimes...

        if (/^an? /i.test(property.comment))
            isArray = true;
        if (PROPERTY_FORCE_ARRAY.has(propname))
            isArray = true;
        if (PROPERTY_FORCE_NOT_ARRAY.has(propname))
            isArray = false;

        // prefer enum if possible
        // then specific data types
        // then fallback to a struct type if one is listed
        // then fallback to text if it's explicitly listed as one of the types
        // then fallback to an entity type

        for (let type of property.types) {
            let score;
            if (typeHierarchy[type] && typeHierarchy[type].isEnum)
                score = 5;
            else if (type === 'Text')
                score = 2;
            else if (type in BUILTIN_TYPEMAP)
                score = 4;
            else if (!typeHierarchy[type])
                score = -1;
            else if (typeHierarchy.isItemList) // ItemList and subclasses are useless
                score = 0;
            else if (typeHierarchy[type].representAsStruct)
                score = 3;
            else
                score = 1;

            if (score > bestScore) {
                best = type;
                bestScore = score;
            }
        }

        // if we didn't find a type we like, return nothing
        if (bestScore < 0)
            return [undefined, undefined];

        if (propname in PROPERTY_TYPE_OVERRIDE)
            return [best, PROPERTY_TYPE_OVERRIDE[propname]];

        // if we chose an item list as the best type, don't wrap into a further array
        if (typeHierarchy[best] && typeHierarchy[best].isItemList)
            isArray = false;

        // HACK
        if (best === 'QuantitativeValue') {
            if (/number/i.test(propname) || /level/i.test(propname) || /quantity/i.test(propname))
                return [best, Type.Number];
            if (/duration/i.test(propname))
                return [best, new Type.Measure('ms')];

            console.error(`Cannot guess the correct type of ${propname} of type QuantitativeValue, assuming Number`);
            return [best, Type.Number];
        }

        // HACK (version 9.0 has Organization over Person for author)
        if (propname === 'author')
            best = 'Person';

        let tttype = this.typeToThingTalk(propname, best, typeHierarchy, manualAnnotation);
        if (!tttype)
            return [undefined, undefined];

        if (tttype.isEntity && tttype.type.startsWith(this._prefix) && !this._entities.includes(tttype.type))
            this._entities.push(tttype.type);

        // an array of booleans or enums does not make much sense
        if (tttype.isBoolean || tttype.isEnum)
            isArray = false;

        if (isArray)
            tttype = new Type.Array(tttype);
        return [best, tttype];
    }

    loadPropertyNameOverride(argname) {
        if (PROPERTY_NAME_OVERRIDE_BY_DOMAIN[this._domain]) {
            if (argname in PROPERTY_NAME_OVERRIDE_BY_DOMAIN[this._domain])
                return PROPERTY_NAME_OVERRIDE_BY_DOMAIN[this._domain][argname];
            while (argname.includes('.')) {
                argname = argname.slice(argname.indexOf('.') + 1);
                if (argname in PROPERTY_NAME_OVERRIDE_BY_DOMAIN[this._domain])
                    return PROPERTY_NAME_OVERRIDE_BY_DOMAIN[this._domain][argname];
            }
        }
        return null;
    }

    makeCompoundType(parentPropertyName, startingTypename, typedef, typeHierarchy) {
        const fields = {};

        // collect all properties of this type (incl. inherited ones)
        let allproperties = new Map;
        function recursiveCollectProperties(typename) {
            //console.error(typename);
            const typedef = typeHierarchy[typename];
            if (!typedef)
                return;
            // if something is a subclass of both a struct and non-struct,
            // we ignore the properties coming from the non-struct side
            // (unless the leaf type name we're starting from is explicitly
            // marking as going all the way up)
            if (!STRUCT_INCLUDE_THING_PROPERTIES.has(startingTypename) && !typeHierarchy[typename].isStructSubType)
                return;
            for (let propertyname in typedef.properties) {
                const propertydef = typedef.properties[propertyname];
                if (allproperties.has(propertyname))
                    continue;
                allproperties.set(propertyname, propertydef);
            }
            // stop at the base struct types (so we don't include Thing properties)
            if (!STRUCT_INCLUDE_THING_PROPERTIES.has(startingTypename) && STRUCTURED_HIERARCHIES.indexOf(typename) >= 0)
                return;

            for (let _extends of typeHierarchy[typename].extends)
                recursiveCollectProperties(_extends);
        }
        recursiveCollectProperties(startingTypename);

        let anyfield = false;
        for (const [propertyname, propertydef] of allproperties) {
            const [schemaOrgType, ttType] = this.getBestPropertyType(propertyname, propertydef, typeHierarchy);
            if (!ttType)
                continue;

            const metadata = {};
            const annotation = keepAnnotation ? {
                'org_schema_type': new Ast.Value.String(schemaOrgType),
                'org_schema_comment': new Ast.Value.String(propertydef.comment)
            } : {
                'org_schema_type': new Ast.Value.String(schemaOrgType)
            };

            if (propertyname.endsWith('ratingValue')) {
                annotation['min_number'] = new Ast.Value.Number(1);
                annotation['max_number'] = new Ast.Value.Number(5);
            }

            if (this._manual && propertyname in MANUAL_COUNTED_OBJECT_OVERRIDE)
                metadata.counted_object = MANUAL_COUNTED_OBJECT_OVERRIDE[propertyname];
            else if (propertyname.startsWith('numberOf'))
                metadata.counted_object = [ clean(propertyname.slice('numberOf'.length)) ];
            else if (/num[A-Z].*/.test(propertyname))
                metadata.counted_object = [ clean(propertyname.slice('num'.length)) ];
            else if (propertyname.endsWith('Count'))
                metadata.counted_object = [ this._langPack.pluralize(clean(propertyname.slice(0, -'Count'.length)))];

            if (PROPERTIES_NO_FILTER.includes(propertyname)) {
                annotation['filterable'] = new Ast.Value.Boolean(false);
            } else if (this._hasGeo && PROPERTIES_DROP_WITH_GEO.includes(propertyname)) {
                annotation['filterable'] = new Ast.Value.Boolean(false);
                annotation['drop'] = new Ast.Value.Boolean(true);
            }

            const adjustedname = Syntax.KEYWORDS.has(propertyname) ? propertyname + '_' : propertyname;
            fields[adjustedname] = new Ast.ArgumentDef(null, null, adjustedname, ttType, {
                nl: metadata,
                impl: annotation
            });
            anyfield = true;
        }
        if (!anyfield)
            throw new Error(`Struct type ${startingTypename} has no fields`);

        return new Type.Compound(startingTypename, fields);
    }

    loadPropertyCanonicalOverride(name) {
        // 1. check for domain-specific manual property override
        if (this._manual && this._domain && this._domain in MANUAL_PROPERTY_CANONICAL_OVERRIDE_BY_DOMAIN
            && name in MANUAL_PROPERTY_CANONICAL_OVERRIDE_BY_DOMAIN[this._domain])
            return MANUAL_PROPERTY_CANONICAL_OVERRIDE_BY_DOMAIN[this._domain][name];

        // 2. check for global manual property override
        if (this._manual && name in MANUAL_PROPERTY_CANONICAL_OVERRIDE)
            return MANUAL_PROPERTY_CANONICAL_OVERRIDE[name];

        // 3. check default property type override (which is applied even for baseline)
        if (name in PROPERTY_CANONICAL_OVERRIDE)
            return PROPERTY_CANONICAL_OVERRIDE[name];

        // for compound properties, also search by field names
        if (name.includes('.'))
            return this.loadPropertyCanonicalOverride(name.slice(name.indexOf('.') + 1));

        return null;
    }

    addCanonicalAnnotations(classDef) {
        for (let fname in classDef.queries) {
            for (let arg of classDef.queries[fname].iterateArguments()) {
                if (arg.name === 'id')
                    continue;
                arg.metadata.canonical = this.makeArgCanonical(classDef.queries[fname], arg.name, arg.type);
                let elemType = arg.type;
                while (elemType.isArray)
                    elemType = elemType.elem;
                if (elemType.isCompound) {
                    for (let fieldname in elemType.fields) {
                        let field = elemType.fields[fieldname];
                        field.metadata.canonical = this.makeArgCanonical(classDef.queries[fname], `${arg.name}.${field.name}`, field.type);
                    }
                }
            }
        }
    }

    makeArgCanonical(functionDef, argname, ptype) {
        function cleanName(name) {
            name = clean(name);
            if (name.endsWith(' value'))
                return name.substring(0, name.length - ' value'.length);
            return name;
        }

        let canonical = this.loadPropertyCanonicalOverride(argname);
        if (canonical)
            return canonical;

        const name = this.loadPropertyNameOverride(argname) || argname.slice(argname.lastIndexOf('.') + 1);

        canonical = {};
        const candidates = name in this._wikidata_labels ? this._wikidata_labels[name].labels : [name];
        for (let candidate of [...new Set(candidates)])
            this.addOneCanonical(canonical, candidate, ptype, functionDef);
        if (!("base" in canonical) && this._always_base_canonical)
            canonical["base"] = [cleanName(name)];

        if (isHumanEntity(ptype)) {
            const singular = (new Inflectors(canonical.base[0])).toSingular();
            const past = (new Inflectors(singular).toPast());
            canonical.reverse_verb = [past];
        }

        return canonical;
    }

    addOneCanonical(canonical, name, ptype, functionDef) {
        // drop all names with char other than letters
        if (!/^[a-zA-Z ]+$/.test(name))
            return;

        genBaseCanonical(canonical, name, ptype, functionDef);
    }

    async run() {
        let schemajsonld;
        if (await util.promisify(fs.exists)(this._cache)) {
            schemajsonld = await util.promisify(fs.readFile)(this._cache, { encoding: 'utf8' });
        } else {
            schemajsonld = await Tp.Helpers.Http.get(this._url);
            await util.promisify(fs.writeFile)(this._cache, schemajsonld);
        }

        if (this._wikidata_path)
            this._wikidata_labels = JSON.parse(await (util.promisify(fs.readFile))(this._wikidata_path, { encoding: 'utf8' }));

        // type_name -> {
        //    extends: [type_name],
        //    properties: { name -> { types: [type], comment: ... } },
        //    comment: ...
        // }
        const typeHierarchy = {};
        function ensureType(typename) {
            if (typeHierarchy[typename])
                return;
            typeHierarchy[typename] = {
                extends: [],
                properties: {},
                comment: ''
            };
        }
        function isSubClass(typename, subtypeof) {
            for (let _extend of typeHierarchy[typename].extends) {
                if (_extend === subtypeof)
                    return true;

                if (!typeHierarchy[_extend])
                    continue;
                if (isSubClass(_extend, subtypeof))
                    return true;
            }
            return false;
        }

        const enums = {};
        function ensureEnum(enumname) {
            if (enums[enumname])
                return;
            enums[enumname] = [];
        }

        for (let triple of JSON.parse(schemajsonld)['@graph']) {
            try {
                if (getId(triple['@id']) in BUILTIN_TYPEMAP)
                    continue;

                if (BLACKLISTED_TYPES.has(getId(triple['@id'])))
                    continue;

                if (!Array.isArray(triple['@type']))
                    triple['@type'] = [triple['@type']];

                for (let type of triple['@type']) {
                    if (type.startsWith('http://schema.org/')) {
                        // an enum declaration
                        const enumtype = getId(type);
                        const enumvalue = getId(triple['@id']);
                        ensureEnum(enumtype);
                        enums[enumtype].push(enumvalue);
                        continue;
                    }

                    switch (type) {
                    case 'rdf:Property': {
                        // ignore deprecated stuff
                        if (triple['http://schema.org/supersededBy'])
                            continue;


                        const domains = getIncludes(triple['http://schema.org/domainIncludes']);
                        const ranges = getIncludes(triple['http://schema.org/rangeIncludes']);
                        const name = getId(triple['@id']);
                        const comment = triple['rdfs:comment'];

                        if (BLACKLISTED_PROPERTIES.has(name))
                            continue;

                        for (let domain of domains) {
                            if (domain in BUILTIN_TYPEMAP)
                                continue;
                            if (BLACKLISTED_TYPES.has(domain))
                                continue;

                            ensureType(domain);
                            typeHierarchy[domain].properties[name] = {
                                types: ranges,
                                comment
                            };
                        }
                        break;
                    }
                    case 'rdfs:Class': {
                        const name = getId(triple['@id']);
                        const comment = triple['rdfs:comment'];
                        const _extends = getIncludes(triple['rdfs:subClassOf'] || []);
                        ensureType(name);
                        if (_extends.length > 0 && _extends.every((ex) => ex in BUILTIN_TYPEMAP)) {
                            BLACKLISTED_TYPES.add(name);
                            delete typeHierarchy[name];
                            break;
                        }
                        typeHierarchy[name].extends = _extends.filter((ex) => !BLACKLISTED_TYPES.has(ex));
                        if (typeHierarchy[name].extends.length === 0 && name !== 'Thing')
                            typeHierarchy[name].extends = ['Thing'];
                        typeHierarchy[name].comment = comment;
                        break;
                    }
                    default:
                        throw new Error(`don't know how to handle a triple of type ${type}`); //'
                    }
                }
            } catch(e) {
                console.error('Triple failed');
                console.error(triple);
                throw e;
            }
        }


        for (let type in typeHierarchy) {
            typeHierarchy[type].isAction = isSubClass(type, 'Action');
            typeHierarchy[type].isEnum = !!enums[type] || isSubClass(type, 'Enumeration');
            if (typeHierarchy[type].isEnum)
                typeHierarchy[type].enum = enums[type] || [];

            typeHierarchy[type].isItemList = isSubClass(type, 'ItemList');
            if (typeHierarchy[type].isItemList)
                typeHierarchy[type].itemType = getItemType(type, typeHierarchy);

            if (STRUCTURED_HIERARCHIES.indexOf(type) >= 0) {
                typeHierarchy[type].isStructSubType = true;
                typeHierarchy[type].representAsStruct = true;
            } else {
                for (let structBase of STRUCTURED_HIERARCHIES) {
                    if (isSubClass(type, structBase)) {
                        typeHierarchy[type].isStructSubType = true;
                        typeHierarchy[type].representAsStruct = true;
                        break;
                    }
                }
            }

            if (NON_STRUCT_TYPES.has(type)) {
                typeHierarchy[type].isStructSubType = false;
                typeHierarchy[type].representAsStruct = false;
            }
        }

        function findCycle(typename, lookfor, visited, cycle = []) {
            if (visited.has(typename)) {
                if (typename === lookfor)
                    console.error('Found cycle for ' + typename, cycle, visited);
                return typename === lookfor;
            }
            visited.add(typename);

            for (let propname in typeHierarchy[typename].properties) {
                let propdef = typeHierarchy[typename].properties[propname];
                for (let type of propdef.types) {
                    if (type in BUILTIN_TYPEMAP)
                        continue;
                    if (!typeHierarchy[type] || !typeHierarchy[type].representAsStruct)
                        continue;
                    cycle.push(propname);
                    if (findCycle(type, lookfor, visited, cycle))
                        return true;
                    cycle.pop();
                }
            }
            return false;
        }

        // check all types - if they form a cycle, we cannot represent them as structs
        for (let typename in typeHierarchy) {
            if (typeHierarchy[typename].isEnum)
                continue;
            if (!typeHierarchy[typename].representAsStruct)
                continue;
            if (findCycle(typename, typename, new Set))
                typeHierarchy[typename].representAsStruct = false;
        }

        // check all types - all parents of non-struct types must also be non-struct types,
        // recursively
        function recursiveMakeNonStruct(typename) {
            typeHierarchy[typename].representAsStruct = false;
            for (let _extend of typeHierarchy[typename].extends) {
                if (!typeHierarchy[_extend])
                    continue;
                recursiveMakeNonStruct(_extend);
            }
        }

        for (let typename in typeHierarchy) {
            if (typeHierarchy[typename].isEnum)
                continue;
            if (typeHierarchy[typename].representAsStruct)
                continue;
            recursiveMakeNonStruct(typename);
        }

        //console.log(JSON.stringify(typeHierarchy, undefined, 2));

        const order = new Set;

        function toposort(typename) {
            if (typeHierarchy[typename].isAction || typeHierarchy[typename].isEnum ||
                typeHierarchy[typename].representAsStruct)
                return;

            for (let _extend of typeHierarchy[typename].extends) {
                if (!typeHierarchy[_extend])
                    continue;
                toposort(_extend);
            }

            order.add(typename);
        }
        for (let type in typeHierarchy) {
            if (order.has(type))
                continue;
            toposort(type);
        }

        const queries = {};
        for (let typename of order) {
            const typedef = typeHierarchy[typename];

            // do not generate a class for ItemList and subclasses
            if (typename === 'ItemList' || typedef.isItemList)
                continue;

            const args = [
                new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, 'id', new Type.Entity(this._prefix + typename), {
                    nl: { canonical: { base: ['name'], passive_verb: ['called', 'named'] } },
                    impl: {
                        'unique': new Ast.Value.Boolean(true),
                        'filterable': new Ast.Value.Boolean(true)
                    }
                })
            ];
            recursiveAddStringValues(args[0], this._prefix + typename + '_name');
            if (typename !== 'Thing') {
                // override name for each table so we can apply a custom string_values annotation
                // name is preserved to determine if the table has name and id has ner support
                // it will be removed during trimming
                const arg = new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, 'name', Type.String, {
                    nl: {},
                    impl: {
                        'org_schema_type': new Ast.Value.String('Text'),
                        'filterable': new Ast.Value.Boolean(true)
                    }
                });
                recursiveAddStringValues(arg, this._prefix + typename + '_name');
                args.push(arg);
            }

            this._hasGeo = 'geo' in typedef.properties;
            for (const propertyname in typedef.properties) {
                const propertydef = typedef.properties[propertyname];
                const [schemaOrgType, type] = this.getBestPropertyType(propertyname, propertydef, typeHierarchy);
                if (!type)
                    continue;

                const metadata = {};
                const annotation = keepAnnotation ? {
                    'org_schema_type': new Ast.Value.String(schemaOrgType),
                    'org_schema_comment': new Ast.Value.String(propertydef.comment)
                } : {
                    'org_schema_type': new Ast.Value.String(schemaOrgType)
                };

                if (PROPERTIES_NO_FILTER.includes(propertyname))
                    annotation['filterable'] = new Ast.Value.Boolean(false);

                if (this._manual && propertyname in MANUAL_COUNTED_OBJECT_OVERRIDE)
                    metadata.counted_object = MANUAL_COUNTED_OBJECT_OVERRIDE[propertyname];
                else if (propertyname.startsWith('numberOf'))
                    metadata.counted_object = [ clean(propertyname.slice('numberOf'.length)) ];
                else if (propertyname.startsWith('num') && propertyname.charAt(3) === propertyname.charAt(3).toUpperCase())
                    metadata.counted_object = [ clean(propertyname.slice('num'.length)) ];
                else if (propertyname.endsWith('Count'))
                    metadata.counted_object = [ this._langPack.pluralize(clean(propertyname.slice(0, -'Count'.length)))];

                const adjustedname = Syntax.KEYWORDS.has(propertyname) ? propertyname + '_' : propertyname;
                const arg = new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, adjustedname, type, {
                    nl: metadata,
                    impl: annotation
                });
                recursiveAddStringValues(arg, this._prefix + typename + '_' + propertyname);

                args.push(arg);
            }

            let query_canonical;
            if (this._manual && typename in MANUAL_TABLE_CANONICAL_OVERRIDE)
                query_canonical = MANUAL_TABLE_CANONICAL_OVERRIDE[typename];
            else if (typename in TABLE_CANONICAL_OVERRIDE)
                query_canonical = TABLE_CANONICAL_OVERRIDE[typename];
            else
                query_canonical = clean(typename);

            queries[typename] = new Ast.FunctionDef(null, 'query', null /* class */, typename,
                typedef.extends, {
                    is_list: true,
                    is_monitorable: false,
                }, args, {
                    nl: {
                        'canonical': query_canonical,
                        'confirmation': clean(typename),
                    },
                    impl: keepAnnotation ? {
                        'org_schema_comment': new Ast.Value.String(typedef.comment),
                        'confirm': new Ast.Value.Boolean(false)
                    } : {
                        'confirm': new Ast.Value.Boolean(false)
                    },
                    minimal_projection: new Ast.Value.Array([ new Ast.Value.String('id') ])
                });
        }

        const imports = [
            new Ast.MixinImportStmt(null, ['loader'], 'org.thingpedia.v2', []),
            new Ast.MixinImportStmt(null, ['config'], 'org.thingpedia.config.none', [])
        ];

        const entities = this._entities.map((entityType) => {
            const name = entityType.slice(this._prefix.length);
            return new Ast.EntityDef(null, name, null, {});
        });

        const classdef = new Ast.ClassDef(null,
            `${this._className}`,
            [], { queries, imports, entities }, {
            nl: {
                name: `${this._className.slice(this._className.lastIndexOf('.') + 1)} in Schema.org`,
                description: 'Scraped data from websites that support schema.org'
            },
            impl: {
                whitelist: new Ast.Value.Array(
                    this._white_list.map((q) => new Ast.Value.String(q.trim()))
                )
            }
        }, {
            is_abstract: false
        });

        this.addCanonicalAnnotations(classdef);

        this._output.end(classdef.prettyprint());
        await StreamUtils.waitFinish(this._output);
    }

}


export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('schemaorg-process-schema', {
        add_help: true,
        description: "Process a schema.org JSON+LD definition into a Thingpedia class."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--cache-file', {
        required: false,
        default: './schema.jsonld',
        help: 'Path to a cache file containing the schema.org definitions.'
    });
    parser.add_argument('--url', {
        required: false,
        default: 'https://raw.githubusercontent.com/schemaorg/schemaorg/main/data/releases/9.0/schemaorg-current-http.jsonld',
        help: 'The schema.org URL to retrieve the definitions from.'
    });
    parser.add_argument('--domain', {
        required: false,
        help: 'The domain of current experiment, used for domain-specific manual overrides.'
    });
    parser.add_argument('--manual', {
        action: 'store_true',
        help: 'Enable manual annotations.',
        default: false
    });
    parser.add_argument('--wikidata-path', {
        required: false,
        help: 'path to the json file with wikidata property labels'
    });
    parser.add_argument('--always-base-canonical', {
        action: 'store_true',
        help: `Always generate base canonical`,
        default: true
    });
    parser.add_argument('--no-always-base-canonical', {
        action: 'store_false',
        help: `Do not always generate base canonical`,
        dest: `always_base_canonical`,
    });
    parser.add_argument('--class-name', {
        required: false,
        help: 'The name of the generated class, this will also affect the entity names',
        default: 'org.schema'
    });
    parser.add_argument('--white-list', {
        required: true,
        help: 'A list of queries allowed to use in the class, split by comma (no space).'
    });
}

export async function execute(args) {
    const schemaProcessor = new SchemaProcessor(args);
    schemaProcessor.run();
}
