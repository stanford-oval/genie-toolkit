// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const Inflectors = require('en-inflectors').Inflectors;
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;
const Ast = ThingTalk.Ast;
const fs = require('fs');
const util = require('util');

const { clean, pluralize, isHumanEntity, posTag } = require('../lib/utils');
const StreamUtils = require('../lib/stream-utils');

const {
    BUILTIN_TYPEMAP,
    BLACKLISTED_TYPES,
    BLACKLISTED_PROPERTIES,
    STRUCTURED_HIERARCHIES,
    NON_STRUCT_TYPES,
    PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_TABLE_CANONICAL_OVERRIDE,
    PROPERTY_FORCE_NOT_ARRAY,
    PROPERTY_FORCE_ARRAY,
    PROPERTY_TYPE_OVERRIDE,
    PROPERTIES_NO_FILTER,
    PROPERTIES_DROP_WITH_GEO,
    STRUCT_INCLUDE_THING_PROPERTIES,
    STRING_FILE_OVERRIDES
} = require('./lib/webqa-manual-annotations');

const keepAnnotation = false;

function getId(id) {
    assert(id.startsWith('http://schema.org/'));
    return id.substring('http://schema.org/'.length);
}

function getIncludes(includes) {
    if (Array.isArray(includes))
        return includes.map((incl) => getId(incl['@id']));
    else
        return [getId(includes['@id'])];
}

