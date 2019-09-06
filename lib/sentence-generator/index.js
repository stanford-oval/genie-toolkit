// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2017-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const stream = require('stream');
const path = require('path');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const SchemaRetriever = ThingTalk.SchemaRetriever;
const NNSyntax = ThingTalk.NNSyntax;
const Units = ThingTalk.Units;

const { clean, makeDummyEntities } = require('../utils');

const $runtime = require('./runtime');
const importGenie = require('../genie-compiler');
const { typeToStringSafe } = require('../../languages/ast_manip');
const i18n = require('../i18n');

function identity(x) {
    return x;
}

const BASIC_TARGET_GEN_SIZE = 100000;
const CONTEXTUAL_TARGET_GEN_SIZE = 10000;

class SentenceGenerator extends events.EventEmitter {
    constructor(options) {
        super();
        this._tpClient = options.thingpediaClient;
        this._schemas = options.schemaRetriever || new SchemaRetriever(this._tpClient, null, !options.debug);

        this._options = options;

        this._allTypes = new Map;
        this._idTypes = new Set;
        this._nonConstantTypes = new Set;
        this._types = {
            all: this._allTypes,
            id: this._idTypes,
            nonConstant: this._nonConstantTypes,
        };
        this._allParams = {
            in: new Map,
            out: new Set,
        };

        this._langPack = i18n.get(options.locale);
        this._postprocess = this._langPack.postprocessSynthetic;
        this._grammar = null;
        this._generator = null;
    }

    get schemas() {
        return this._schemas;
    }
    get progress() {
        return this._grammar.progress;
    }

    postprocess(sentence, program) {
        return this._postprocess(sentence, program, this._options.rng);
    }

    generate(context) {
        return this._grammar.generate(context);
    }

    async _tryGetStandard(kind, functionType, fn) {
        try {
            return await this._schemas.getMeta(kind, functionType, fn);
        } catch(e) {
            return null;
        }
    }

