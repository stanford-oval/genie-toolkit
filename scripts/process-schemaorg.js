#!/usr/bin/env node
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

process.on('uncaughtRejection', (up) => { throw up; });

const assert = require('assert');
const POS = require("en-pos");
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;
const Ast = ThingTalk.Ast;
const fs = require('fs');
const util = require('util');

const { clean, pluralize } = require('../lib/utils');

const URL = 'https://schema.org/version/3.9/schema.jsonld';

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

const BUILTIN_TYPEMAP = {
    Time: Type.Time,
    Number: Type.Number,
    Float: Type.Number,
    Integer: Type.Number,
    Text: Type.String,
    Boolean: Type.Boolean,
    DateTime: Type.Date,
    Date: Type.Date,
    DataType: Type.Any,
    URL: Type.Entity('tt:url'),
    ImageObject: Type.Entity('tt:picture'),
    Barcode: Type.Entity('tt:picture'),

    Mass: Type.Measure('kg'),
    Energy: Type.Measure('kcal'),
    Distance: Type.Measure('m'),
    Duration: Type.Measure('ms'),

    GeoCoordinates: Type.Location,
    MonetaryAmount: Type.Currency,

    QuantitativeValue: Type.Any
};

const KEYWORDS = [
    'let', 'now', 'new', 'as', 'of', 'in', 'out', 'req', 'opt', 'notify', 'return',
    'join', 'edge', 'monitor', 'class', 'extends', 'mixin', 'this', 'import', 'null',
    'enum', 'aggregate', 'dataset', 'oninput', 'sort', 'asc', 'desc', 'bookkeeping',
    'compute', 'true', 'false'
];

const BLACKLISTED_TYPES = new Set([
    'QualitativeValue', 'PropertyValue', 'BedType', 'MedicalBusiness',

    // buggy, causes Audience to turn into an enum
    'Researcher',
]);

const STRUCTURED_HIERARCHIES = [
    'StructuredValue', 'Rating',

    // FIXME Review is too messy to represent as a structured value, either you lose info or you get cycles
    // 'Review'
];

// HACK: GeoShape has a loop through address@GeoShape : PostalAddress -> areaServed@ContactPoint : GeoShape
// but we fail to detect it
const NON_STRUCT_TYPES = new Set([
    'GeoShape'
]);

const PROPERTY_TYPE_OVERRIDE = {
    'telephone': Type.Entity('tt:phone_number'),
    'email': Type.Entity('tt:email_address'),
    'image': Type.Entity('tt:picture'),
    'checkinTime': Type.Time,
    'checkoutTime': Type.Time,
    'weight': Type.Measure('ms'),
    'depth': Type.Measure('m'),
    'description': Type.String
};

// HACK: certain structured types want to get the name & description property from Thing
const STRUCT_INCLUDE_THING_PROPERTIES = new Set([
    'LocationFeatureSpecification'
]);

function typeToThingTalk(typename, typeHierarchy) {
    if (typename in BUILTIN_TYPEMAP)
        return BUILTIN_TYPEMAP[typename];

    if (typeHierarchy[typename].isItemList)
        return Type.Array(typeToThingTalk(typeHierarchy[typename].itemType, typeHierarchy));
    if (typeHierarchy[typename].isEnum && typeHierarchy[typename].enum.length > 0)
        return Type.Enum(typeHierarchy[typename].enum);
    if (typeHierarchy[typename].representAsStruct)
        return makeCompoundType(typename, typeHierarchy[typename], typeHierarchy);

    return Type.Entity('org.schema:' + typename);
}

function getBestPropertyType(propname, property, typeHierarchy) {
    let best = undefined, bestScore = -Infinity;

    // if the property is defined as taking ItemList and something else, we make an array of that something else
    let isArray = property.types.some((type) => typeHierarchy[type] && typeHierarchy[type].isItemList);

    // if the property comment starts with "A " or "An ", we assume there can be multiple values
    // because if it starts with "The ", we assume it can only have one value
    // this is a pretty coarse heuristic, but it works sometimes...

    if (/^an? /i.test(property.comment))
        isArray = true;

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

    let tttype = typeToThingTalk(best, typeHierarchy);
    if (!tttype)
        return [undefined, undefined];

    // an array of booleans or enums does not make much sense
    if (tttype.isBoolean || tttype.isEnum)
        isArray = false;

    if (isArray)
        tttype = Type.Array(tttype);
    return [best, tttype];
}

