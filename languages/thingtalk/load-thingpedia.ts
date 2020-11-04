// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


import assert from 'assert';

import {
    Ast,
    Type,
    Grammar,
    SchemaRetriever
} from 'thingtalk';
import * as Units from 'thingtalk-units';
import type * as Genie from 'genie-toolkit';
import type * as Tp from 'thingpedia';

import {
    clean,
    typeToStringSafe,
    makeFilter,
    makeAndFilter,
    makeDateRangeFilter,
    isHumanEntity,
    interrogativePronoun,
    tokenizeExample
} from './utils';
import { SlotBag } from './slot_bag';

function identity<T>(x : T) : T {
    return x;
}

const ANNOTATION_RENAME : Record<string, string> = {
    'property': 'npp',
    'reverse_property': 'npi',
    'verb': 'avp',
    'passive_verb': 'pvp',
    'adjective': 'apv',
    'implicit_identity': 'npv'
};

const ANNOTATION_PRIORITY : Record<string, number> = {
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

interface CanonicalForm {
    default : string;

    property ?: string|string[];
    reverse_property ?: string|string[];
    verb ?: string|string[];
    passive_verb ?: string|string[];
    adjective ?: string|string[];
    npp ?: string|string[];
    npi ?: string|string[];
    avp ?: string|string[];
    pvp ?: string|string[];
    apv ?: string|string[];

    base_projection ?: string;
    projection_pronoun ?: string;

    npv ?: boolean;
    implicit_identity ?: boolean;
}

interface GrammarOptions {
    thingpediaClient : Tp.BaseClient;
    schemaRetriever ?: SchemaRetriever;
    flags : { [key : string] : boolean };
    debug : number;
    onlyDevices ?: string[];
    whiteList ?: string;
}

export class ThingpediaLoader {
    private _runtime ! : typeof Genie.SentenceGeneratorRuntime;
    private _grammar ! : Genie.SentenceGenerator<any, Ast.Input>;
    private _schemas ! : SchemaRetriever;
    private _tpClient ! : Tp.BaseClient;
    private _langPack ! : Genie.I18n.LanguagePack;
    private _options ! : GrammarOptions;
    private _allTypes ! : Map<string, Type>;
    private _idTypes ! : Set<string>;
    private _entities ! : Record<string, { has_ner_support : boolean }>;
    types ! : {
        readonly all : Map<string, Type>;
        readonly id : Set<string>;
    };
    params ! : {
        readonly in : Map<string, [string, [string, string]]>;
        readonly out : Map<string, [string, string]>;
    };
    projections ! : {
        [pname : string] : {
            [cat : string] : Array<[string, string, string]>;
        };
    };
    idQueries ! : Map<string, Ast.FunctionDef>;
    compoundArrays ! : { [key : string] : InstanceType<typeof Type.Compound> };
    globalWhiteList ! : string[]|null;
    standardSchemas ! : {
        say : Ast.FunctionDef|null;
        get_gps : Ast.FunctionDef|null;
        get_time : Ast.FunctionDef|null;
    };

    async init(runtime : typeof Genie.SentenceGeneratorRuntime,
               grammar : Genie.SentenceGenerator<any, Ast.Input>,
               langPack : Genie.I18n.LanguagePack,
               options : GrammarOptions) : Promise<void> {
        this._runtime = runtime;
        this._grammar = grammar;
        this._langPack = langPack;

        this._tpClient = options.thingpediaClient;
        if (!options.schemaRetriever) {
            options.schemaRetriever = new SchemaRetriever(this._tpClient, null,
                options.debug < this._runtime.LogLevel.DUMP_TEMPLATES);
        }
        this._schemas = options.schemaRetriever!;

        this._options = options;

        this._allTypes = new Map;
        this._idTypes = new Set;
        this._entities = {};
        this.types = {
            all: this._allTypes,
            id: this._idTypes,
        };
        this.params = {
            in: new Map,
            out: new Map,
        };
        this.projections = {};
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
        for (const unit of Units.BaseUnits)
            this._recordType(new Type.Measure(unit));

        await this._loadMetadata();
    }

    get flags() {
        return this._options.flags;
    }

    private async _tryGetStandard(kind : string,
                                  functionType : 'query'|'action',
                                  fn : string) {
        try {
            return await this._schemas.getMeta(kind, functionType, fn);
        } catch(e) {
            return null;
        }
    }

    private _recordType(type : Type) {
        if (type instanceof Type.Compound) {
            for (const field in type.fields)
                this._recordType(type.fields[field].type);
            return null;
        }
        if (type instanceof Type.Array)
            this._recordType(type.elem as Type);
        const typestr = typeToStringSafe(type);
        if (this._allTypes.has(typestr))
            return typestr;
        this._allTypes.set(typestr, type);

        this._grammar.declareSymbol('out_param_' + typestr);
        if (type.isRecurrentTimeSpecification)
            return typestr;

        this._grammar.declareSymbol('placeholder_' + typestr);
        if (!this._grammar.hasSymbol('constant_' + typestr)) {
            if (!type.isEnum && !type.isEntity && !type.isArray)
                throw new Error('Missing definition for type ' + typestr);
            this._grammar.declareSymbol('constant_' + typestr);
            this._grammar.addRule('constant_Any', [new this._runtime.NonTerminal('constant_' + typestr)],
                this._runtime.simpleCombine(identity));

            if (type instanceof Type.Enum) {
                for (const entry of type.entries!) {
                    const value = new Ast.Value.Enum(entry);
                    value.getType = function() { return type; };
                    this._grammar.addRule('constant_' + typestr, [clean(entry)],
                        this._runtime.simpleCombine(() => value));
                }
            }
        }
        return typestr;
    }

    private _addOutParam(functionName : string,
                         pname : string,
                         type : Type,
                         typestr : string,
                         canonical : string) {
        this._grammar.addRule('out_param_' + typestr, [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));

        if (type.isArray)
            this._grammar.addRule('out_param_Array__Any', [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));

        this._grammar.addRule('out_param_Any', [canonical], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));
    }

    private _recordInputParam(functionName : string, arg : Ast.ArgumentDef) {
        const pname = arg.name;
        const ptype = arg.type;
        const key = pname + '+' + ptype;
        const typestr = this._recordType(ptype);
        if (!typestr)
            return;
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

            for (const form of annotvalue) {
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
                    this._grammar.addRule(cat + '_input_param', expansion, this._runtime.simpleCombine((_1, value : Ast.Value, _2) => new Ast.InputParam(null, pname, value)), attributes);
                    this._grammar.addRule('coref_' + cat + '_input_param', corefexpansion, this._runtime.simpleCombine((_1, value : Ast.Value, _2) => new Ast.InputParam(null, pname, value)), attributes);
                }

                if (this._options.flags.inference)
                    break;
            }
        }
    }

    private _recordBooleanOutputParam(functionName : string, arg : Ast.ArgumentDef) {
        const pname = arg.name;
        const ptype = arg.type;
        const typestr = this._recordType(ptype);
        if (!typestr)
            return;
        const pvar = new Ast.Value.VarRef(pname);

        let canonical;

        if (!arg.metadata.canonical)
            canonical = { base: [clean(pname)] };
        else if (typeof arg.metadata.canonical === 'string')
            canonical = { base: [arg.metadata.canonical] };
        else
            canonical = arg.metadata.canonical;

        for (const key in canonical) {
            if (key === 'default')
                continue;

            let annotvalue = canonical[key];
            if (!Array.isArray(annotvalue))
                annotvalue = [annotvalue];
            if (key === 'base') {
                for (const form of annotvalue)
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

            for (const form of annotvalue) {
                this._grammar.addRule(cat + '_filter', [form], this._runtime.simpleCombine(() => makeFilter(this, pvar, '==', value, false)), attributes);
                this._grammar.addRule(cat + '_boolean_projection', [form], this._runtime.simpleCombine(() => new Ast.Value.VarRef(pname)));

                if (this._options.flags.inference)
                    break;
            }

        }
    }

    private _recordOutputParam(functionName : string, arg : Ast.ArgumentDef) {
        const pname = arg.name;
        const ptype = arg.type;
        const key = pname + '+' + ptype;
        const typestr = this._recordType(ptype);
        if (!typestr)
            return;
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

            for (const form of prompt)
                this._grammar.addRule('thingpedia_search_question', [form], this._runtime.simpleCombine(() => pvar));
        }
        if (arg.metadata.question) {
            let question = arg.metadata.question;
            if (typeof question === 'string')
                question = [question];

            for (const form of question)
                this._grammar.addRule('thingpedia_user_question', [form], this._runtime.simpleCombine(() => [[pname, ptype]]));
        }

        if (ptype.isBoolean) {
            this._recordBooleanOutputParam(functionName, arg);
            return;
        }

        if (ptype instanceof Type.Array && ptype.elem instanceof Type.Compound) {
            this.compoundArrays[pname] = ptype.elem;
            for (const field in ptype.elem.fields) {
                const arg = ptype.elem.fields[field];
                this._recordOutputParam(functionName, arg);
            }
        }

        if (arg.metadata.counted_object) {
            const forms = Array.isArray(arg.metadata.counted_object) ?
                arg.metadata.counted_object : [arg.metadata.counted_object];
            for (const form of forms)
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

        const vtype = ptype;
        let op = '==';

        // true if slot can use a form with "both", that is, "serves both chinese and italian"
        // this should be only allowed for operator 'contains', and it's disabled for turking mode
        // FIXME: allow `=~` for long text (note: we turn == into =~ in MakeFilter)
        let canUseBothForm = false;

        let vtypes : Type[] = [vtype];
        const slotOperator = arg.getImplementationAnnotation<string>('slot_operator');
        if (slotOperator) {
            op = slotOperator;
            assert(['==', '>=', '<=', 'contains'].includes(op));
        } else {
            if (ptype instanceof Type.Array) {
                vtypes = [ptype.elem as Type];
                op = 'contains';
            } else if (ptype.isRecurrentTimeSpecification) {
                vtypes = [Type.Date, Type.Time];
                op = 'contains';
            } else if (pname === 'id') {
                vtypes = [Type.String];
            }
        }

        if (!this._options.flags.turking && op === 'contains')
            canUseBothForm = true;

        for (const type of vtypes)
            this._recordOutputParamByType(functionName, pname, ptype, op, type, canonical, canUseBothForm);
    }

    private _recordOutputParamByType(functionName : string,
                                     pname : string,
                                     ptype : Type,
                                     op : string,
                                     vtype : Type,
                                     canonical : CanonicalForm,
                                     canUseBothForm : boolean) {
        const pvar = new Ast.Value.VarRef(pname);
        const typestr = this._recordType(ptype);
        if (!typestr)
            return;
        const vtypestr = this._recordType(vtype);
        if (vtypestr === null)
            return;

        const constant = new this._runtime.NonTerminal('constant_' + vtypestr);
        const corefconst = new this._runtime.NonTerminal('coref_constant');
        for (let cat in canonical) {
            if (cat === 'default' || cat === 'projection_pronoun')
                continue;

            let annotvalue = canonical[cat as keyof CanonicalForm]!;
            let isEnum = false, argMinMax : 'asc'|'desc'|undefined = undefined, isProjection = false;
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
                    this._grammar.addRule(cat + '_filter', expansion, this._runtime.simpleCombine((value : Ast.Value) => makeFilter(this, pvar, op, value, false)), attributes);
                    this._grammar.addRule('coref_' + cat + '_filter', [corefconst], this._runtime.simpleCombine((value : Ast.Value) => makeFilter(this, pvar, op, value, false)), attributes);
                }
                continue;
            }

            if (isEnum) {
                for (const enumerand in (annotvalue as unknown as Record<string, string|string[]>)) {
                    const forms = (annotvalue as unknown as Record<string, string|string[]>)[enumerand];
                    let formarray : string[];
                    if (!Array.isArray(forms))
                        formarray = [forms];
                    else
                        formarray = forms;
                    const value = new Ast.Value.Enum(enumerand);
                    for (const form of formarray)
                        this._grammar.addRule(cat + '_filter', [form], this._runtime.simpleCombine(() => makeFilter(this, pvar, op, value, false)), attributes);
                }
            } else if (argMinMax) {
                let annotarray : string[];
                if (!Array.isArray(annotvalue)) {
                    assert(typeof annotvalue === 'string');
                    annotarray = [annotvalue];
                } else {
                    annotarray = annotvalue;
                }

                for (const form of annotarray) {
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

                let annotarray : string[];
                if (!Array.isArray(annotvalue)) {
                    assert(typeof annotvalue === 'string');
                    annotarray = [annotvalue];
                } else {
                    annotarray = annotvalue;
                }

                for (const form of annotarray) {
                    // always have what question for projection if base available
                    if (canonical.base_projection) {
                        for (const base of canonical.base_projection) {
                            this._addProjections(pname, 'what', cat, base, form);
                            this._addProjections(pname, 'which', cat, base, form);
                        }
                    }

                    // add non-what question when applicable
                    // `base` is no longer need for non-what question, thus leave as empty string
                    if (canonical.projection_pronoun) {
                        for (const pronoun of canonical.projection_pronoun)
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
                            for (const pronoun of pronouns[pronounType])
                                this._addProjections(pname, pronoun, cat, '', form);
                        }
                    }

                    if (this._options.flags.inference)
                        break;
                }

            } else {
                let annotarray : string[];
                if (!Array.isArray(annotvalue)) {
                    assert(typeof annotvalue === 'string');
                    annotarray = [annotvalue];
                } else {
                    annotarray = annotvalue;
                }

                for (const form of annotarray) {
                    if (cat === 'base') {
                        this._addOutParam(functionName, pname, ptype, typestr, form.trim());
                        if (!canonical.npp && !canonical.property) {
                            const expansion = [form, constant];
                            this._grammar.addRule('npp_filter', expansion, this._runtime.simpleCombine((_, value : Ast.Value) => makeFilter(this, pvar, op, value, false)));
                            const corefexpansion = [form, corefconst];
                            this._grammar.addRule('coref_npp_filter', corefexpansion, this._runtime.simpleCombine((_, value : Ast.Value) => makeFilter(this, pvar, op, value, false)), attributes);

                            if (canUseBothForm) {
                                const pairexpansion = [form, new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs')];
                                this._grammar.addRule('npp_filter', pairexpansion, this._runtime.simpleCombine((_1, _2, values : Ast.Value[]) => makeAndFilter(this, pvar, op, values, false)), attributes);
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
                        this._grammar.addRule(cat + '_filter', expansion, this._runtime.simpleCombine((_1, value : Ast.Value, _2) => makeFilter(this, pvar, op, value, false)), attributes);
                        this._grammar.addRule('coref_' + cat + '_filter', corefexpansion, this._runtime.simpleCombine((_1, value : Ast.Value, _2) => makeFilter(this, pvar, op, value, false)), attributes);
                        if (canUseBothForm)
                            this._grammar.addRule(cat + '_filter', pairexpansion, this._runtime.simpleCombine((_1, _2, values : Ast.Value[], _3) => makeAndFilter(this, pvar, op, values, false)), attributes);
                        if (ptype.isDate)
                            this._grammar.addRule(cat + '_filter', daterangeexpansion, this._runtime.simpleCombine((_1, values : Ast.Value[], _2) => makeDateRangeFilter(this, pvar, values)), attributes);
                    }

                    if (this._options.flags.inference)
                        break;
                }
            }
        }
    }

    private _addProjections(pname : string, pronoun : string, posCategory : string, base : string, canonical : string) {
        if (canonical.includes('|')) {
            const [verb, prep] = canonical.split('|').map((span) => span.trim());
            this.projections[pname][posCategory].push([`${prep} ${pronoun}`, base, verb]);

            // for when question, we can drop the prep entirely
            if (pronoun === 'when' || pronoun === 'what time')
                this.projections[pname][posCategory].push([pronoun, base, verb]);
        }
        this.projections[pname][posCategory].push([pronoun, base, canonical.replace(/\|/g, ' ')]);


    }

    // FIXME we mess with Ast.Program to add a .schema property and that does not quite go smooth with typescript
    private async _loadTemplate(ex : any) {
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
            for (const pname in ex.args) {
                const ptype = ex.args[pname];
                // FIXME use the annotation (or find the info in thingpedia)
                const pcanonical = clean(pname);
                args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.IN_REQ, pname, ptype, {
                    nl: { canonical: pcanonical },
                    impl: {}
                }));

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
            for (const pname in ex.args) {
                const ptype = ex.args[pname];

                //console.log('pname', pname);
                if (!(pname in ex.value.schema.inReq)) {
                    // somewhat of a hack, we declare the argument for the value,
                    // because later we will muck with schema only
                    ex.value.schema = ex.value.schema.addArguments([new Ast.ArgumentDef(
                        null,
                        Ast.ArgDirection.IN_REQ,
                        pname,
                        ptype,
                        {
                            nl: {
                                canonical: clean(pname)
                            },
                            impl: {}
                        }
                    )]);
                }
                const pcanonical = ex.value.schema.getArgCanonical(pname);

                this.params.in.set(pname + '+' + ptype, [pname, [typeToStringSafe(ptype), pcanonical]]);
                this._recordType(ptype);
            }
        }

        if (ex.type === 'query') {
            if (Object.keys(ex.args).length === 0 && ex.value.schema!.hasArgument('id')) {
                const type = ex.value.schema!.getArgument('id').type;
                if (isHumanEntity(type)) {
                    const grammarCat = 'thingpedia_who_question';
                    this._grammar.addRule(grammarCat, [''], this._runtime.simpleCombine(() => ex.value));
                }
            }
        }

        if (!ex.preprocessed || ex.preprocessed.length === 0) {
            // preprocess here...
            const tokenizer = this._langPack.getTokenizer();
            ex.preprocessed = ex.utterances.map((utterance : string) => tokenizeExample(tokenizer, utterance, ex.id));
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

    private _addPrimitiveTemplate<T>(grammarCat : string, preprocessed : string, value : T) : Array<string|Genie.SentenceGeneratorRuntime.Placeholder> {
        const chunks = preprocessed.trim().split(' ');
        const expansion : Array<string|Genie.SentenceGeneratorRuntime.Placeholder> = [];

        for (const chunk of chunks) {
            if (chunk === '')
                continue;
            if (chunk.startsWith('$') && chunk !== '$$') {
                const [, param1, param2, opt] = /^\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})$/.exec(chunk)!;
                const param = param1 || param2;
                assert(param);
                expansion.push(new this._runtime.Placeholder(param, opt));
            } else {
                expansion.push(chunk);
            }
        }

        this._grammar.addRule(grammarCat, expansion, this._runtime.simpleCombine<[], T>(() => value));
        return chunks;
    }

    private async _makeExampleFromQuery(q : Ast.FunctionDef) {
        const device = new Ast.Selector.Device(null, q.class!.name, null, null);
        const invocation = new Ast.Invocation(null, device, q.name, [], q);

        const canonical : string[] = q.canonical ?
            (Array.isArray(q.canonical) ? q.canonical : [q.canonical]) :
            [clean(q.name)];

        for (const form of canonical) {
            const pluralized = this._langPack.pluralize(form);
            if (pluralized !== undefined && pluralized !== form)
                canonical.push(pluralized);
        }

        const functionName = q.class!.name + ':' + q.name;
        const table = new Ast.Table.Invocation(null, invocation, q);

        let shortCanonical = q.metadata.canonical_short || canonical;
        if (!Array.isArray(shortCanonical))
            shortCanonical = [shortCanonical];
        for (const form of shortCanonical) {
            this._grammar.addRule('base_table', [form], this._runtime.simpleCombine(() => table));
            this._grammar.addRule('base_noun_phrase', [form], this._runtime.simpleCombine(() => functionName));
        }

        // FIXME English words should not be here
        for (const form of ['anything', 'one', 'something'])
            this._grammar.addRule('generic_anything_noun_phrase', [form], this._runtime.simpleCombine(() => table));
        for (const form of ['option', 'choice'])
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
        const id = q.getArgument('id')!;
        if (!(id.type instanceof Type.Entity))
            return;
        if (id.getImplementationAnnotation('filterable') === false)
            return;

        const idType = id.type;
        const entity = this._entities[idType.type];
        if (!entity || !entity.has_ner_support)
            return;

        const schemaClone = table.schema!.clone();
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

    private async _loadFunction(functionDef : Ast.FunctionDef) {
        if (this.globalWhiteList && !this.globalWhiteList.includes(functionDef.name))
            return;

        const functionName = functionDef.class!.kind + ':' + functionDef.name;
        for (const arg of functionDef.iterateArguments()) {
            if (arg.is_input)
                this._recordInputParam(functionName, arg);
            else
                this._recordOutputParam(functionName, arg);
        }

        if (functionDef.functionType === 'query') {
            if (functionDef.is_list && functionDef.hasArgument('id')) {
                const idarg = functionDef.getArgument('id')!;
                if (idarg.type instanceof Type.Entity && idarg.type.type === functionName) {
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

    private async _loadCustomErrorMessages(functionDef : Ast.FunctionDef) {
        for (const code in functionDef.metadata.on_error) {
            let messages = functionDef.metadata.on_error[code];
            if (!Array.isArray(messages))
                messages = [messages];

            for (const msg of messages) {
                const bag = new SlotBag(functionDef);

                const chunks = msg.trim().split(' ');
                for (const chunk of chunks) {
                    if (chunk === '')
                        continue;
                    if (chunk.startsWith('$') && chunk !== '$$') {
                        const [, param1, param2,] = /^\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})$/.exec(chunk)!;
                        const pname = param1 || param2;
                        assert(pname);
                        const ptype = functionDef.getArgType(pname)!;
                        const pcanonical = functionDef.getArgCanonical(pname)!;
                        this.params.in.set(pname + '+' + ptype, [pname, [typeToStringSafe(ptype), pcanonical]]);
                        this._recordType(ptype);
                    }
                }

                this._addPrimitiveTemplate('thingpedia_error_message', msg, { code, bag });
            }
        }
    }

    private async _loadCustomResultString(functionDef : Ast.FunctionDef) {
        let resultstring = functionDef.metadata.result;
        if (!Array.isArray(resultstring))
            resultstring = [resultstring];

        for (const form of resultstring)
            this._addPrimitiveTemplate('thingpedia_result', form, new SlotBag(functionDef));
    }

    private async _loadDevice(kind : string) {
        const classDef = await this._schemas.getFullMeta(kind);

        if (classDef.metadata.canonical) {
            this._grammar.addRule('constant_Entity__tt__device', [classDef.metadata.canonical],
                this._runtime.simpleCombine(() => new Ast.Value.Entity(kind, 'tt:device', null)));
        }

        for (const entity of classDef.entities) {
            let hasNer = entity.getImplementationAnnotation<boolean>('has_ner');
            if (hasNer === undefined)
                hasNer = true;
            this._loadEntityType(classDef.kind + ':' + entity.name, hasNer);
        }

        const whitelist = classDef.getImplementationAnnotation<string[]>('whitelist');
        let queries = Object.keys(classDef.queries);
        let actions = Object.keys(classDef.actions);
        if (whitelist && whitelist.length > 0) {
            queries = queries.filter((name) => whitelist.includes(name));
            actions = actions.filter((name) => whitelist.includes(name));
        }

        await Promise.all(queries.map((name) => classDef.queries[name]).map(this._loadFunction.bind(this)));
        await Promise.all(actions.map((name) => classDef.actions[name]).map(this._loadFunction.bind(this)));
    }

    private _loadEntityType(entityType : string, hasNerSupport : boolean) {
        this._entities[entityType] = { has_ner_support: hasNerSupport };
    }

    private _addEntityConstants() {
        for (const entityType in this._entities) {
            const ttType = new Type.Entity(entityType);
            const typestr = typeToStringSafe(ttType);
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

    // load dataset for one device
    private async _loadDataset(dataset : Ast.Dataset) {
        for (const ex of dataset.examples)
            await this._safeLoadTemplate(ex);
    }

    private async _safeLoadTemplate(ex : Ast.Example) {
        try {
            return await this._loadTemplate(ex);
        } catch(e) {
            throw new TypeError(`Failed to load example ${ex.id}: ${e.message}`);
        }
    }

    private async _getAllDeviceNames() {
        const devices = await this._tpClient.getAllDeviceNames();
        return devices.map((d) => d.kind);
    }

    private async _getDataset(kind : string) {
        return this._tpClient.getExamplesByKinds([kind]);
    }

    private async _loadMetadata() {
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
                const parsed = Grammar.parse(await this._getDataset(d));
                assert(parsed instanceof Ast.Library);
                return parsed.datasets[0];
            }));
            datasets = datasets.filter((d) => !!d);
        } else {
            const code = await this._tpClient.getAllExamples();
            const parsed = Grammar.parse(code);
            assert(parsed instanceof Ast.Library);
            datasets = parsed.datasets;
        }

        if (this._options.debug >= this._runtime.LogLevel.INFO) {
            const countTemplates = datasets.map((d) => d.examples.length).reduce((a, b) => a+b, 0);
            console.log('Loaded ' + devices.length + ' devices');
            console.log('Loaded ' + countTemplates + ' templates');
        }

        for (const entity of entityTypes)
            this._loadEntityType(entity.type, !!(entity.type.startsWith('tt:') && entity.has_ner_support));
        for (const device of devices)
            await this._loadDevice(device);
        this._addEntityConstants();
        for (const dataset of datasets)
            await this._loadDataset(dataset);
    }
}

export default new ThingpediaLoader();
