// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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
//         Silei Xu <silei@cs.stanford.edu>
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Grammar = ThingTalk.Grammar;
const SchemaRetriever = ThingTalk.SchemaRetriever;
const Units = ThingTalk.Units;

const {
    clean,
    typeToStringSafe,
    makeFilter,
    makeAndFilter,
    makeDateRangeFilter,
    isHumanEntity,
    interrogativePronoun,
    tokenizeExample
} = require('./utils');
const { SlotBag } = require('./slot_bag');

function identity(x) {
    return x;
}

const ANNOTATION_RENAME = {
    'property': 'npp',
    'reverse_property': 'npi',
    'verb': 'avp',
    'passive_verb': 'pvp',
    'adjective': 'apv',
    'implicit_identity': 'npv'
};

const ANNOTATION_PRIORITY = {
    'base': 0,
    'npp': 0,
    'npi': 0,
    'avp': 0.4,
    'reverse_verb': 0.4,
    'adj': 0.5,
    'preposition': 0.4,
    'pvp': 0.2,
    'apv': 0.2,
    'npv': 1
};

class ThingpediaLoader {
    async init(runtime, grammar, langPack, options) {
        this._runtime = runtime;
        this._grammar = grammar;
        this._langPack = langPack;

        this._tpClient = options.thingpediaClient;
        if (!options.schemaRetriever) {
            options.schemaRetriever = new SchemaRetriever(this._tpClient, null,
                options.debug < this._runtime.LogLevel.DUMP_TEMPLATES);
        }
        this._schemas = options.schemaRetriever;

        this._options = options;

        this._allTypes = new Map;
        this._idTypes = new Set;
        this._entities = new Map;
        this.types = {
            all: this._allTypes,
            id: this._idTypes,
        };
        this.params = {
            in: new Map,
            out: new Map,
        };
        this.projections = new Map;
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
            this._recordType(new Type.Measure(unit));

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
        if (type.isRecurrentTimeSpecification)
            return null;

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
            }
        }
        return typestr;
    }

    _addOutParam(functionName, pname, type, typestr, canonical) {
        this._grammar.addRule('out_param_' + typestr, [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));

        if (type.isArray)
            this._grammar.addRule('out_param_Array__Any', [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));

        this._grammar.addRule('out_param_Any', [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
    }

    _recordInputParam(functionName, arg) {
        const pname = arg.name;
        const ptype = arg.type;
        const key = pname + '+' + ptype;
        const typestr = this._recordType(ptype);
        // FIXME match functionName
        //if (this.params.out.has(key))
        //    return;
        this.params.out.set(key, [pname, typestr]);

        // compound types are handled by recursing into their fields through iterateArguments()
        // except FIXME that probably won't work? we need to create a record object...
        if (ptype.isCompound)
            return;

        if (arg.metadata.prompt) {
            let prompt = arg.metadata.prompt;
            if (typeof prompt === 'string')
                prompt = [prompt];

            for (let form of prompt) {
                if (form.endsWith('?'))
                    form = form.substring(0, form.length-1).trim();

                // HACK: we should record the function name always, not just at inference time
                if (this._options.flags.inference) {
                    this._grammar.addRule('thingpedia_slot_fill_question', [form], this._runtime.simpleCombine(() => {
                        return { functionName, name: pname };
                    }));
                } else {
                    this._grammar.addRule('thingpedia_slot_fill_question', [form], this._runtime.simpleCombine(() => pname));
                }
            }
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

        const corefconst = new this._runtime.NonTerminal('coref_constant');
        const constant = new this._runtime.NonTerminal('constant_' + typestr);
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

            const attributes = { priority: ANNOTATION_PRIORITY[cat] };
            assert(Number.isFinite(attributes.priority), cat);
            if (cat === canonical['default'] ||
                cat === ANNOTATION_RENAME[canonical['default']])
                attributes.priority += 1;

            for (let form of annotvalue) {
                if (cat === 'base') {
                    this._grammar.addRule('input_param', [form], this._runtime.simpleCombine(() => pname), attributes);
                } else {
                    let [before, after] = form.split('#');
                    before = (before || '').trim();
                    after = (after || '').trim();

                    let expansion, corefexpansion;
                    if (before && after) {
                        expansion = [before, constant, after];
                        corefexpansion = [before, corefconst, after];
                    } else if (before) {
                        expansion = [before, constant, ''];
                        corefexpansion = [before, corefconst, ''];
                    } else if (after) {
                        expansion = ['', constant, after];
                        corefexpansion = ['', corefconst, after];
                    } else {
                        expansion = ['', constant, ''];
                        corefexpansion = ['', corefconst, ''];
                    }
                    this._grammar.addRule(cat + '_input_param', expansion, this._runtime.simpleCombine((_1, value, _2) => new Ast.InputParam(null, pname, value)), attributes);
                    this._grammar.addRule('coref_' + cat + '_input_param', corefexpansion, this._runtime.simpleCombine((_1, value, _2) => new Ast.InputParam(null, pname, value)), attributes);
                }

                if (this._options.flags.inference)
                    break;
            }
        }
    }

    _recordBooleanOutputParam(functionName, arg) {
        const pname = arg.name;
        const ptype = arg.type;
        const typestr = this._recordType(ptype);
        const pvar = new Ast.Value.VarRef(pname);

        let canonical;

        if (!arg.metadata.canonical)
            canonical = { base: [clean(pname)] };
        else if (typeof arg.metadata.canonical === 'string')
            canonical = { base: [arg.metadata.canonical] };
        else
            canonical = arg.metadata.canonical;

        for (let key in canonical) {
            if (key === 'default')
                continue;

            let annotvalue = canonical[key];
            if (!Array.isArray(annotvalue))
                annotvalue = [annotvalue];
            if (key === 'base') {
                for (let form of annotvalue)
                    this._addOutParam(functionName, pname, ptype, typestr, form.trim());

                continue;
            }

            const match = /^([a-zA-Z_]+)_(true|false)$/.exec(key);
            if (match === null) {
                console.error(`Invalid canonical key ${key} for boolean output parameter ${functionName}:${arg.name}`);
                continue;
            }
            let cat = match[1];
            const value = new Ast.Value.Boolean(match[2] === 'true');

            if (cat in ANNOTATION_RENAME)
                cat = ANNOTATION_RENAME[cat];
            const attributes = {
                repeat: true,
                priority: ANNOTATION_PRIORITY[cat]
            };
            if (cat === canonical['default'] ||
                cat === ANNOTATION_RENAME[canonical['default']])
                attributes.priority += 1;

            for (let form of annotvalue) {
                this._grammar.addRule(cat + '_filter', [form], this._runtime.simpleCombine(() => makeFilter(this, pvar, '==', value, false)), attributes);
                this._grammar.addRule(cat + '_boolean_projection', [form], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));

                if (this._options.flags.inference)
                    break;
            }

        }
    }

    _recordOutputParam(functionName, arg) {
        const pname = arg.name;
        const ptype = arg.type;
        const key = pname + '+' + ptype;
        const typestr = this._recordType(ptype);
        // FIXME match functionName
        //if (this.params.out.has(key))
        //    return;
        this.params.out.set(key, [pname, typestr]);

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
        if (arg.metadata.question) {
            let question = arg.metadata.question;
            if (typeof question === 'string')
                question = [question];

            for (let form of question)
                this._grammar.addRule('thingpedia_user_question', [form], this._runtime.simpleCombine(() => [[pname, ptype]]));
        }

        if (ptype.isBoolean) {
            this._recordBooleanOutputParam(functionName, arg);
            return;
        }

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
        else if (Array.isArray(arg.metadata.canonical))
            canonical = { base: arg.metadata.canonical };
        else
            canonical = arg.metadata.canonical;

        let vtype = ptype;
        let op = '==';

        // true if slot can use a form with "both", that is, "serves both chinese and italian"
        // this should be only allowed for operator 'contains', and it's disabled for turking mode
        // FIXME: allow `=~` for long text (note: we turn == into =~ in MakeFilter)
        let canUseBothForm = false;

        if (arg.annotations.slot_operator) {
            op = arg.annotations.slot_operator.toJS();
            assert(['==', '>=', '<=', 'contains'].includes(op));
        } else {
            if (ptype.isArray) {
                vtype = ptype.elem;
                op = 'contains';
            } else if (ptype.isRecurrentTimeSpecification) {
                vtype = [Type.Date, Type.Time];
                op = 'contains';
            } else if (pname === 'id') {
                vtype = Type.String;
            }
        }

        if (!this._options.flags.turking && op === 'contains')
            canUseBothForm = true;

        if (!Array.isArray(vtype))
            vtype = [vtype];

        for (let type of vtype)
            this._recordOutputParamByType(functionName, pname, ptype, op, type, canonical, canUseBothForm);
    }

    _recordOutputParamByType(functionName, pname, ptype, op, vtype, canonical, canUseBothForm) {
        const pvar = new Ast.Value.VarRef(pname);
        const typestr = this._recordType(ptype);
        const vtypestr = this._recordType(vtype);
        if (vtypestr === null)
            return;

        const constant = new this._runtime.NonTerminal('constant_' + vtypestr);
        const corefconst = new this._runtime.NonTerminal('coref_constant');
        for (let cat in canonical) {
            if (cat === 'default' || cat === 'projection_pronoun')
                continue;

            let annotvalue = canonical[cat];
            let isEnum = false, argMinMax = undefined, isProjection = false;
            if (vtype.isEnum && cat.endsWith('_enum')) {
                cat = cat.substring(0, cat.length - '_enum'.length);
                isEnum = true;
            } else if (cat.endsWith('_argmin') || cat.endsWith('_argmax')) {
                argMinMax = cat.endsWith('_argmin') ? 'asc' : 'desc';
                // _argmin is the same length as _argmax
                cat = cat.substring(0, cat.length - '_argmin'.length);
            } else if (cat.endsWith('_projection')) {
                cat = cat.substring(0, cat.length - '_projection'.length);
                isProjection = true;
            }

            if (cat in ANNOTATION_RENAME)
                cat = ANNOTATION_RENAME[cat];

            if (cat === 'apv' && typeof annotvalue === 'boolean') {
                // compat
                if (annotvalue)
                    annotvalue = ['#'];
                else
                    annotvalue = [];
            }

            const attributes = {
                repeat: true,
                priority: ANNOTATION_PRIORITY[cat]
            };
            assert(Number.isFinite(attributes.priority), cat);
            if (cat === canonical['default'] ||
                cat === ANNOTATION_RENAME[canonical['default']])
                attributes.priority += 1;

            if (cat === 'npv') {
                if (typeof annotvalue !== 'boolean')
                    throw new TypeError(`Invalid annotation #_[canonical.implicit_identity=${annotvalue}] for ${functionName}`);
                if (annotvalue) {
                    const expansion = [constant];
                    this._grammar.addRule(cat + '_filter', expansion, this._runtime.simpleCombine((value) => makeFilter(this, pvar, op, value, false)), attributes);
                    this._grammar.addRule('coref_' + cat + '_filter', [corefconst], this._runtime.simpleCombine((value) => makeFilter(this, pvar, op, value, false)), attributes);
                }
                continue;
            }

            if (isEnum) {
                for (let enumerand in annotvalue) {
                    let forms = annotvalue[enumerand];
                    if (!Array.isArray(forms))
                        forms = [forms];
                    const value = new Ast.Value.Enum(enumerand);
                    for (let form of forms)
                        this._grammar.addRule(cat + '_filter', [form], this._runtime.simpleCombine(() => makeFilter(this, pvar, op, value, false)), attributes);
                }
            } else if (argMinMax) {
                if (!Array.isArray(annotvalue))
                    annotvalue = [annotvalue];

                for (let form of annotvalue) {
                    this._grammar.addRule(cat + '_argminmax', [form], this._runtime.simpleCombine(() => [pvar, argMinMax]), attributes);
                    if (this._options.flags.inference)
                        break;
                }
            } else if (isProjection) {
                if (cat === 'base')
                    continue;

                // FIXME: if two params with the same name have different interrogative pronouns, this approach is problematic...
                if (!(pname in this.projections))
                    this.projections[pname] = {};
                if (!(cat in this.projections[pname]))
                    this.projections[pname][cat] = [];

                for (let form of annotvalue) {
                    // always have what question for projection if base available
                    if (canonical.base_projection) {
                        for (let base of canonical.base_projection) {
                            this._addProjections(pname, 'what', cat, base, form);
                            this._addProjections(pname, 'which', cat, base, form);
                        }
                    }

                    // add non-what question when applicable
                    // `base` is no longer need for non-what question, thus leave as empty string
                    if (canonical.projection_pronoun) {
                        for (let pronoun of canonical.projection_pronoun)
                            this._addProjections(pname, pronoun, cat, '', form);

                    } else {
                        const pronounType = interrogativePronoun(ptype);
                        if (pronounType !== 'what') {
                            const pronouns = {
                                'when': ['when', 'what time'],
                                'where': ['where'],
                                'who': ['who']
                            };
                            assert(pronounType in pronouns);
                            for (let pronoun of pronouns[pronounType])
                                this._addProjections(pname, pronoun, cat, '', form);
                        }
                    }

                    if (this._options.flags.inference)
                        break;
                }

            } else {
                if (!Array.isArray(annotvalue))
                    annotvalue = [annotvalue];

                for (let form of annotvalue) {
                    if (cat === 'base') {
                        this._addOutParam(functionName, pname, ptype, typestr, form.trim());
                        if (!canonical.npp && !canonical.property) {
                            const expansion = [form, constant];
                            this._grammar.addRule('npp_filter', expansion, this._runtime.simpleCombine((_, value) => makeFilter(this, pvar, op, value, false)));
                            const corefexpansion = [form, corefconst];
                            this._grammar.addRule('coref_npp_filter', corefexpansion, this._runtime.simpleCombine((_, value) => makeFilter(this, pvar, op, value, false)), attributes);

                            if (canUseBothForm) {
                                const pairexpansion = [form, new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs')];
                                this._grammar.addRule('npp_filter', pairexpansion, this._runtime.simpleCombine((_1, _2, values) => makeAndFilter(this, pvar, op, values, false)), attributes);
                            }
                        }
                    } else {
                        let [before, after] = form.split('#');
                        before = (before || '').trim();
                        after = (after || '').trim();

                        let expansion, corefexpansion, pairexpansion, daterangeexpansion;
                        if (before && after) {
                            // "rated # stars"
                            expansion = [before, constant, after];
                            corefexpansion = [before, corefconst, after];
                            pairexpansion = [before, new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs'), after];
                            daterangeexpansion = [before, new this._runtime.NonTerminal('constant_date_range'), after];
                        } else if (before) {
                            // "named #"
                            expansion = [before, constant, ''];
                            corefexpansion = [before, corefconst, ''];
                            pairexpansion = [before, new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs'), ''];
                            daterangeexpansion = [before, new this._runtime.NonTerminal('constant_date_range'), ''];
                        } else if (after) {
                            // "# -ly priced"
                            expansion = ['', constant, after];
                            corefexpansion = ['', corefconst, after];
                            pairexpansion = ['', new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs'), after];
                            daterangeexpansion = ['', new this._runtime.NonTerminal('constant_date_range'), after];
                        } else {
                            // "#" (as in "# restaurant")
                            expansion = ['', constant, ''];
                            corefexpansion = ['', corefconst, ''];
                            pairexpansion = ['', new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs'), ''];
                            daterangeexpansion = ['', new this._runtime.NonTerminal('constant_date_range'), ''];
                        }
                        this._grammar.addRule(cat + '_filter', expansion, this._runtime.simpleCombine((_1, value, _2) => makeFilter(this, pvar, op, value, false)), attributes);
                        this._grammar.addRule('coref_' + cat + '_filter', corefexpansion, this._runtime.simpleCombine((_1, value, _2) => makeFilter(this, pvar, op, value, false)), attributes);
                        if (canUseBothForm)
                            this._grammar.addRule(cat + '_filter', pairexpansion, this._runtime.simpleCombine((_1, _2, values, _3) => makeAndFilter(this, pvar, op, values, false)), attributes);
                        if (ptype.isDate)
                            this._grammar.addRule(cat + '_filter', daterangeexpansion, this._runtime.simpleCombine((_1, values, _2) => makeDateRangeFilter(this, pvar, values)), attributes);
                    }

                    if (this._options.flags.inference)
                        break;
                }
            }
        }
    }

    _addProjections(pname, pronoun, posCategory, base, canonical) {
        if (canonical.includes('|')) {
            const [verb, prep] = canonical.split('|').map((span) => span.trim());
            this.projections[pname][posCategory].push([`${prep} ${pronoun}`, base, verb]);

            // for when question, we can drop the prep entirely
            if (pronoun === 'when' || pronoun === 'what time')
                this.projections[pname][posCategory].push([pronoun, base, verb]);
        }
        this.projections[pname][posCategory].push([pronoun, base, canonical.replace(/\|/g, ' ')]);


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

        if (!ex.preprocessed || ex.preprocessed.length === 0) {
            // preprocess here...
            const tokenizer = this._langPack.getTokenizer();
            ex.preprocessed = ex.utterances.map((utterance) => tokenizeExample(tokenizer, utterance, ex.id));
        }

        for (let preprocessed of ex.preprocessed) {
            let grammarCat = 'thingpedia_' + ex.type;

            if (grammarCat === 'thingpedia_query' && preprocessed[0] === ',') {
                preprocessed = preprocessed.substring(1).trim();
                grammarCat = 'thingpedia_get_command';
            }

            if (this._options.debug >= this._runtime.LogLevel.INFO && preprocessed[0].startsWith(','))
                console.log(`WARNING: template ${ex.id} starts with , but is not a query`);

            if (this._options.flags.for_agent)
                preprocessed = this._langPack.toAgentSideUtterance(preprocessed);

            const chunks = this._addPrimitiveTemplate(grammarCat, preprocessed, ex.value);
            rules.push({ category: grammarCat, expansion: chunks, example: ex });

            if (grammarCat === 'thingpedia_action') {
                const pastform = this._langPack.toVerbPast(preprocessed);
                if (pastform)
                    this._addPrimitiveTemplate('thingpedia_action_past', pastform, ex.value);
            }

            if (this._options.flags.inference)
                break;
        }
        return rules;
    }

    _addPrimitiveTemplate(grammarCat, preprocessed, value) {
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

        this._grammar.addRule(grammarCat, expansion, this._runtime.simpleCombine(() => value));
        return chunks;
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

        let shortCanonical = q.metadata.canonical_short || canonical;
        if (!Array.isArray(shortCanonical))
            shortCanonical = [shortCanonical];
        for (let form of shortCanonical) {
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
        if (id.getImplementationAnnotation('filterable') === false)
            return;

        const idType = id.type;
        const entity = this._entities[idType.type];
        if (!entity || !entity.has_ner_support)
            return;

        const schemaClone = table.schema.clone();
        schemaClone.is_list = false;
        schemaClone.no_filter = true;
        this._grammar.addConstants('constant_name', 'GENERIC_ENTITY_' + idType.type, idType);

        const idfilter = new Ast.BooleanExpression.Atom(null, 'id', '==', new Ast.Value.VarRef('p_id'));
        await this._loadTemplate(new Ast.Example(
            null,
            -1,
            'query',
            { p_id: id.type },
            new Ast.Table.Filter(null, table, idfilter, schemaClone),
            [`\${p_id:no-undefined}`],
            [`\${p_id:no-undefined}`],
            {}
        ));
        const namefilter = new Ast.BooleanExpression.Atom(null, 'id', '=~', new Ast.Value.VarRef('p_name'));
        let span;
        if (q.name === 'Person')
            span = [`\${p_name:no-undefined}`, ...canonical.map((c) => `\${p_name:no-undefined} ${c}`)];
        else
            span = [`\${p_name:no-undefined}`, ...canonical.map((c) => `\${p_name:no-undefined} ${c}`), ...canonical.map((c) => `${c} \${p_name:no-undefined}`)];
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

        if (functionDef.functionType === 'query') {
            if (functionDef.is_list && functionDef.hasArgument('id')) {
                const idarg = functionDef.getArgument('id');
                if (idarg.type.isEntity && idarg.type.type === functionName) {
                    this.idQueries.set(functionName, functionDef);
                    this._idTypes.add(typeToStringSafe(idarg.type));
                }
            }

            await this._makeExampleFromQuery(functionDef);
        }

        if (functionDef.metadata.result)
            await this._loadCustomResultString(functionDef);
        if (functionDef.metadata.on_error)
            await this._loadCustomErrorMessages(functionDef);
    }

    async _loadCustomErrorMessages(functionDef) {
        for (let code in functionDef.metadata.on_error) {
            let messages = functionDef.metadata.on_error[code];
            if (!Array.isArray(messages))
                messages = [messages];

            for (let msg of messages) {
                const bag = new SlotBag(functionDef);

                let chunks = msg.trim().split(' ');
                for (let chunk of chunks) {
                    if (chunk === '')
                        continue;
                    if (chunk.startsWith('$') && chunk !== '$$') {
                        const [, param1, param2,] = /^\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})$/.exec(chunk);
                        const pname = param1 || param2;
                        assert(pname);
                        const ptype = functionDef.getArgType(pname);
                        const pcanonical = functionDef.getArgCanonical(pname);
                        this.params.in.set(pname + '+' + ptype, [pname, [typeToStringSafe(ptype), pcanonical]]);
                        this._recordType(ptype);
                    }
                }

                this._addPrimitiveTemplate('thingpedia_error_message', msg, { code, bag });
            }
        }
    }

    async _loadCustomResultString(functionDef) {
        let resultstring = functionDef.metadata.result;
        if (!Array.isArray(resultstring))
            resultstring = [resultstring];

        for (let form of resultstring)
            this._addPrimitiveTemplate('thingpedia_result', form, new SlotBag(functionDef));
    }

    async _loadDevice(kind) {
        const classDef = await this._schemas.getFullMeta(kind);

        if (classDef.metadata.canonical) {
            this._grammar.addRule('constant_Entity__tt__device', [classDef.metadata.canonical],
                this._runtime.simpleCombine(() => new Ast.Value.Entity(kind, 'tt:device', null)));
        }

        for (let entity of classDef.entities) {
            const hasNer = entity.impl_annotations.has_ner ?
                entity.impl_annotations.has_ner.toJS() : true;
            this._loadEntityType(classDef.kind + ':' + entity.name, hasNer);
        }

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

    _loadEntityType(entityType, hasNerSupport) {
        this._entities[entityType] = { has_ner_support: hasNerSupport };
    }

    _addEntityConstants() {
        for (let entityType in this._entities) {
            const ttType = new Type.Entity(entityType);
            let typestr = typeToStringSafe(ttType);
            const { has_ner_support } = this._entities[entityType];

            if (has_ner_support) {
                if (this._idTypes.has(typestr)) {
                    if (this._options.debug >= this._runtime.LogLevel.DUMP_TEMPLATES)
                        console.log('Loaded entity ' + entityType + ' as id entity');
                } else {
                    if (this._options.debug >= this._runtime.LogLevel.DUMP_TEMPLATES)
                        console.log('Loaded entity ' + entityType + ' as generic entity');
                }

                this._grammar.declareSymbol('constant_' + typestr);
                this._grammar.addConstants('constant_' + typestr, 'GENERIC_ENTITY_' + entityType, ttType);
            } else {
                if (this._options.debug >= this._runtime.LogLevel.DUMP_TEMPLATES)
                    console.log('Loaded entity ' + entityType + ' as non-constant entity');
            }
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

    // load dataset for one device
    async _loadDataset(dataset) {
        for (let ex of dataset.examples)
            await this._safeLoadTemplate(ex);
    }

    async _safeLoadTemplate(ex) {
        try {
            return await this._loadTemplate(ex);
        } catch(e) {
            throw new TypeError(`Failed to load example ${ex.id}: ${e.message}`);
        }
    }

    async _getAllDeviceNames() {
        const devices = await this._tpClient.getAllDeviceNames();
        return devices.map((d) => d.kind);
    }

    async _getDataset(kind) {
        return this._tpClient.getExamplesByKinds([kind]);
    }

    async _loadMetadata() {
        const entityTypes = await this._tpClient.getAllEntityTypes();

        let devices;
        if (this._options.onlyDevices)
            devices = this._options.onlyDevices;
        else
            devices = await this._getAllDeviceNames();

        // called for no devices (inference mode, during init before the first command)
        if (devices.length === 0)
            return;

        // note: no typecheck() when loading dataset.tt
        // each example is typechecked individually so you can concatenate extraneous
        // datasets and they will be removed
        let datasets;
        if (this._options.onlyDevices) {
            datasets = await Promise.all(devices.map(async (d) => {
                return Grammar.parse(await this._getDataset(d)).datasets[0];
            }));
            datasets = datasets.filter((d) => !!d);
        } else {
            const code = await this._tpClient.getAllExamples();
            datasets = Grammar.parse(code).datasets;
        }

        if (this._options.debug >= this._runtime.LogLevel.INFO) {
            const countTemplates = datasets.map((d) => d.examples.length).reduce((a, b) => a+b, 0);
            console.log('Loaded ' + devices.length + ' devices');
            console.log('Loaded ' + countTemplates + ' templates');
        }

        for (let entity of entityTypes)
            this._loadEntityType(entity.type, entity.type.startsWith('tt:') && entity.has_ner_support);
        for (let device of devices)
            await this._loadDevice(device);
        this._addEntityConstants();
        for (let dataset of datasets)
            await this._loadDataset(dataset);
    }
}

module.exports = new ThingpediaLoader();