const KEYWORDS = [
    'let', 'now', 'new', 'as', 'of', 'in', 'out', 'req', 'opt', 'notify', 'return',
    'join', 'edge', 'monitor', 'class', 'extends', 'mixin', 'this', 'import', 'null',
    'enum', 'aggregate', 'dataset', 'oninput', 'sort', 'asc', 'desc', 'bookkeeping',
    'compute', 'true', 'false'
];

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

    if (type.isEntity && STRING_FILE_OVERRIDES[fileId]) {
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
        this._output = args.output;
        this._cache = args.cache_file;
        this._className = args.class_name;
        this._url = args.url;
        this._manual = args.manual;
        this._always_base_canonical = args.always_base_canonical;
        this._hasGeo = false;
        this._prefix = `${this._className}:`;
        this._white_list = args.white_list.split(',');

        this._wikidata_path = args.wikidata_path;
        this._wikidata_labels = {};
    }


    typeToThingTalk(typename, typeHierarchy, manualAnnotation) {
        if (typename in BUILTIN_TYPEMAP)
            return BUILTIN_TYPEMAP[typename];

        if (typeHierarchy[typename].isItemList)
            return Type.Array(this.typeToThingTalk(typeHierarchy[typename].itemType, typeHierarchy, manualAnnotation));
        if (typeHierarchy[typename].isEnum && typeHierarchy[typename].enum.length > 0)
            return Type.Enum(typeHierarchy[typename].enum);
        if (typeHierarchy[typename].representAsStruct)
            return this.makeCompoundType(typename, typeHierarchy[typename], typeHierarchy, manualAnnotation);

        return Type.Entity(this._prefix + typename);
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
                return [best, Type.Measure('ms')];

            console.error(`Cannot guess the correct type of ${propname} of type QuantitativeValue, assuming Number`);
            return [best, Type.Number];
        }

        let tttype = this.typeToThingTalk(best, typeHierarchy, manualAnnotation);
        if (!tttype)
            return [undefined, undefined];

        // an array of booleans or enums does not make much sense
        if (tttype.isBoolean || tttype.isEnum)
            isArray = false;

        if (isArray)
            tttype = Type.Array(tttype);
        return [best, tttype];
    }

    makeCompoundType(startingTypename, typedef, typeHierarchy) {
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
        for (let [propertyname, propertydef] of allproperties) {
            const [schemaOrgType, ttType] = this.getBestPropertyType(propertyname, propertydef, typeHierarchy);
            if (!ttType)
                continue;

            const canonical = this.makeArgCanonical(propertyname, ttType);
            const metadata = { canonical };
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

            if (propertyname.startsWith('numberOf'))
                metadata.counted_object = [ clean(propertyname.slice('numberOf'.length)) ];
            if (propertyname.endsWith('Count'))
                metadata.counted_object = [ pluralize(clean(propertyname.slice(0, -'Count'.length)))];

            if (PROPERTIES_NO_FILTER.includes(propertyname)) {
                annotation['filterable'] = new Ast.Value.Boolean(false);
            } else if (this._hasGeo && PROPERTIES_DROP_WITH_GEO.includes(propertyname)) {
                annotation['filterable'] = new Ast.Value.Boolean(false);
                annotation['drop'] = new Ast.Value.Boolean(true);
            }

            fields[propertyname] = new Ast.ArgumentDef(null, undefined, propertyname, ttType, {
                nl: metadata,
                impl: annotation
            });
            anyfield = true;
        }
        if (!anyfield)
            throw new Error(`Struct type ${startingTypename} has no fields`);

        return Type.Compound(startingTypename, fields);
    }

    makeArgCanonical(name, ptype) {
        function cleanName(name) {
            name = clean(name);
            if (name.endsWith(' value'))
                return name.substring(0, name.length - ' value'.length);
            return name;
        }

        if (name in PROPERTY_CANONICAL_OVERRIDE)
            return PROPERTY_CANONICAL_OVERRIDE[name];
        if (this._manual && name in MANUAL_PROPERTY_CANONICAL_OVERRIDE)
            return MANUAL_PROPERTY_CANONICAL_OVERRIDE[name];

        let canonical = {};

        const candidates = name in this._wikidata_labels ? this._wikidata_labels[name].labels : [cleanName(name)];
        for (let candidate of [...new Set(candidates)])
            this.addCanonical(canonical, candidate, ptype);
        if (!("base" in canonical) && this._always_base_canonical)
            canonical["base"] = [cleanName(name)];

        if (isHumanEntity(ptype)) {
            const singular = (new Inflectors(canonical.base[0])).toSingular();
            const past = (new Inflectors(singular).toPast());
            canonical.reverse_verb = [past];
        }

        return canonical;
    }

    addCanonical(canonical, name, ptype) {
        name = name.toLowerCase();
        // drop all names with char other than letters
        if (!/^[a-z ]+$/.test(name))
            return;

        if (ptype && ptype.isArray)
            name = pluralize(name);

        if (name.endsWith(' content') && ptype.isMeasure) {
            name = name.substring(0, name.length - ' content'.length);
            let base = [name + ' content', name, name + ' amount'];
            let verb = ['contains #' + name.replace(/ /g, '_')];
            canonical.verb = (canonical.verb || []).concat(verb);
            canonical.base = (canonical.base || []).concat(base);
        } else if (name.startsWith('has ')) {
            name = [name.substring('has '.length)];
            canonical.base = (canonical.base || [] ).concat(name);
        } else if (name.startsWith('is ')) {
            name = name.substring('is '.length);
            let tags = posTag(name.split(' '));

            if (['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[tags.length - 1]) || name.endsWith(' of'))
                canonical.reverse_property = (canonical.reverse_property || []).concat([name]);
            else if (['VBN', 'JJ', 'JJR'].includes(tags[0]))
                canonical.passive_verb = (canonical.passive_verb || []).concat([name]);
        } else {
            let tags = posTag(name.split(' '));
            if (['VBP', 'VBZ', 'VBD'].includes(tags[0])) {
                if (tags.length === 2 && ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[1])) {
                    canonical.verb = (canonical.verb || []).concat([name.replace(' ', ' # ')]);
                    canonical.base = (canonical.base || []).concat([name.split(' ')[1]]);
                } else {
                    canonical.verb = (canonical.verb || []).concat([name]);
                }
            } else if (name.endsWith(' of')) {
                let noun = name.slice(0, -' of'.length);
                let canonicals = [name, `# ${noun}`, `# 's ${noun}`];
                canonical.reverse_property = (canonical.reverse_property || []).concat(canonicals);
            } else if (tags.length === 2 && tags[0] === 'IN' && ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[1])) {
                let [preposition, noun] = name.split(' ');
                canonical.passive_verb = (canonical.passive_verb || []).concat([preposition]);
                canonical.base = (canonical.base || []).concat([noun]);
            } else if (['IN', 'VBN', 'VBG'].includes(tags[0])) {
                canonical.passive_verb = (canonical.passive_verb || []).concat([name]);
            } else if (['JJ', 'JJR'].includes(tags[0]) && !['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[tags.length - 1])) {
                // this one is actually somewhat problematic
                // e.g., all non-words are recognized as JJ, including issn, dateline, funder
                canonical.passive_verb = (canonical.passive_verb || []).concat([name]);
            } else {
                canonical.base = (canonical.base || []).concat(name);
            }
        }
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

                if (triple['@type'].startsWith('http://schema.org/')) {
                    // an enum declaration
                    const enumtype = getId(triple['@type']);
                    const enumvalue = getId(triple['@id']);
                    ensureEnum(enumtype);
                    enums[enumtype].push(enumvalue);
                    continue;
                }

                switch (triple['@type']) {
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
                    typeHierarchy[name].extends = _extends.filter((ex) => !BLACKLISTED_TYPES.has(ex));
                    if (typeHierarchy[name].extends.length === 0 && name !== 'Thing')
                        typeHierarchy[name].extends = ['Thing'];
                    typeHierarchy[name].comment = comment;
                    break;
                }

                default:
                    throw new Error(`don't know how to handle a triple of type ${triple['@type']}`); //'
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
                new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, 'id', Type.Entity(this._prefix + typename), {
                    nl: { canonical: { base: ['name'] } },
                    impl: {
                        'unique': new Ast.Value.Boolean(true),
                        'filterable': new Ast.Value.Boolean(false) // no filter on id, if it has ner support, we'll generate prim for it
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
                        'filterable': new Ast.Value.Boolean(false) // no filter on name, if it has ner support, we'll generate prim for it
                    }
                });
                recursiveAddStringValues(arg, this._prefix + typename + '_name');
                args.push(arg);
            }

            this._hasGeo = 'geo' in typedef.properties;
            for (let propertyname in typedef.properties) {
                const propertydef = typedef.properties[propertyname];
                const [schemaOrgType, type] = this.getBestPropertyType(propertyname, propertydef, typeHierarchy);
                if (!type)
                    continue;

                if (KEYWORDS.includes(propertyname))
                    propertyname = '_' + propertyname;

                const canonical = this.makeArgCanonical(propertyname, type);
                const metadata = { canonical };
                const annotation = keepAnnotation ? {
                    'org_schema_type': new Ast.Value.String(schemaOrgType),
                    'org_schema_comment': new Ast.Value.String(propertydef.comment)
                } : {
                    'org_schema_type': new Ast.Value.String(schemaOrgType)
                };

                if (PROPERTIES_NO_FILTER.includes(propertyname))
                    annotation['filterable'] = new Ast.Value.Boolean(false);

                if (propertyname.startsWith('numberOf'))
                    metadata.counted_object = [ clean(propertyname.slice('numberOf'.length)) ];
                if (propertyname.endsWith('Count'))
                    metadata.counted_object = [ pluralize(clean(propertyname.slice(0, -'Count'.length)))];

                const arg = new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, propertyname, type, {
                    nl: metadata,
                    impl: annotation
                });
                recursiveAddStringValues(arg, this._prefix + typename + '_' + propertyname);

                args.push(arg);
            }

            if (KEYWORDS.includes(typename))
                typename = '_' + typename;

            let query_canonical;
            if (this._manual && typename in MANUAL_TABLE_CANONICAL_OVERRIDE)
                query_canonical = MANUAL_TABLE_CANONICAL_OVERRIDE[typename];
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
            new Ast.ImportStmt.Mixin(null, ['loader'], 'org.thingpedia.v2', []),
            new Ast.ImportStmt.Mixin(null, ['config'], 'org.thingpedia.config.none', [])
        ];

        const classdef = new Ast.ClassDef(null,
            `${this._className}`,
            [], { queries, imports }, {
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

        this._output.end(classdef.prettyprint());
        await StreamUtils.waitFinish(this._output);
    }

}


