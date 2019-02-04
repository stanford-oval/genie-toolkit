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

const Grammar = require('../grammar_api');
const Ast = require('../ast');
const Type = require('../type');
const SchemaRetriever = require('../schema');
const NNSyntax = require('../nn_syntax');
const Units = require('../units');

const { clean } = require('../utils');

const $runtime = require('./runtime');
const TpLanguage = require('../../languages/thingpedia');
const { typeToStringSafe } = require('./ast_manip');

function identity(x) {
    return x;
}


// FIXME this info should be in Thingpedia
// if there is only a single value, this is possible without changing the parameter
// name by adding a #_[canonical] annotation
//
// (quite possibly, we can rely on PPDB and maybe some heuristics to deal
// with synonyms like "picture"-"image"-"photo")
const ARGUMENT_NAMES = {
    'updated': ['update time'],
    'random': ['random number'],

    'picture_url': ['picture', 'image', 'photo'],

    'title': ['headline', 'title'],

    'file_name': ['file name', 'name'],
    'file_size': ['file size', 'size', 'disk usage'],
    // not even silei knows about mime types, so definitely no mime type here!
    'mime_type': ['file type', 'type'],
};

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

        this._languageClass = require('../../languages/' + options.language + '/' + (options.targetLanguage || 'thingtalk'));
        this._postprocess = require('../../languages/' + options.language + '/postprocess');
        this._grammar = null;
        this._generator = null;
        this._initialization = null;
        this._i = 0;
    }

    _read() {
        if (this._initialization === null)
            this._initialization = this._initialize();

        this._initialization.then(() => this._minibatch())
            .catch((e) => this.emit('error', e));
    }

    async _initialize() {
        const $options = {
            flags: this._options,
            types: this._types,
            params: this._allParams,

            standardSchemas: {
                say: await this._schemas.getMeta('org.thingpedia.builtin.thingengine.builtin', 'action', 'say'),
                get_gps: await this._schemas.getMeta('org.thingpedia.builtin.thingengine.phone', 'query', 'get_gps'),
                get_time: await this._schemas.getMeta('org.thingpedia.builtin.thingengine.builtin', 'query', 'get_time')
            }
        };

        this._grammar = new $runtime.Grammar(this._options);
        TpLanguage($options, this._grammar);
        // make sure that these types are always available, regardless of which templates we have
        this._recordType(Type.String);
        this._recordType(Type.Date);
        this._recordType(Type.Currency);
        this._recordType(Type.Number);
        for (let unit of Units.BaseUnits)
            this._recordType(Type.Measure(unit));

        await this._loadMetadata();
        this._grammar = this._languageClass($options, this._grammar);
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
        let utterance = derivation.toString();
        utterance = utterance.replace(/ +/g, ' ');
        utterance = this._postprocess(utterance, program);
        let sequence;
        try {
            sequence = NNSyntax.toNN(program, {});
            //ThingTalk.NNSyntax.fromNN(sequence, {});

            if (sequence.some((t) => t.endsWith(':undefined')))
                throw new TypeError(`Generated undefined type`);
        } catch(e) {
            console.error(utterance);
            console.error(String(program));
            console.error(sequence);

            console.error(program.prettyprint(program).trim());
            this.emit('error', e);
        }

        let id = String(this._i++);
        id = depth + '000000000'.substring(0,9-id.length) + id;
        return this.push({ depth, id, utterance, target_code: sequence.join(' ') });
    }

    _recordType(type) {
        const typestr = typeToStringSafe(type);
        if (this._allTypes.has(typestr))
            return typestr;
        this._allTypes.set(typestr, type);

        this._grammar.declareSymbol('out_param_' + typestr);
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
        if (pname in ARGUMENT_NAMES)
            expansion = ARGUMENT_NAMES[pname];
        else
            expansion = [arg.metadata.canonical || clean(pname)];
        for (let candidate of expansion)
            this._grammar.addRule('out_param_' + typestr, [candidate], $runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
    }

    _loadTemplate(ex) {
        if (ex.type === 'program') {
            // FIXME
            // ignore examples that consist of a rule (they are just dataset)
            return;
        }

        // ignore builtin actions:
        // debug_log is not interesting, say is special and we handle differently, configure/discover are not
        // composable
        if (this._options.turking && ex.type === 'action' && ex.value.invocation.selector.kind === 'org.thingpedia.builtin.thingengine.builtin')
            return;
        if (ex.type === 'action' && ex.value.invocation.selector.kind === 'org.thingpedia.builtin.thingengine.builtin' && ex.value.channel === 'say')
            return;
        if (ex.type === 'stream' && (ex.value.isTimer || ex.value.isAtTimer))
            return;

        // ignore optional input parameters
        // if you care about optional, write a lambda template
        // that fills in the optionals

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
            this._allParams.in.set(pname + '+' + ptype, [pname, typeToStringSafe(ptype)]);
            this._recordType(ptype);
        }
        for (let pname in ex.value.schema.out) {
            let ptype = ex.value.schema.out[pname];
            this._recordOutputParam(pname, ptype, ex.value.schema.getArgument(pname));
        }

        for (let preprocessed of ex.preprocessed) {
            let grammarCat = 'thingpedia_' + ex.type;
            if (grammarCat === 'query' && preprocessed[0] === ',') {
                preprocessed = preprocessed.substring(1).trim();
                grammarCat = 'thingpedia_get_command';
            }

            let chunks = preprocessed.trim().split(' ');
            let expansion = [];

            for (let chunk of chunks) {
                if (chunk === '')
                    continue;
                if (chunk.startsWith('$') && chunk !== '$$') {
                    const [, param1, param2, opt] = /^\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?})$/.exec(chunk);
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
            if (this._options.debug)
                console.log('Loaded type ' + type + ' as non-constant type');
            this._nonConstantTypes.add(type);
        }
    }

    async _loadDataset() {
        const code = await this._tpClient.getAllExamples();
        const parsed = await Grammar.parseAndTypecheck(code, this._schemas);
        return parsed.datasets[0];
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
            Promise.all(dataset.examples.map(this._loadTemplate, this))
        ]);
    }
};
