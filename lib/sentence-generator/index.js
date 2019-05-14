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

const ThingTalk = require('thingtalk');
const Grammar = ThingTalk.Grammar;
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const SchemaRetriever = ThingTalk.SchemaRetriever;
const NNSyntax = ThingTalk.NNSyntax;
const Units = ThingTalk.Units;

const { clean } = require('../utils');

const $runtime = require('./runtime');
const importGenie = require('../genie-compiler');
const { typeToStringSafe } = require('./ast_manip');
const i18n = require('../i18n');

function identity(x) {
    return x;
}

module.exports = class SentenceGenerator extends stream.Readable {
    constructor(options) {
        super({ objectMode: true });
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
        this._initialization = null;
        this._i = 0;
    }

    _read() {
        if (this._initialization === null)
            this._initialization = this._initialize();

        this._initialization.then(() => this._minibatch()).catch((e) => {
            console.error(e);
            this.emit('error', e);
        });
    }

    async _tryGetStandard(kind, functionType, fn) {
        try {
            return await this._schemas.getMeta(kind, functionType, fn);
        } catch(e) {
            return null;
        }
    }

    async _initialize() {
        const [say, get_gps, get_time] = await Promise.all([
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'action', 'say'),
            this._tryGetStandard('org.thingpedia.builtin.thingengine.phone', 'query', 'get_gps'),
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
        this._generator = this._grammar.generate(this._options);
    }

    _minibatch() {
        for (;;) {
            let { value, done } = this._generator.next();
            if (done) {
                this.push(null);
                return;
            }
            const [depth, derivation] = value;
            if (!this._output(depth, derivation))
                return;
        }
    }

    _output(depth, derivation) {
        let program = derivation.value;
        let preprocessed = derivation.toString();
        preprocessed = preprocessed.replace(/ +/g, ' ');
        preprocessed = this._postprocess(preprocessed, program, this._options.rng);
        let sequence;
        try {
            sequence = NNSyntax.toNN(program, {});
            //ThingTalk.NNSyntax.fromNN(sequence, {});

            if (sequence.some((t) => t.endsWith(':undefined')))
                throw new TypeError(`Generated undefined type`);
        } catch(e) {
            console.error(preprocessed);
            console.error(program);
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
                    this._grammar.addRule('constant_' + typestr, [clean(entry)],
                        $runtime.simpleCombine(() => new Ast.Value.Enum(entry)));
                }
            } else if (type.isEntity) {
                if (!this._nonConstantTypes.has(typestr) && !this._idTypes.has(typestr))
                    this._grammar.addConstants('constant_' + typestr, 'GENERIC_ENTITY_' + type.type, type);
            }
        }
        return typestr;
    }

    _recordOutputParam(pname, ptype, arg) {
        const key = pname + '+' + ptype;
        if (this._allParams.out.has(key))
            return;
        this._allParams.out.add(key);
        const typestr = this._recordType(ptype);

        if (ptype.isEnum || ptype.isBoolean)
            return;

        let expansion;
        const argNameOverrides = this._langPack.ARGUMENT_NAME_OVERRIDES;
        if (pname in argNameOverrides)
            expansion = argNameOverrides[pname];
        else
            expansion = [arg.metadata.canonical || clean(pname)];
        for (let candidate of expansion)
            this._grammar.addRule('out_param_' + typestr, [candidate], $runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
    }

    async _loadTemplate(ex) {
        try {
            await ex.typecheck(this._schemas, true);
        } catch(e) {
            console.error(`Failed to load example ${ex.id}: ${e.message}`);
            return;
        }

        // ignore builtin actions:
        // debug_log is not interesting, say is special and we handle differently, configure/discover are not
        // composable
        if (ex.type === 'action' && ex.value.invocation.selector.kind === 'org.thingpedia.builtin.thingengine.builtin') {
            if (this._options.flags.turking)
                return;
            if (!this._options.flags.configure_actions && (ex.value.invocation.channel === 'configure' || ex.value.invocation.channel === 'discover'))
            return;
            if (ex.value.invocation.channel === 'say')
                return;
        }
        if (ex.type === 'stream' && (ex.value.isTimer || ex.value.isAtTimer))
            return;
        if (this._options.flags.nofilter && (ex.value.isFilter || ex.value.isEdgeFilter || (ex.value.isMonitor && ex.value.table.isFilter)))
            return;

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
                const pcanonical = ex.value.schema.getArgument(pname).canonical || clean(pname);

                this._allParams.in.set(pname + '+' + ptype, [pname, [typeToStringSafe(ptype), pcanonical]]);
                this._recordType(ptype);
            }
            for (let pname in ex.value.schema.out) {
                let ptype = ex.value.schema.out[pname];
                this._recordOutputParam(pname, ptype, ex.value.schema.getArgument(pname));
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
        }
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

    async _loadDataset() {
        const code = await this._tpClient.getAllExamples();
        const parsed = await Grammar.parse(code);
        return parsed.datasets[0];
    }
    
    async _safeLoadTemplate(ex) {
        try {
            await this._loadTemplate(ex);
        } catch(e) {
            throw new TypeError(`Failed to load example ${ex.id}: ${e.message}`);
        }
    }

    async _loadMetadata() {
        const [dataset, devices, idTypes] = await Promise.all([
            this._loadDataset(),
            this._tpClient.getAllDeviceNames(),
            this._tpClient.getAllEntityTypes()
        ]);
        if (this._options.debug) {
            console.log('Loaded ' + devices.length + ' devices');
            console.log('Loaded ' + dataset.examples.length + ' templates');
        }

        idTypes.forEach(this._loadIdType, this);
        await Promise.all([
            Promise.all(devices.map(this._loadDevice, this)),
            Promise.all(dataset.examples.map(this._safeLoadTemplate, this))
        ]);
    }
};