    async initialize() {
        const [say, get_gps, get_time] = await Promise.all([
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'action', 'say'),
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'query', 'get_gps'),
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'query', 'get_time')
        ]);
    
        const $options = {
            flags: this._options.flags,
            types: this._types,
            params: this._allParams,

            standardSchemas: { say, get_gps, get_time }
        };

        this._grammar = new $runtime.Grammar(this._options);
        (await importGenie(path.resolve(path.dirname(module.filename), '../common-templates/thingpedia.genie')))($options, this._grammar);
        // make sure that these types are always available, regardless of which templates we have
        this._recordType(Type.String);
        this._recordType(Type.Date);
        this._recordType(Type.Currency);
        this._recordType(Type.Number);
        for (let unit of Units.BaseUnits)
            this._recordType(Type.Measure(unit));

        await this._loadMetadata();
        const languageClass = await importGenie(this._options.templateFile);
        this._grammar = languageClass($options, this._grammar);
        this._grammar.on('progress', (value) => {
            this.emit('progress', value);
        });
    }

    _recordType(type) {
        const typestr = typeToStringSafe(type);
        if (this._allTypes.has(typestr))
            return typestr;
        this._allTypes.set(typestr, type);

        this._grammar.declareSymbol('out_param_' + typestr);
        this._grammar.declareSymbol('placeholder_' + typestr);
        if (type.isArray) {
            this._grammar.addRule('out_param_Array__Any',  [new $runtime.NonTerminal('out_param_' + typestr)],
                $runtime.simpleCombine(identity));
        } else {
            this._grammar.addRule('out_param_Any',  [new $runtime.NonTerminal('out_param_' + typestr)],
                $runtime.simpleCombine(identity));
        }

        if (!this._grammar.hasSymbol('constant_' + typestr)) {
            if (!type.isEnum && !type.isEntity && !type.isArray)
                throw new Error('Missing definition for type ' + typestr);
            this._grammar.declareSymbol('constant_' + typestr);
            this._grammar.addRule('constant_Any', [new $runtime.NonTerminal('constant_' + typestr)],
                $runtime.simpleCombine(identity));

            if (type.isEnum) {
                for (let entry of type.entries) {
                    const value = new Ast.Value.Enum(entry);
                    value.getType = function() { return type; };
                    this._grammar.addRule('constant_' + typestr, [clean(entry)],
                        $runtime.simpleCombine(() => value));
                }
            } else if (type.isEntity) {
                if (!this._nonConstantTypes.has(typestr) && !this._idTypes.has(typestr))
                    this._grammar.addConstants('constant_' + typestr, 'GENERIC_ENTITY_' + type.type, type);
            }
        }
        return typestr;
    }

    _addOutParam(pname, typestr, cat, canonical) {
        this._grammar.declareSymbol('out_param_' + cat);
        if (cat === 'npp') {
            for (let candidate of canonical)
                this._grammar.addRule('out_param_' + typestr, [candidate], $runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
        }
        if (cat === 'npv' || cat === 'apv') {
            this._grammar.addRule('out_param_' + cat, [''], $runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
        } else {
            for (let candidate of canonical)
                this._grammar.addRule('out_param_' + cat, [candidate], $runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
        }
    }

    _recordOutputParam(pname, ptype, arg) {
        const key = pname + '+' + ptype;
        if (this._allParams.out.has(key))
            return;
        this._allParams.out.add(key);
        const typestr = this._recordType(ptype);

        if (ptype.isBoolean)
            return;

        let expansion;
        const argNameOverrides = this._langPack.ARGUMENT_NAME_OVERRIDES;
        if (pname in argNameOverrides)
            expansion = argNameOverrides[pname];
        else if (!arg.metadata.canonical)
            expansion = [clean(pname)];
        else if (typeof arg.metadata.canonical === 'string')
            expansion = [arg.metadata.canonical];

        if (expansion) {
            this._addOutParam(pname, typestr, 'npp', expansion);
        } else {
            Object.entries(arg.metadata.canonical).forEach(([cat, canonical]) => {
                if (cat !== 'default')
                    this._addOutParam(pname, typestr, cat, canonical);
            });
        }

    }

    async _loadTemplate(ex) {
        // return grammar rules added
        const rules = [];

        try {
            await ex.typecheck(this._schemas, true);
        } catch(e) {
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
                args.push(new Ast.ArgumentDef(Ast.ArgDirection.IN_REQ, pname, ptype, { canonical: pcanonical }, {}));

                this._allParams.in.set(pname + '+' + ptype, [pname, [typeToStringSafe(ptype), pcanonical]]);
                this._recordType(ptype);
            }

            ex.value.schema = new Ast.ExpressionSignature('action', args, false, false);
        } else {
            for (let pname in ex.args) {
                let ptype = ex.args[pname];

                //console.log('pname', pname);
                if (!(pname in ex.value.schema.inReq)) {
                    // somewhat of a hack, we declare the argument for the value,
                    // because later we will muck with schema only
                    ex.value.schema = ex.value.schema.addArguments([new Ast.ArgumentDef(
                        Ast.ArgDirection.IN_REQ,
                        pname,
                        ptype,
                        {canonical: clean(pname)},
                        {}
                    )]);
                }
                const pcanonical = ex.value.schema.getArgCanonical(pname);

                this._allParams.in.set(pname + '+' + ptype, [pname, [typeToStringSafe(ptype), pcanonical]]);
                this._recordType(ptype);
            }
            for (let pname in ex.value.schema.out) {
                let ptype = ex.value.schema.out[pname];
                this._recordOutputParam(pname, ptype, ex.value.schema.getArgument(pname));
            }
        }

        if (ex.type === 'query') {
            const human_entity_types = ['tt:contact', 'tt:username', 'org.wikidata:human'];
            if (ex.value.schema.hasArgument('id')) {
                let type = ex.value.schema.getArgument('id').type;
                if (type.isEntity && human_entity_types.includes(type.type)) {
                    let grammarCat = 'thingpedia_who_question';
                    this._grammar.addRule(grammarCat, [''], $runtime.simpleCombine(() => ex.value));
                    return [];
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
                    expansion.push(new $runtime.Placeholder(param, opt));
                } else {
                    expansion.push(chunk);
                }
            }

            this._grammar.addRule(grammarCat, expansion, $runtime.simpleCombine(() => ex.value));
            rules.push({ category: grammarCat, expansion: chunks, example: ex });
        }
        return rules;
    }

    _loadDevice(device) {
        this._grammar.addRule('constant_Entity__tt__device', [device.kind_canonical],
            $runtime.simpleCombine(() => new Ast.Value.Entity(device.kind, 'tt:device', null)));
    }

    _loadIdType(idType) {
        let type = typeToStringSafe(Type.Entity(idType.type));
        if (this._idTypes.has(type))
            return;

        if (idType.type.endsWith(':id')) {
            if (this._options.debug)
                console.log('Loaded type ' + type + ' as id type');
            this._idTypes.add(type);
        } else {
            if (idType.has_ner_support) {
                if (this._options.debug)
                    console.log('Loaded type ' + type + ' as generic entity');
            } else {
                if (this._options.debug)
                    console.log('Loaded type ' + type + ' as non-constant type');
                this._nonConstantTypes.add(type);
            }
        }
    }

    async _loadCanonical(kind) {
        const classDef = await this._schemas.getFullMeta(kind);
        const canonicals = {};
        Object.keys(classDef.queries).forEach((q) => {
            canonicals[q] = classDef.queries[q].metadata.canonical;
        });
        Object.keys(classDef.actions).forEach((a) => {
            canonicals[a] = classDef.actions[a].metadata.canonical;
        });
        return canonicals;
    }

    makeExample(type, args, value, preprocessed) {
        return new Ast.Example(
            -1,
            type,
            args,
            value,
            preprocessed,
            preprocessed,
            {}
        );
    }

    async _getDataset(kind) {
        return await this._tpClient.getExamplesByKinds(kind);
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
        ).filter((token) => token !== '');
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
                    if (usedInput.includes(in_param.name))
                        return true;
                }
            }
        }

        //TODO: check if two examples filter on the same output param
        return false;
    }


    async _expandDataset(canonical, expander, rules) {
        const filter = expander.example.value.filter;
        await Promise.all(rules.map((rule) =>  {
            if (rule.category !== 'thingpedia_query')
                return;
            if (expander.example.id === rule.example.id)
                return;

            // skip rules with filter on the same parameter
            if (rule.example.value.isFilter) {
                if (filter.isAtom && rule.example.value.filter.isAtom) {
                    if (filter.name === rule.example.value.filter.name)
                        return;
                }
            }
            if (this._conflictExample(expander.example, rule.example))
                return;

            // skip rules use the same arguments
            const args = Object.assign({}, expander.example.args);
            for (let arg of Object.keys(rule.example.args)) {
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
        const canonicals = await this._loadCanonical(kind);
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

        const datasets = await Promise.all(devices.map((d) => {
            return this._getDataset(d.kind);
        }));

        if (this._options.debug) {
            const countTemplates = datasets.map((d) => d.examples.length).reduce((a, b) => a+b, 0);
            console.log('Loaded ' + devices.length + ' devices');
            console.log('Loaded ' + countTemplates + ' templates');
        }
        idTypes.forEach(this._loadIdType, this);
        await Promise.all([
            Promise.all(devices.map(this._loadDevice, this)),
            Promise.all(datasets.map(this._loadDataset, this))
        ]);
    }
}

const MINIBATCH_SIZE = 5000;
class ContextualSentenceGenerator extends stream.Transform {
    constructor(options = {}) {
        super({ objectMode: true });
        options.contextual = true;
        options.targetGenSize = CONTEXTUAL_TARGET_GEN_SIZE;

        this._idPrefix = options.idPrefix;
        this._debug = options.debug;
        this._generator = new SentenceGenerator(options);

        this._minibatch = [];
        this._processed = 0;

        this._initialized = false;
        this._i = 0;
    }

    _output(depth, derivation) {
        const context = derivation.context;
        const program = derivation.value.optimize();
        assert(program !== null); // not-null even after optimize
        let preprocessed = derivation.toString();
        preprocessed = preprocessed.replace(/ +/g, ' ');
        preprocessed = this._generator.postprocess(preprocessed, program);
        let sequence;
        try {
            const entities = {};
            Object.assign(entities, context.entities);
            sequence = NNSyntax.toNN(program, context.code, entities);
            //ThingTalk.NNSyntax.fromNN(sequence, {});

            if (sequence.some((t) => t.endsWith(':undefined')))
                throw new TypeError(`Generated undefined type`);
        } catch(e) {
            //console.error(context.code.join(' '));
            console.error(preprocessed);
            console.error(program.prettyprint());
            console.error(sequence);

            console.error(program.prettyprint(program).trim());
            this.emit('error', e);
        }

        let id = String(this._i++);
        id = this._idPrefix + depth + '000000000'.substring(0,9-id.length) + id;
        const flags = {
            synthetic: true,
            contextual: true,
        };
        this.push({ depth, id, flags, preprocessed, context: context.code.join(' '), target_code: sequence.join(' ') });
    }

    async _process(minibatch) {
        if (!this._initialized) {
            await this._generator.initialize();
            this._initialized = true;
        }

        const start = Date.now();
        console.log(`Minibatch ${this._processed}-${this._processed+minibatch.length}`);

        const contexts = await Promise.all(minibatch.map(async (contextCode) => {
            const code = contextCode.split(' ');

            const entities = makeDummyEntities(contextCode);
            const program = ThingTalk.NNSyntax.fromNN(code, entities);
            await program.typecheck(this._generator.schemas, false);
            return new $runtime.Context(code, program, entities);
        }));

        for (let [depth, derivation] of this._generator.generate(contexts))
            this._output(depth, derivation);

        this._processed += minibatch.length;
        const end = Date.now();
        if (this._debug)
            console.log(`Minibatch took ${Math.round((end-start)/1000)} seconds`);
    }

    _transform(contextExample, encoding, callback) {
        this._minibatch.push(contextExample);
        if (this._minibatch.length < MINIBATCH_SIZE) {
            callback();
            return;
        }

        const minibatch = this._minibatch;
        this._minibatch = [];
        this._process(minibatch).then(callback, callback);
    }

    _flush(callback) {
        if (this._minibatch.length > 0)
            this._process(this._minibatch).then(callback, callback);
        else
            process.nextTick(callback);
    }
}

class BasicSentenceGenerator extends stream.Readable {
    constructor(options = {}) {
        super({ objectMode: true });
        options.contextual = false;
        options.targetGenSize = BASIC_TARGET_GEN_SIZE;
        this._generator = new SentenceGenerator(options);
        this._generator.on('progress', (value) => {
            this.emit('progress', value);
        });
        this._iterator = null;

        this._initialization = null;
        this._i = 0;
    }

    _read() {
        if (this._initialization === null)
            this._initialization = this._generator.initialize();

        this._initialization.then(() => this._minibatch()).catch((e) => {
            console.error(e);
            this.emit('error', e);
        });
    }

    _minibatch() {
        if (this._iterator === null)
            this._iterator = this._generator.generate();

        for (;;) {
            let { value, done } = this._iterator.next();
            if (done) {
                this.emit('progress', this._generator.progress);
                this.push(null);
                return;
            }
            const [depth, derivation] = value;
            if (!this._output(depth, derivation))
                return;
        }
    }

    _output(depth, derivation) {
        let program = derivation.value.optimize();
        assert(program !== null); // not-null even after optimize
        let preprocessed = derivation.toString();
        preprocessed = preprocessed.replace(/ +/g, ' ');
        preprocessed = this._generator.postprocess(preprocessed, program);
        let sequence;
        try {
            sequence = NNSyntax.toNN(program, {});
            //ThingTalk.NNSyntax.fromNN(sequence, {});

            if (sequence.some((t) => t.endsWith(':undefined')))
                throw new TypeError(`Generated undefined type`);
        } catch(e) {
            console.error(preprocessed);
            console.error(String(program));
            console.error(sequence);

            console.error(program.prettyprint(program).trim());
            this.emit('error', e);
        }
        let id = String(this._i++);
        id = depth + '000000000'.substring(0,9-id.length) + id;
        const flags = {
            synthetic: true
        };
        return this.push({ depth, id, flags, preprocessed, target_code: sequence.join(' ') });
    }
}

module.exports = {
    BasicSentenceGenerator,
    ContextualSentenceGenerator
};