function makeCompoundType(startingTypename, typedef, typeHierarchy) {
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
        const [schemaOrgType, ttType] = getBestPropertyType(propertyname, propertydef, typeHierarchy);
        if (!ttType)
            continue;

        const canonical = makeArgCanonical(propertyname, ttType);

        fields[propertyname] = new Ast.ArgumentDef(undefined, propertyname, ttType, {
            'canonical': canonical["default"] === "npp" ? canonical["npp"][0] : canonical
        }, {
            'org_schema_type': Ast.Value.String(schemaOrgType),
            'org_schema_comment': Ast.Value.String(propertydef.comment)
        });
        anyfield = true;
    }
    if (!anyfield)
        throw new Error(`Struct type ${startingTypename} has no fields`);

    return Type.Compound(startingTypename, fields);
}

function posTag(tokens) {
    return new POS.Tag(tokens)
        .initial() // initial dictionary and pattern based tagging
        .smooth() // further context based smoothing
        .tags;
}

function makeArgCanonical(name, ptype) {
    function cleanName(name) {
        if (name.endsWith(' value'))
            return name.substring(0, name.length - ' value'.length);
        return name;
    }

    let canonical = {};
    let npp;
    let plural = ptype && ptype.isArray;
    name = clean(name);
    if (!name.includes('.')) {
        npp = plural ? pluralize(cleanName(name)) : cleanName(name);
    } else {
        const components = name.split('.');
        const last = components[components.length - 1];
        npp = plural ? pluralize(last) : last;
    }

    if (npp.startsWith('has ')) {
        npp = npp.substring('has '.length);
    } else if (npp.startsWith('is ')) {
        npp = npp.substring('is '.length);
        let tags = posTag(npp.split(' '));

        if (['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[tags.length - 1])) {
            canonical["npi"] = [npp];
            canonical["default"] = "npi";
        }
        else if (['VBN', 'JJ', 'JJR'].includes(tags[0])) {
            canonical["pvp"] = [npp];
            canonical["default"] = "pvp";
        }

    } else {
        let tags = posTag(npp.split(' '));
        if (['VBP', 'VBZ', 'VBD'].includes(tags[0])) {
            canonical["avp"] = [npp];
            canonical["default"] = "avp";
        }
    }

    canonical["npp"] = [npp];
    if (!("default" in canonical))
        canonical["default"] = "npp";

    return canonical;
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

async function main() {
    let schemajsonld;
    if (await util.promisify(fs.exists)('./schema.jsonld')) {
        schemajsonld = await util.promisify(fs.readFile)('./schema.jsonld', { encoding: 'utf8' });
    } else {
        schemajsonld = await Tp.Helpers.Http.get(URL);
        await util.promisify(fs.writeFile)('./schema.jsonld', schemajsonld);
    }

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

    function findCycle(typename, lookfor, visited) {
        if (visited.has(typename))
            return typename === lookfor;
        visited.add(typename);

        for (let propname in typeHierarchy[typename].properties) {
            let propdef = typeHierarchy[typename].properties[propname];
            for (let type of propdef.types) {
                if (type in BUILTIN_TYPEMAP)
                    continue;
                if (!typeHierarchy[type] || !typeHierarchy[type].representAsStruct)
                    continue;
                if (findCycle(type, lookfor, visited))
                    return true;
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

        const args = [
            new Ast.ArgumentDef(Ast.ArgDirection.OUT, 'id', Type.Entity('org.schema:' + typename), {}, {})
        ];
        for (let propertyname in typedef.properties) {
            const propertydef = typedef.properties[propertyname];
            const [schemaOrgType, type] = getBestPropertyType(propertyname, propertydef, typeHierarchy);
            if (!type)
                continue;

            if (KEYWORDS.includes(propertyname))
                propertyname = '_' + propertyname;

            const canonical = makeArgCanonical(propertyname, type);

            args.push(
                new Ast.ArgumentDef(Ast.ArgDirection.OUT, propertyname, type, {
                    'canonical': canonical["default"] === "npp" ? canonical["npp"][0] : canonical
                }, {
                    'org_schema_type': Ast.Value.String(schemaOrgType),
                    'org_schema_comment': Ast.Value.String(propertydef.comment)
                })
            );
        }

        if (KEYWORDS.includes(typename))
            typename = '_' + typename;
        const querydef = new Ast.FunctionDef('query', typename, typedef.extends, args, true, false, {
            'confirmation': clean(typename),
        }, {
            'org_schema_comment': Ast.Value.String(typedef.comment),
            'confirm': Ast.Value.Boolean(false)
        });
        queries[typename] = querydef;
    }

    const classdef = new Ast.ClassDef('org.schema', [], queries, {} /* actions */, [
        new Ast.ImportStmt.Mixin(['loader'], 'org.thingpedia.v2', []),
        new Ast.ImportStmt.Mixin(['config'], 'org.thingpedia.config.none', [])
    ], {
        name: 'Schema.org',
        description: 'Scraped data from websites that support schema.org'
    }, {}, false);

    console.log(classdef.prettyprint());
}
main();