module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('webqa-process-schemaorg', {
            addHelp: true,
            description: "Process a schema.org JSON+LD definition into a Thingpedia class."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['--cache-file'], {
            required: false,
            defaultValue: './schema.jsonld',
            help: 'Path to a cache file containing the schema.org definitions.'
        });
        parser.addArgument(['--url'], {
            required: false,
            defaultValue: 'https://schema.org/version/3.9/schema.jsonld',
            help: 'The schema.org URL to retrieve the definitions from.'
        });
        parser.addArgument('--manual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable manual annotations.',
            defaultValue: false
        });
        parser.addArgument('--wikidata-path', {
            required: false,
            help: 'path to the json file with wikidata property labels'
        });
        parser.addArgument('--always-base-canonical', {
            nargs: 0,
            action: 'storeTrue',
            help: `Always generate base canonical`,
            defaultValue: true
        });
        parser.addArgument('--no-always-base-canonical', {
            nargs: 0,
            action: 'storeFalse',
            help: `Do not always generate base canonical`,
            dest: `always_base_canonical`,
        });
        parser.addArgument('--class-name', {
            required: false,
            help: 'The name of the generated class, this will also affect the entity names',
            defaultValue: 'org.schema'
        });
        parser.addArgument('--white-list', {
            required: true,
            help: 'A list of queries allowed to use in the class, split by comma (no space).'
        });
    },

    async execute(args) {
        const schemaProcessor = new SchemaProcessor(args);
        schemaProcessor.run();
    }
};
