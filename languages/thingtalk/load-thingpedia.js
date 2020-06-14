// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2017-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//         Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Grammar = ThingTalk.Grammar;
const SchemaRetriever = ThingTalk.SchemaRetriever;
const Units = ThingTalk.Units;

const { clean, typeToStringSafe, makeFilter, makeAndFilter } = require('./utils');
const { isHumanEntity, posTag } = require('../../lib/utils');

function identity(x) {
    return x;
}

const ANNOTATION_RENAME = {
    'property': 'npp',
    'reverse_property': 'npi',
    'verb': 'avp',
    'passive_verb': 'pvp',
    'adjective': 'apv',
    'implicit_identity': 'npv',
    'reverse_verb': 'rv'
};

class ThingpediaLoader {
    async init(runtime, grammar, langPack, options) {
        this._runtime = runtime;
        this._grammar = grammar;
        this._langPack = langPack;

        this._tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(this._tpClient, null, !options.debug);
        this._schemas = options.schemaRetriever;

        this._options = options;

        this._allTypes = new Map;
        this._idTypes = new Set;
        this._nonConstantTypes = new Set;
        this._entities = new Map;
        this.types = {
            all: this._allTypes,
            id: this._idTypes,
            nonConstant: this._nonConstantTypes,
            entities: this._entities
        };
        this.params = {
            in: new Map,
            out: new Set,
        };
        this.idQueries = new Map;
        this.compoundArrays = {};
        if (this._options.whiteList)
            this.globalWhiteList = this._options.whiteList.split(',');
        else
            this.globalWhiteList = null;

        const [say, get_gps, get_time] = await Promise.all([
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'action', 'say'),
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'query', 'get_gps'),
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'query', 'get_time')
        ]);
        this.standardSchemas = { say, get_gps, get_time };

        // make sure that these types are always available, regardless of which templates we have
        this._recordType(Type.String);
        this._recordType(Type.Date);
        this._recordType(Type.Currency);
        this._recordType(Type.Number);
        for (let unit of Units.BaseUnits)
            this._recordType(Type.Measure(unit));

        await this._loadMetadata();
    }

    get flags() {
        return this._options.flags;
    }

    async _tryGetStandard(kind, functionType, fn) {
        try {
            return await this._schemas.getMeta(kind, functionType, fn);
        } catch(e) {
            return null;
        }
    }

    _recordType(type) {
        if (type.isCompound) {
            for (let field in type.fields)
                this._recordType(type.fields[field].type);
            return null;
        }
        if (type.isArray)
            this._recordType(type.elem);
        const typestr = typeToStringSafe(type);
        if (this._allTypes.has(typestr))
            return typestr;
        this._allTypes.set(typestr, type);

        this._grammar.declareSymbol('out_param_' + typestr);
        this._grammar.declareSymbol('noun_out_param_' + typestr);
        this._grammar.declareSymbol('placeholder_' + typestr);

        if (!this._grammar.hasSymbol('constant_' + typestr)) {
            if (!type.isEnum && !type.isEntity && !type.isArray)
                throw new Error('Missing definition for type ' + typestr);
            this._grammar.declareSymbol('constant_' + typestr);
            this._grammar.addRule('constant_Any', [new this._runtime.NonTerminal('constant_' + typestr)],
                this._runtime.simpleCombine(identity));

            if (type.isEnum) {
                for (let entry of type.entries) {
                    const value = new Ast.Value.Enum(entry);
                    value.getType = function() { return type; };
                    this._grammar.addRule('constant_' + typestr, [clean(entry)],
                        this._runtime.simpleCombine(() => value));
                }
            } else if (type.isEntity) {
                if (!this._nonConstantTypes.has(typestr) && !this._idTypes.has(typestr)) {
                    if (this._options.flags.dialogues) {
                        for (let i = 0; i < 20; i++) {
                            const string = `str:ENTITY_${type.type}::${i}:`;
                            const value = new Ast.Value.Entity(string, type.type, string);
                            this._grammar.addRule('constant_' + typestr, ['GENERIC_ENTITY_' + type.type + '_' + i],
                                this._runtime.simpleCombine(() => value));
                        }
                    } else {
                        this._grammar.addConstants('constant_' + typestr, 'GENERIC_ENTITY_' + type.type, type);
                    }
                }
            }
        }
        return typestr;
    }

    _addOutParam(functionName, pname, type, typestr, canonical) {
        this._grammar.addRule('out_param_' + typestr, [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));

        if (!pname.startsWith('address') && !pname.endsWith('Count') && !pname.startsWith('numberOf')) {
            let postags = posTag(canonical.split(' '));
            if (postags.every((tag) => ['NN', 'NNS', 'NNP', 'NNPS'].includes(tag)))
                this._grammar.addRule('noun_out_param_' + typestr, [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
        }

        if (type.isArray)
            this._grammar.addRule('out_param_Array__Any', [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
        else
            this._grammar.addRule('out_param_Any', [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
    }

    _recordInputParam(functionName, arg) {
        const pname = arg.name;
        const ptype = arg.type;
        //const key = pname + '+' + ptype;
        // FIXME match functionName
        //if (this.params.out.has(key))
        //    return;
        //this.params.out.add(key);

        const typestr = this._recordType(ptype);

        // compound types are handled by recursing into their fields through iterateArguments()
        // except FIXME that probably won't work? we need to create a record object...
        if (ptype.isCompound)
            return;

        if (arg.metadata.prompt) {
            let prompt = arg.metadata.prompt;
            if (typeof prompt === 'string')
                prompt = [prompt];

            for (let form of prompt)
                this._grammar.addRule('thingpedia_slot_fill_question', [form], this._runtime.simpleCombine(() => pname));
        }

        // FIXME boolean types are not handled, they have no way to specify the true/false phrase
        if (ptype.isBoolean)
            return;

        /*
        FIXME what to do here?
        if (ptype.isArray && ptype.elem.isCompound) {
            this.compoundArrays[pname] = ptype.elem;
            for (let field in ptype.elem.fields) {
                let arg = ptype.elem.fields[field];
                this._recordInputParam(functionName, field, arg.type, arg);
            }
        }*/

        let canonical;

        if (!arg.metadata.canonical)
            canonical = { base: [clean(pname)] };
        else if (typeof arg.metadata.canonical === 'string')
            canonical = { base: [arg.metadata.canonical] };
        else
            canonical = arg.metadata.canonical;

        for (let cat in canonical) {
            if (cat === 'default')
                continue;

            let annotvalue = canonical[cat];
            if (cat in ANNOTATION_RENAME)
                cat = ANNOTATION_RENAME[cat];

            if (cat === 'apv' && typeof annotvalue === 'boolean') {
                // compat
                if (annotvalue)
                    annotvalue = ['#'];
                else
                    annotvalue = [];
            }

            if (cat === 'npv') {
                // implicit identity does not make sense for input parameters
                throw new TypeError(`Invalid annotation #_[canonical.implicit_identity=${annotvalue}] for ${functionName}`);
            }

            if (!Array.isArray(annotvalue))
                annotvalue = [annotvalue];

            for (let form of annotvalue) {
                if (cat === 'base') {
                    this._grammar.addRule('input_param', [form], this._runtime.simpleCombine(() => pname));
                } else {
                    let [before, after] = form.split('#');
                    before = (before || '').trim();
                    after = (after || '').trim();

                    let expansion;
                    if (before && after)
                        expansion = [before, new this._runtime.NonTerminal('constant_' + typestr), after];
                    else if (before)
                        expansion = [before, new this._runtime.NonTerminal('constant_' + typestr)];
                    else if (after)
                        expansion = [new this._runtime.NonTerminal('constant_' + typestr), after];
                    else
                        expansion = [new this._runtime.NonTerminal('constant_' + typestr)];
                    this._grammar.addRule(cat + '_input_param', expansion, this._runtime.simpleCombine((value) => new Ast.InputParam(null, pname, value)));
                }
            }
        }
    }

    _recordOutputParam(functionName, arg) {
        const pname = arg.name;
        const ptype = arg.type;
        const key = pname + '+' + ptype;
        // FIXME match functionName
        //if (this.params.out.has(key))
        //    return;
        this.params.out.add(key);

        const typestr = this._recordType(ptype);
        const pvar = new Ast.Value.VarRef(pname);

        if (ptype.isCompound)
            return;

        if (arg.metadata.prompt) {
            let prompt = arg.metadata.prompt;
            if (typeof prompt === 'string')
                prompt = [prompt];

            for (let form of prompt)
                this._grammar.addRule('thingpedia_search_question', [form], this._runtime.simpleCombine(() => pvar));
        }

        if (ptype.isBoolean)
            return;

        if (ptype.isArray && ptype.elem.isCompound) {
            this.compoundArrays[pname] = ptype.elem;
            for (let field in ptype.elem.fields) {
                let arg = ptype.elem.fields[field];
                this._recordOutputParam(functionName, arg);
            }
        }

        if (arg.metadata.counted_object) {
            let forms = Array.isArray(arg.metadata.counted_object) ?
                arg.metadata.counted_object : [arg.metadata.counted_object];
            for (let form of forms)
                this._grammar.addRule('out_param_ArrayCount', [form], this._runtime.simpleCombine(() => pvar));
        }

        let canonical;

        if (!arg.metadata.canonical)
            canonical = { base: [clean(pname)] };
        else if (typeof arg.metadata.canonical === 'string')
            canonical = { base: [arg.metadata.canonical] };
        else
            canonical = arg.metadata.canonical;

        let vtype = ptype;
        let op = '==';
        if (ptype.isArray) {
            vtype = ptype.elem;
            op = 'contains';
        }
        const vtypestr = this._recordType(vtype);
        if (vtypestr === null)
            return;

        for (let cat in canonical) {
            if (cat === 'default')
                continue;

            let annotvalue = canonical[cat];
            if (cat in ANNOTATION_RENAME)
                cat = ANNOTATION_RENAME[cat];

            if (cat === 'apv' && typeof annotvalue === 'boolean') {
                // compat
                if (annotvalue)
                    annotvalue = ['#'];
                else
                    annotvalue = [];
            }

            if (cat === 'npv') {
                if (typeof annotvalue !== 'boolean')
                    throw new TypeError(`Invalid annotation #_[canonical.implicit_identity=${annotvalue}] for ${functionName}`);
                if (annotvalue) {
                    const expansion = [new this._runtime.NonTerminal('constant_' + vtypestr)];
                    this._grammar.addRule(cat + '_filter', expansion, this._runtime.simpleCombine((value) => makeFilter(this, pvar, op, value, false)));
                }
                continue;
            }

            if (!Array.isArray(annotvalue))
                annotvalue = [annotvalue];

            for (let form of annotvalue) {
                if (cat === 'base') {
                    this._addOutParam(functionName, pname, ptype, typestr, form.trim());
                    if (!canonical.npp && !canonical.property) {
                        const expansion = [form, new this._runtime.NonTerminal('constant_' + vtypestr)];
                        this._grammar.addRule('npp_filter', expansion, this._runtime.simpleCombine((value) => makeFilter(this, pvar, op, value, false)));

                        const pairexpansion = [form, new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs')];
                        this._grammar.addRule('npp_filter', pairexpansion, this._runtime.simpleCombine((_, values) => makeAndFilter(this, pvar, op, values, false)));
                    }
                } else if (cat === 'rv') {
                    if (isHumanEntity(ptype)) {
                        let expansion = [form];
                        this._grammar.addRule('who_rv_projection', expansion, this._runtime.simpleCombine(() => pvar));
                    }

                    let expansion = [canonical.base[0], form];
                    this._grammar.addRule('rv_projection', expansion, this._runtime.simpleCombine(() => pvar));

                } else {
                    let [before, after] = form.split('#');
                    before = (before || '').trim();
                    after = (after || '').trim();

                    let expansion, pairexpansion;
                    if (before && after) {
                        // "rated # stars"
                        expansion = [before, new this._runtime.NonTerminal('constant_' + vtypestr), after];
                        pairexpansion = [before, new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs'), after];
                    } else if (before) {
                        // "named #"
                        expansion = [before, new this._runtime.NonTerminal('constant_' + vtypestr)];
                        pairexpansion = [before, new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs')];
                    } else if (after) {
                        // "# -ly priced"
                        expansion = [new this._runtime.NonTerminal('constant_' + vtypestr), after];
                        pairexpansion = [new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs'), after];
                    } else {
                        // "#" (as in "# restaurant")
                        expansion = [new this._runtime.NonTerminal('constant_' + vtypestr)];
                        pairexpansion = [new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs')];
                    }
                    this._grammar.addRule(cat + '_filter', expansion, this._runtime.simpleCombine((value) => makeFilter(this, pvar, op, value, false)));
                    this._grammar.addRule(cat + '_filter', pairexpansion, this._runtime.simpleCombine((_, values) => makeAndFilter(this, pvar, op, values, false)));
                }
            }
        }
    }

    async _loadTemplate(ex) {
        // return grammar rules added
        const rules = [];

        try {
            await ex.typecheck(this._schemas, true);
        } catch(e) {
            if (!e.message.startsWith('Invalid kind '))
                console.error(`Failed to load example ${ex.id}: ${e.message}`);
            return [];
        }

        // ignore builtin actions:
        // debug_log is not interesting, say is special and we handle differently, configure/discover are not
        // composable
        if (ex.type === 'action' && ex.value.invocation.selector.kind === 'org.thingpedia.builtin.thingengine.builtin') {
            if (this._options.flags.turking)
                return [];
            if (!this._options.flags.configure_actions && (ex.value.invocation.channel === 'configure' || ex.value.invocation.channel === 'discover'))
                return [];
            if (ex.value.invocation.channel === 'say')
                return [];
        }
        if (ex.type === 'stream' && (ex.value.isTimer || ex.value.isAtTimer))
            return [];
        if (this._options.flags.nofilter && (ex.value.isFilter || ex.value.isEdgeFilter || (ex.value.isMonitor && ex.value.table.isFilter)))
            return [];

        // ignore optional input parameters
        // if you care about optional, write a lambda template
        // that fills in the optionals

        if (ex.type === 'program') {
            // make up a fake expression signature that we attach to this program
            // FIXME we really should not need this mess...

            const args = [];
            for (let pname in ex.args) {
                let ptype = ex.args[pname];
                // FIXME use the annotation (or find the info in thingpedia)
                const pcanonical = clean(pname);
                args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.IN_REQ,
                    pname, ptype, { canonical: pcanonical }, {}));

                this.params.in.set(pname + '+' + ptype, [pname, [typeToStringSafe(ptype), pcanonical]]);
                this._recordType(ptype);
            }

            ex.value.schema = new Ast.ExpressionSignature(null, 'action', null /* class */, [] /* extends */, args, {
                is_list: false,
                is_monitorable: false,
                default_projection: [],
                minimal_projection: []
            });
        } else {
            for (let pname in ex.args) {
                let ptype = ex.args[pname];

                //console.log('pname', pname);
                if (!(pname in ex.value.schema.inReq)) {
                    // somewhat of a hack, we declare the argument for the value,
                    // because later we will muck with schema only
                    ex.value.schema = ex.value.schema.addArguments([new Ast.ArgumentDef(
                        null,
                        Ast.ArgDirection.IN_REQ,
                        pname,
                        ptype,
                        {canonical: clean(pname)},
                        {}
                    )]);
                }
                const pcanonical = ex.value.schema.getArgCanonical(pname);

                this.params.in.set(pname + '+' + ptype, [pname, [typeToStringSafe(ptype), pcanonical]]);
                this._recordType(ptype);
            }
        }

        if (ex.type === 'query') {
            if (Object.keys(ex.args).length === 0 && ex.value.schema.hasArgument('id')) {
                let type = ex.value.schema.getArgument('id').type;
                if (isHumanEntity(type)) {
                    let grammarCat = 'thingpedia_who_question';
                    this._grammar.addRule(grammarCat, [''], this._runtime.simpleCombine(() => ex.value));
                }
            }
        }

        for (let preprocessed of ex.preprocessed) {
            let grammarCat = 'thingpedia_' + ex.type;

            if (grammarCat === 'thingpedia_query' && preprocessed[0] === ',') {
                preprocessed = preprocessed.substring(1).trim();
                grammarCat = 'thingpedia_get_command';
            }

            if (this._options.debug && preprocessed[0].startsWith(','))
                console.log(`WARNING: template ${ex.id} starts with , but is not a query`);

            let chunks = preprocessed.trim().split(' ');
            let expansion = [];

            for (let chunk of chunks) {
                if (chunk === '')
                    continue;
                if (chunk.startsWith('$') && chunk !== '$$') {
                    const [, param1, param2, opt] = /^\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})$/.exec(chunk);
                    let param = param1 || param2;
                    assert(param);
                    expansion.push(new this._runtime.Placeholder(param, opt));
                } else {
                    expansion.push(chunk);
                }
            }

            this._grammar.addRule(grammarCat, expansion, this._runtime.simpleCombine(() => ex.value));
            rules.push({ category: grammarCat, expansion: chunks, example: ex });
        }
        return rules;
    }

    async _makeExampleFromQuery(q) {
        const device = new Ast.Selector.Device(null, q.class.name, null, null);
        const invocation = new Ast.Invocation(null, device, q.name, [], q);

        let canonical = q.canonical ? q.canonical : clean(q.name);
        if (!Array.isArray(canonical))
            canonical = [canonical];

        for (let form of canonical) {
            const pluralized = this._langPack.pluralize(form);
            if (pluralized !== undefined && pluralized !== form)
                canonical.push(pluralized);
        }

        const functionName = q.class.name + ':' + q.name;
        const table = new Ast.Table.Invocation(null, invocation, q);
        for (let form of canonical) {
            this._grammar.addRule('base_table', [form], this._runtime.simpleCombine(() => table));
            this._grammar.addRule('base_noun_phrase', [form], this._runtime.simpleCombine(() => functionName));
        }

        // FIXME English words should not be here
        for (let form of ['anything', 'one', 'something'])
            this._grammar.addRule('generic_anything_noun_phrase', [form], this._runtime.simpleCombine(() => table));
        for (let form of ['option', 'choice'])
            this._grammar.addRule('generic_base_noun_phrase', [form], this._runtime.simpleCombine(() => table));

        await this._loadTemplate(new Ast.Example(
            null,
            -1,
            'query',
            {},
            table,
            canonical,
            canonical,
            {}
        ));

        if (!q.hasArgument('id'))
            return;
        const id = q.getArgument('id');
        if (!id.type.isEntity)
            return;

        const idType = id.type;
        const entity = this._entities[idType.type];
        if (!entity || !entity.has_ner_support)
            return;

        const schemaClone = table.schema.clone();
        schemaClone.is_list = false;
        schemaClone.no_filter = true;
        if (this._options.flags.dialogues) {
            for (let i = 0; i < 5; i ++) {
                this._grammar.addRule('constant_name', ['GENERIC_ENTITY_' + idType.type + '_' + i], this._runtime.simpleCombine(() => {
                    const value = new Ast.Value.Entity('str:ENTITY_' + idType.type + '::' + i + ':', idType.type, null);
                    /*const idfilter = new Ast.BooleanExpression.Atom(null, 'id', '==', value);
                    return [value, new Ast.Table.Filter(null, table, idfilter, schemaClone)];*/
                    return value;
                }));
            }
        }

        const idfilter = new Ast.BooleanExpression.Atom(null, 'id', '==', new Ast.Value.VarRef('p_id'));
        await this._loadTemplate(new Ast.Example(
            null,
            -1,
            'query',
            { p_id: id.type },
            new Ast.Table.Filter(null, table, idfilter, schemaClone),
            [`\${p_id}`],
            [`\${p_id}`],
            {}
        ));
        const namefilter = new Ast.BooleanExpression.Atom(null, 'id', '=~', new Ast.Value.VarRef('p_name'));
        let span;
        if (q.name === 'Person')
            span = [`\${p_name}`, ...canonical.map((c) => `\${p_name} ${c}`)];
        else
            span = [`\${p_name}`, ...canonical.map((c) => `\${p_name} ${c}`), ...canonical.map((c) => `${c} \${p_name}`)];
        await this._loadTemplate(new Ast.Example(
            null,
            -1,
            'query',
            { p_name: Type.String },
            new Ast.Table.Filter(null, table, namefilter, table.schema),
            span,
            span,
            {}
        ));
    }

    async _loadFunction(functionDef) {
        if (this.globalWhiteList && !this.globalWhiteList.includes(functionDef.name))
            return;

        let functionName = functionDef.class.kind + ':' + functionDef.name;
        for (const arg of functionDef.iterateArguments()) {
            if (arg.is_input)
                this._recordInputParam(functionName, arg);
            else
                this._recordOutputParam(functionName, arg);
        }

        if (functionDef.functionType === 'query')
            await this._makeExampleFromQuery(functionDef);
    }

    async _loadDevice(device) {
        this._grammar.addRule('constant_Entity__tt__device', [device.kind_canonical],
            this._runtime.simpleCombine(() => new Ast.Value.Entity(device.kind, 'tt:device', null)));

        const classDef = await this._schemas.getFullMeta(device.kind);

        const whitelist = classDef.getImplementationAnnotation('whitelist');
        let queries = Object.keys(classDef.queries);
        let actions = Object.keys(classDef.actions);
        if (whitelist && whitelist.length > 0) {
            queries = queries.filter((name) => whitelist.includes(name));
            actions = actions.filter((name) => whitelist.includes(name));
        }

        await Promise.all(queries.map((name) => classDef.queries[name]).map(this._loadFunction.bind(this)));
        await Promise.all(actions.map((name) => classDef.actions[name]).map(this._loadFunction.bind(this)));
    }

    async _isIdEntity(idEntity) {
        // FIXME this is kind of a bad heuristic
        if (idEntity.endsWith(':id'))
            return true;

        let [prefix, suffix] = idEntity.split(':');
        if (prefix === 'tt')
            return false;
        if (this.idQueries.has(idEntity))
            return true;

        if (this.globalWhiteList && !this.globalWhiteList.includes(suffix))
            return false;

        let classDef;
        try {
            classDef = await this._schemas.getFullMeta(prefix);
        } catch(e) {
            // ignore if the class does not exist
            return false;
        }
        const whitelist = classDef.getImplementationAnnotation('whitelist');
        if (classDef.queries[suffix]) {
            if (whitelist && whitelist.length > 0 && !whitelist.includes(suffix))
                return false;
            const query = classDef.queries[suffix];
            if (query.hasArgument('id')) {
                const id = query.getArgument('id');
                if (id.type.isEntity && id.type.type === idEntity) {
                    this.idQueries.set(idEntity, query);
                    return true;
                }
            }
        }
        return false;
    }

    async _loadIdType(idType) {
        let typestr = typeToStringSafe(Type.Entity(idType.type));
        if (this._idTypes.has(typestr))
            return;

        if (await this._isIdEntity(idType.type)) {
            if (this._options.debug)
                console.log('Loaded type ' + idType.type + ' as id type');
            this._idTypes.add(typestr);
        } else {
            if (idType.has_ner_support) {
                if (this._options.debug)
                    console.log('Loaded type ' + idType.type + ' as generic entity');
            } else {
                if (this._options.debug)
                    console.log('Loaded type ' + idType.type + ' as non-constant type');
                this._nonConstantTypes.add(typestr);
            }
        }
    }

    async _loadCanonical(kind) {
        if (kind.startsWith('org.thingpedia.dynamic.by_kinds.'))
            kind = kind.substring('org.thingpedia.dynamic.by_kinds.'.length);
        try {
            const classDef = await this._schemas.getFullMeta(kind);
            const canonicals = {};
            Object.keys(classDef.queries).forEach((q) => {
                canonicals[q] = classDef.queries[q].metadata.canonical;
            });
            Object.keys(classDef.actions).forEach((a) => {
                canonicals[a] = classDef.actions[a].metadata.canonical;
            });
            return canonicals;
        } catch (e) {
            return undefined;
        }
    }

    makeExample(type, args, value, preprocessed) {
        return new Ast.Example(
            null,
            -1,
            type,
            args,
            value,
            [preprocessed],
            [preprocessed],
            {}
        );
    }

    async _getDataset(kind) {
        return await this._tpClient.getExamplesByKinds([kind]);
    }

    // takes an expansion (array), a canonical (a string), and another expansion to replace the canonical
    // the canonical is guaranteed to appear exactly once in the original expansion
    _expandExpansion(expansion, canonical, replacement) {
        const string = expansion.join(' ');
        const indexStart = string.indexOf(canonical);
        const indexEnd = indexStart + canonical.length;
        return string.substr(0, indexStart).trim().split(' ').concat(
            replacement
        ).concat(
            string.substr(indexEnd + 1).trim().split(' ')
        ).filter((token) => token !== '').join(' ');
    }


    // return true if two examples conflict with each other
    _conflictExample(expanderExample, ruleExample) {
        let invocation;
        for (let [, inv] of expanderExample.iteratePrimitives())
            invocation = inv;
        const channel = invocation.channel;
        const usedInput = invocation.in_params.map((p) => p.name);

        for (let [, inv] of ruleExample.iteratePrimitives()) {
            if (inv.channel === channel) {
                for (let in_param of inv.in_params) {
                    if (!in_param.value.isUndefined && usedInput.includes(in_param.name))
                        return true;
                }
            }
        }

        return false;
    }


    async _expandDataset(canonical, expander, rules) {
        const filter = expander.example.value.filter;
        await Promise.all(rules.map((rule) =>  {
            if (rule.category !== 'thingpedia_query')
                return;
            if (expander.example.id !== -1 && expander.example.id === rule.example.id)
                return;


            // skip rules with filter on the same parameter
            // TODO: replace this with more robust check and move to _conflictExample
            if (rule.example.value.isFilter) {
                if (filter.isAtom && rule.example.value.filter.isAtom) {
                    if (filter.name === rule.example.value.filter.name)
                        return;
                }
            }

            // skip rules if the same input parameter is used
            if (this._conflictExample(expander.example, rule.example))
                return;

            const args = Object.assign({}, expander.example.args);
            for (let arg of Object.keys(rule.example.args)) {
                // skip rules use the same arguments
                // (in most cases, this will skip rules with same input or have filters on the same param
                //  but if the value of the input/filter is a constant, then this won't work)
                if (arg in args)
                    return;
                args[arg] = rule.example.args[arg];
            }

            const value = new Ast.Table.Filter(rule.example.value, filter, null);
            const preprocessed = this._expandExpansion(expander.expansion, canonical, rule.expansion);

            const ex = this.makeExample('query', args, value, preprocessed);
            this._safeLoadTemplate(ex);
        }));
    }

    // load dataset for one device
    async _loadDataset(dataset) {
        const kind = dataset.name.substr(1);
        let rules = {};
        for (let ex of dataset.examples) {
            const newrules = await this._safeLoadTemplate(ex);

            let invocation;
            for (let [, inv] of ex.iteratePrimitives())
                invocation = inv;

            if (invocation.channel in rules)
                rules[invocation.channel] = rules[invocation.channel].concat(newrules);
            else
                rules[invocation.channel] = newrules;
        }

        if (!this._options.flags.expand_primitives)
            return;
        const canonicals = await this._loadCanonical(kind);
        if (!canonicals)
            return;
        for (let channel in rules) {
            const canonical = canonicals[channel].toLowerCase().trim();
            for (let rule of rules[channel]) {
                if (rule.category !== 'thingpedia_query')
                    continue;
                const re = new RegExp(canonical, "g");
                const matches = rule.expansion.join(' ').match(re);
                if (!matches || matches.length !== 1)
                    continue;
                if (!rule.example.value.isFilter || !rule.example.value.table.isInvocation)
                    continue;
                await this._expandDataset(canonical, rule, rules[channel]);
            }
        }
    }

    async _safeLoadTemplate(ex) {
        try {
            return await this._loadTemplate(ex);
        } catch(e) {
            throw new TypeError(`Failed to load example ${ex.id}: ${e.message}`);
        }
    }

    async _loadMetadata() {
        const [devices, idTypes] = await Promise.all([
            this._tpClient.getAllDeviceNames(),
            this._tpClient.getAllEntityTypes()
        ]);

        let datasets = await Promise.all(devices.map(async (d) => {
            return Grammar.parse(await this._getDataset(d.kind)).datasets[0];
        }));
        datasets = datasets.filter((d) => !!d);
        if (datasets.length === 0) {
            const code = await this._tpClient.getAllExamples();
            console.log(code);
            datasets = await Grammar.parse(code).datasets;
        }

        if (this._options.debug) {
            const countTemplates = datasets.map((d) => d.examples.length).reduce((a, b) => a+b, 0);
            console.log('Loaded ' + devices.length + ' devices');
            console.log('Loaded ' + countTemplates + ' templates');
        }

        idTypes.forEach((entity) => this._entities[entity.type] = entity);
        await Promise.all(idTypes.map(this._loadIdType, this));
        await Promise.all([
            Promise.all(devices.map(this._loadDevice, this)),
            Promise.all(datasets.map(this._loadDataset, this))
        ]);
    }
}

module.exports = new ThingpediaLoader();
