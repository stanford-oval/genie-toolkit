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
    Syntax,
    SchemaRetriever
} from 'thingtalk';
import * as Units from 'thingtalk-units';
import type * as Genie from 'genie-toolkit';
import type * as Tp from 'thingpedia';

import {
    ParamSlot,
    ErrorMessage,
    ExpressionWithCoreference,
    typeToStringSafe,
    makeInputParamSlot,
    makeFilter,
    makeAndFilter,
    makeDateRangeFilter,
    isHumanEntity,
    interrogativePronoun,
} from './utils';
import {
    replaceSlotBagPlaceholders,
    replaceErrorMessagePlaceholders,
    replacePlaceholdersWithConstants,
    replacePlaceholderWithTableOrStream,
    replacePlaceholderWithCoreference,
} from './primitive_templates';
import * as keyfns from './keyfns';
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

    base_projection ?: string|string[];
    projection_pronoun ?: string|string[];

    npv ?: boolean;
    implicit_identity ?: boolean;
}

// FIXME this info needs to be in Thingpedia
interface ExtendedEntityRecord {
    type : string;
    name : string;
    is_well_known : boolean|number;
    has_ner_support : boolean|number;
    subtype_of ?: string|null;
}

type PrimitiveTemplateType = 'action'|'action_past'|'query'|'get_command'|'stream'|'program';

export default class ThingpediaLoader {
    private _runtime : typeof Genie.SentenceGeneratorRuntime;
    private _ttUtils : typeof Genie.ThingTalkUtils;
    private _grammar : Genie.SentenceGenerator<any, Ast.Input>;
    private _schemas : SchemaRetriever;
    private _tpClient : Tp.BaseClient;
    private _langPack : Genie.I18n.LanguagePack;
    private _options : Genie.SentenceGeneratorTypes.GrammarOptions;
    private _describer : Genie.ThingTalkUtils.Describer;

    private _entities : Record<string, ExtendedEntityRecord>
    // cached annotations extracted from Thingpedia, for use at inference time
    private _errorMessages : Map<string, Record<string, string[]>>;
    private _resultStrings : Map<string, string[]>;

    types : Map<string, Type>;
    params : ParamSlot[];
    projections : Array<{
        pname : string;
        pslot : ParamSlot;
        category : string;
        pronoun : string;
        base : string;
        canonical : string;
    }>;
    idQueries : Map<string, Ast.FunctionDef>;
    compoundArrays : { [key : string] : InstanceType<typeof Type.Compound> };
    globalWhiteList : string[]|null;
    standardSchemas : {
        say : Ast.FunctionDef|null;
        get_gps : Ast.FunctionDef|null;
        get_time : Ast.FunctionDef|null;
    };
    entitySubTypeMap : Record<string, string>;
    private _subEntityMap : Map<string, string[]>;

    constructor(runtime : typeof Genie.SentenceGeneratorRuntime,
                ttUtils : typeof Genie.ThingTalkUtils,
                grammar : Genie.SentenceGenerator<any, Ast.Input>,
                langPack : Genie.I18n.LanguagePack,
                options : Genie.SentenceGeneratorTypes.GrammarOptions) {
        this._runtime = runtime;
        this._ttUtils = ttUtils;
        this._grammar = grammar;
        this._langPack = langPack;
        this._describer = new ttUtils.Describer(langPack.locale,
            options.timezone, options.entityAllocator, options.forSide);

        this._tpClient = options.thingpediaClient;
        if (!options.schemaRetriever) {
            options.schemaRetriever = new SchemaRetriever(this._tpClient, null,
                options.debug < this._runtime.LogLevel.DUMP_TEMPLATES);
        }
        this._schemas = options.schemaRetriever!;

        this._options = options;
        if (this._options.whiteList)
            this.globalWhiteList = this._options.whiteList.split(',');
        else
            this.globalWhiteList = null;

        this._entities = {};
        this._errorMessages = new Map;
        this._resultStrings = new Map;
        this.types = new Map;
        this.params = [];
        this.projections = [];
        this.idQueries = new Map;
        this.compoundArrays = {};
        this.entitySubTypeMap = {};
        this._subEntityMap = new Map;

        this.standardSchemas = { say: null, get_gps: null, get_time: null };
    }

    async init() {
        // make sure that these types are always available, regardless of which templates we have
        this._recordType(Type.String);
        this._recordType(Type.Date);
        this._recordType(Type.Currency);
        this._recordType(Type.Number);
        for (const unit of Units.BaseUnits)
            this._recordType(new Type.Measure(unit));

        const [say, get_gps, get_time] = await Promise.all([
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'action', 'say'),
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'query', 'get_gps'),
            this._tryGetStandard('org.thingpedia.builtin.thingengine.builtin', 'query', 'get_time')
        ]);
        this.standardSchemas = { say, get_gps, get_time };

        await this._loadMetadata();
    }

    get ttUtils() {
        return this._ttUtils;
    }

    get flags() {
        return this._options.flags;
    }

    get describer() {
        return this._describer;
    }

    isIDType(type : Type) {
        if (!(type instanceof Type.Entity))
            return false;
        return this.idQueries.has(type.type);
    }

    getResultStrings(functionName : string) : string[] {
        return this._resultStrings.get(functionName) || [];
    }
    getErrorMessages(functionName : string) : Record<string, string[]> {
        return this._errorMessages.get(functionName) || {};
    }

    private _addRule<ArgTypes extends unknown[], ResultType>(nonTerm : string,
                                                             parts : Array<string|Genie.SentenceGeneratorRuntime.NonTerminal>,
                                                             semanticAction : (...args : ArgTypes) => ResultType|null,
                                                             keyFunction : (value : ResultType) => Genie.SentenceGeneratorTypes.DerivationKey,
                                                             attributes : Genie.SentenceGeneratorTypes.RuleAttributes = {}) {
        this._grammar.addRule(nonTerm, parts, semanticAction, keyFunction, attributes);
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
        if (this.types.has(typestr)) {
            if (type.isArray)
                return 'Any';
            return typestr;
        }
        this.types.set(typestr, type);

        if (type.isRecurrentTimeSpecification)
            return typestr;
        if (type.isArray)
            return 'Any';

        this._addRule<Ast.Value[], Ast.Value>('constant_or_undefined', [this._getConstantNT(type)],
            identity, keyfns.valueKeyFn);

        if (!this._grammar.hasSymbol('constant_' + typestr)) {
            if (!type.isEnum && !type.isEntity)
                throw new Error('Missing definition for type ' + typestr);
            this._grammar.declareSymbol('constant_' + typestr);
            this._addRule<Ast.Value[], Ast.Value>('constant_Any', [this._getConstantNT(type)],
                identity, keyfns.valueKeyFn);

            if (type instanceof Type.Enum) {
                for (const entry of type.entries!) {
                    const value = new Ast.Value.Enum(entry);
                    value.getType = function() { return type; };
                    this._addRule('constant_' + typestr, [this._ttUtils.clean(entry)],
                        () => value, keyfns.valueKeyFn);
                }
            }
        }
        return typestr;
    }

    private _addOutParam(pslot : ParamSlot, canonical : string) {
        this._addRule('out_param_Any', [canonical], () => pslot, keyfns.paramKeyFn);

        if (pslot.type instanceof Type.Array) {
            this._addRule('out_param_Array__Any', [canonical], () => pslot, keyfns.paramKeyFn);
            const elem = pslot.type.elem as Type;
            if (elem instanceof Type.Compound)
                this._addRule('out_param_Array__Compound', [canonical], () => pslot, keyfns.paramKeyFn);
        }
    }

    private _getConstantNT(type : Type, { mustBeTrueConstant = false, strictTypeCheck = false } = {}) {
        const typestr = this._recordType(type)!;

        // mustBeTrueConstant indicates that we really need just a constant literal
        // as oppposed to some relative constant like "today" or "here"
        if (mustBeTrueConstant)
            return new this._runtime.NonTerminal('constant_' + typestr, ['is_constant', true]);
        else if (strictTypeCheck && typestr === 'Any')
            return new this._runtime.NonTerminal('constant_' + typestr, ['type', type]);
        else
            return new this._runtime.NonTerminal('constant_' + typestr);
    }

    private _recordInputParam(schema : Ast.FunctionDef, arg : Ast.ArgumentDef) {
        const pname = arg.name;
        const ptype = arg.type;
        const ptypestr = this._recordType(ptype);
        if (!ptypestr)
            return;
        const pslot : ParamSlot = { schema, name: pname, type: ptype,
            filterable: false, ast: new Ast.Value.VarRef(pname) };
        this.params.push(pslot);

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

                this._addRule('thingpedia_slot_fill_question', [form], () => pslot, keyfns.paramKeyFn);
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
            canonical = { base: [this._ttUtils.clean(pname)] };
        else if (typeof arg.metadata.canonical === 'string')
            canonical = { base: [arg.metadata.canonical] };
        else
            canonical = arg.metadata.canonical;

        const corefconst = new this._runtime.NonTerminal('coref_constant');
        const constant = this._getConstantNT(ptype);
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
                throw new TypeError(`Invalid annotation #_[canonical.implicit_identity=${annotvalue}] for ${schema.qualifiedName}`);
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
                    this._addRule('input_param', [form], () => pslot, keyfns.paramKeyFn, attributes);
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
                    this._addRule(cat + '_input_param', expansion, (_1, value : Ast.Value, _2) => makeInputParamSlot(pslot, value, this), keyfns.inputParamKeyFn, attributes);
                    this._addRule('coref_' + cat + '_input_param', corefexpansion, (_1, value : Ast.Value, _2) => makeInputParamSlot(pslot, value, this), keyfns.inputParamKeyFn, attributes);
                }

                if (this._options.flags.inference)
                    break;
            }
        }
    }

    private _recordBooleanOutputParam(pslot : ParamSlot, arg : Ast.ArgumentDef) {
        const pname = arg.name;
        const ptype = arg.type;
        if (!this._recordType(ptype))
            return;

        let canonical;

        if (!arg.metadata.canonical)
            canonical = { base: [this._ttUtils.clean(pname)] };
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
                    this._addOutParam(pslot, form.trim());

                continue;
            }

            const match = /^([a-zA-Z_]+)_(true|false)$/.exec(key);
            if (match === null) {
                console.error(`Invalid canonical key ${key} for boolean output parameter ${pslot.schema.qualifiedName}:${arg.name}`);
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
                this._addRule(cat + '_filter', [form], () => makeFilter(this, pslot, '==', value, false), keyfns.filterKeyFn, attributes);
                this._addRule(cat + '_boolean_projection', [form], () => pslot, keyfns.paramKeyFn);

                if (this._options.flags.inference)
                    break;
            }

        }
    }

    private _recordOutputParam(schema : Ast.FunctionDef, arg : Ast.ArgumentDef) {
        const pname = arg.name;
        const ptype = arg.type;
        if (!this._recordType(ptype))
            return;

        const filterable = arg.getImplementationAnnotation<boolean>('filterable') ?? true;
        const pslot : ParamSlot = { schema, name: pname, type: ptype,
            filterable, ast: new Ast.Value.VarRef(pname) };
        this.params.push(pslot);

        if (ptype.isCompound)
            return;

        if (arg.metadata.prompt) {
            let prompt = arg.metadata.prompt;
            if (typeof prompt === 'string')
                prompt = [prompt];

            for (const form of prompt)
                this._addRule('thingpedia_search_question', [form], () => pslot, keyfns.paramKeyFn);
        }
        if (arg.metadata.question) {
            let question = arg.metadata.question;
            if (typeof question === 'string')
                question = [question];

            for (const form of question)
                this._addRule('thingpedia_user_question', [form], () => [pslot], keyfns.paramArrayKeyFn);
        }

        if (ptype.isBoolean) {
            this._recordBooleanOutputParam(pslot, arg);
            return;
        }

        if (ptype instanceof Type.Array && ptype.elem instanceof Type.Compound) {
            this.compoundArrays[pname] = ptype.elem;
            for (const field in ptype.elem.fields) {
                const arg = ptype.elem.fields[field];
                this._recordOutputParam(schema, arg);
            }
        }

        if (arg.metadata.counted_object) {
            const forms = Array.isArray(arg.metadata.counted_object) ?
                arg.metadata.counted_object : [arg.metadata.counted_object];
            for (const form of forms)
                this._addRule('out_param_ArrayCount', [form], () => pslot, keyfns.paramKeyFn);
        }

        let canonical;

        if (!arg.metadata.canonical)
            canonical = { base: [this._ttUtils.clean(pname)] };
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
            this._recordOutputParamByType(pslot, op, type, canonical, canUseBothForm);
    }

    private _recordOutputParamByType(pslot : ParamSlot,
                                     op : string,
                                     vtype : Type,
                                     canonical : CanonicalForm,
                                     canUseBothForm : boolean) {
        const ptype = pslot.type;
        if (!this._recordType(ptype))
            return;
        const vtypestr = this._recordType(vtype);
        if (!vtypestr)
            return;

        const constant = this._getConstantNT(vtype);
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
                    throw new TypeError(`Invalid annotation #_[canonical.implicit_identity=${annotvalue}] for ${pslot.schema.qualifiedName}`);
                if (annotvalue) {
                    const expansion = [constant];
                    this._addRule(cat + '_filter', expansion, (value : Ast.Value) => makeFilter(this, pslot, op, value, false), keyfns.filterKeyFn, attributes);
                    this._addRule('coref_' + cat + '_filter', [corefconst], (value : Ast.Value) => makeFilter(this, pslot, op, value, false), keyfns.filterKeyFn, attributes);
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
                        this._addRule(cat + '_filter', [form], () => makeFilter(this, pslot, op, value, false), keyfns.filterKeyFn, attributes);
                }
            } else if (argMinMax) {
                let annotarray : string[];
                if (!Array.isArray(annotvalue)) {
                    assert(typeof annotvalue === 'string');
                    annotarray = [annotvalue];
                } else {
                    annotarray = annotvalue;
                }
                // appease the typechecker, which does not carry type refinements across callbacks
                const argMinMax2 : 'asc'|'desc' = argMinMax;

                for (const form of annotarray) {
                    this._addRule(cat + '_argminmax', [form], () : [ParamSlot, 'asc'|'desc'] => [pslot, argMinMax2], keyfns.argMinMaxKeyFn, attributes);
                    if (this._options.flags.inference)
                        break;
                }
            } else if (isProjection) {
                if (cat === 'base')
                    continue;

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
                        if (typeof canonical.base_projection === 'string')
                            canonical.base_projection = [canonical.base_projection];
                        for (const base of canonical.base_projection) {
                            this._addProjections(pslot, 'what', cat, base, form);
                            this._addProjections(pslot, 'which', cat, base, form);
                        }
                    }

                    // add non-what question when applicable
                    // `base` is no longer need for non-what question, thus leave as empty string
                    if (canonical.projection_pronoun) {
                        if (typeof canonical.projection_pronoun === 'string')
                            canonical.projection_pronoun = [canonical.projection_pronoun];
                        for (const pronoun of canonical.projection_pronoun)
                            this._addProjections(pslot, pronoun, cat, '', form);

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
                                this._addProjections(pslot, pronoun, cat, '', form);
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
                        this._addOutParam(pslot, form.trim());
                        if (!canonical.npp && !canonical.property && pslot.schema.is_list) {
                            const expansion = [form, constant];
                            this._addRule('npp_filter', expansion, (_, value : Ast.Value) => makeFilter(this, pslot, op, value, false), keyfns.filterKeyFn);
                            const corefexpansion = [form, corefconst];
                            this._addRule('coref_npp_filter', corefexpansion, (_, value : Ast.Value) => makeFilter(this, pslot, op, value, false), keyfns.filterKeyFn, attributes);

                            if (canUseBothForm) {
                                const pairexpansion = [form, new this._runtime.NonTerminal('both_prefix'), new this._runtime.NonTerminal('constant_pairs')];
                                this._addRule('npp_filter', pairexpansion, (_1, _2, values : [Ast.Value, Ast.Value]) => makeAndFilter(this, pslot, op, values, false), keyfns.filterKeyFn, attributes);
                            }
                        }
                    } else if (pslot.schema.is_list) {
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
                        this._addRule(cat + '_filter', expansion, (_1, value : Ast.Value, _2) => makeFilter(this, pslot, op, value, false), keyfns.filterKeyFn, attributes);
                        this._addRule('coref_' + cat + '_filter', corefexpansion, (_1, value : Ast.Value, _2) => makeFilter(this, pslot, op, value, false), keyfns.filterKeyFn, attributes);
                        if (canUseBothForm)
                            this._addRule(cat + '_filter', pairexpansion, (_1, _2, values : [Ast.Value, Ast.Value], _3) => makeAndFilter(this, pslot, op, values, false), keyfns.filterKeyFn, attributes);
                        if (ptype.isDate)
                            this._addRule(cat + '_filter', daterangeexpansion, (_1, values : [Ast.Value, Ast.Value], _2) => makeDateRangeFilter(this, pslot, values), keyfns.filterKeyFn, attributes);
                    }

                    if (this._options.flags.inference)
                        break;
                }
            }
        }
    }

    private _addProjections(pslot : ParamSlot, pronoun : string, posCategory : string, base : string, canonical : string) {
        if (canonical.includes('|')) {
            const [verb, prep] = canonical.split('|').map((span) => span.trim());
            this.projections.push({
                pname: pslot.name,
                pslot,
                category: posCategory,
                pronoun: `${prep} ${pronoun}`,
                base,
                canonical: verb
            });

            // for when question, we can drop the prep entirely
            if (pronoun === 'when' || pronoun === 'what time') {
                this.projections.push({
                    pname: pslot.name,
                    pslot,
                    category: posCategory,
                    pronoun: pronoun,
                    base,
                    canonical: verb
                });
            }
        }
        this.projections.push({
            pname: pslot.name,
            pslot,
            category: posCategory,
            pronoun,
            base,
            canonical: canonical.replace(/\|/g, ' ')
        });
    }

    private async _loadTemplate(ex : Ast.Example) {
        try {
            await ex.typecheck(this._schemas, true);
        } catch(e) {
            if (!e.message.startsWith('Invalid kind '))
                console.error(`Failed to load example ${ex.id}: ${e.message}`);
            return;
        }

        // ignore certain builtin actions:
        // debug_log is not interesting, say is special and we handle differently
        // faq_reply is not composable
        if (ex.value instanceof Ast.InvocationExpression && ex.value.invocation.selector.kind === 'org.thingpedia.builtin.thingengine.builtin') {
            if (this._options.flags.turking && ex.type === 'action')
                return;
            if (!this._options.flags.configure_actions && (ex.value.invocation.channel === 'configure' || ex.value.invocation.channel === 'discover'))
                return;
            if (ex.type === 'action' && ['say', 'debug_log', 'faq_reply'].includes(ex.value.invocation.channel))
                return;
        }
        if (ex.value instanceof Ast.FunctionCallExpression) // timers
            return;
        if (this._options.flags.nofilter && (ex.value instanceof Ast.FilterExpression ||
            (ex.value instanceof Ast.MonitorExpression && ex.value.expression instanceof Ast.FilterExpression)))
            return;

        for (const pname in ex.args) {
            const ptype = ex.args[pname];
            this._recordType(ptype);
        }

        if (ex.type === 'query') {
            if (Object.keys(ex.args).length === 0 && ex.value.schema!.hasArgument('id')) {
                const type = ex.value.schema!.getArgument('id')!.type;
                if (isHumanEntity(type))
                    this._addRule('thingpedia_who_question', [''], () => ex.value, keyfns.expressionKeyFn);
            }
        }

        if (!ex.preprocessed || ex.preprocessed.length === 0) {
            // preprocess here...
            const tokenizer = this._langPack.getTokenizer();
            ex.preprocessed = ex.utterances.map((utterance : string) => this._ttUtils.tokenizeExample(tokenizer, utterance, ex.id));
        }

        for (let preprocessed of ex.preprocessed) {
            let grammarCat : PrimitiveTemplateType = ex.type as 'stream'|'query'|'action'|'program';

            if (grammarCat === 'query' && preprocessed[0] === ',') {
                preprocessed = preprocessed.substring(1).trim();
                grammarCat = 'get_command';
            }

            if (this._options.debug >= this._runtime.LogLevel.INFO && preprocessed[0].startsWith(','))
                console.log(`WARNING: template ${ex.id} starts with , but is not a query`);

            if (this._options.forSide === 'agent')
                preprocessed = this._langPack.toAgentSideUtterance(preprocessed);

            this._addPrimitiveTemplate(grammarCat, preprocessed, ex);
            if (grammarCat === 'action') {
                const pastform = this._langPack.toVerbPast(preprocessed);
                if (pastform)
                    this._addPrimitiveTemplate('action_past', pastform, ex);
            }

            if (this._options.flags.inference)
                break;
        }
    }

    private _addPrimitiveTemplate(grammarCat : PrimitiveTemplateType,
                                  preprocessed : string,
                                  example : Ast.Example) {
        const chunks = preprocessed.trim().split(' ');

        // compute the basic expansion, and compute the names used in the primitive
        // template for each non-terminal
        const expansion : Array<string|Genie.SentenceGeneratorRuntime.NonTerminal> = [];
        const names : Array<string|null> = [];
        const options : string[] = [];

        for (const chunk of chunks) {
            if (chunk === '')
                continue;
            if (chunk.startsWith('$') && chunk !== '$$') {
                const [, param1, param2, opt] = /^\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})$/.exec(chunk)!;
                const param = param1 || param2;
                assert(param);

                const type = example.args[param];
                if (!type)
                    throw new Error(`Invalid placeholder \${param} in primitive template`);

                // don't use placeholders for booleans or enums, as that rarely makes sense
                const canUseUndefined = grammarCat !== 'action_past' && opt !== 'no-undefined' &&
                    opt !== 'const' && !type.isEnum && !type.isBoolean;

                const nonTerm = canUseUndefined ? new this._runtime.NonTerminal('constant_or_undefined', ['type', type])
                    : this._getConstantNT(type, { strictTypeCheck: true });

                expansion.push(nonTerm);
                names.push(param);
                options.push(opt || '');
            } else {
                expansion.push(chunk);
                names.push(null);
                options.push('');
            }
        }

        // template #1: just constants and/or undefined
        this._addConstantOrUndefinedPrimitiveTemplate(grammarCat, expansion, names, example);

        // template #2: replace placeholders with whole queries or streams
        // TODO: enable this for table joins with param passing
        if (grammarCat === 'action' || (this._options.flags.dialogues && grammarCat === 'action_past'))
            this._addPlaceholderReplacementJoinPrimitiveTemplate(grammarCat, expansion, names, options, example);

        // template #3: coreferences
        if (grammarCat !== 'action_past' && grammarCat !== 'program')
            this._addCoreferencePrimitiveTemplate(grammarCat, expansion, names, options, example);
    }

    /**
     * Convert a primitive template into a regular template that introduces a
     * coreference.
     */
    private _addCoreferencePrimitiveTemplate(grammarCat : 'stream'|'action'|'query'|'get_command',
                                             expansion : Array<string|Genie.SentenceGeneratorRuntime.NonTerminal>,
                                             names : Array<string|null>,
                                             options : string[],
                                             example : Ast.Example) {
        const exParams = Object.keys(example.args);

        // generate one rule for each possible parameter
        // in each rule, choose a different parameter to be replaced with a table
        // and the rest is constant or undefined
        for (const tableParam of exParams) {
            const paramIdx = names.indexOf(tableParam);
            assert(paramIdx >= 0);

            const option = options[paramIdx];
            if (option === 'const') // no coreference if parameter uses :const in the placeholder
                continue;

            for (const corefSource of ['same_sentence', 'context', 'list_context']) {
                if (corefSource === 'same_sentence' && grammarCat === 'stream')
                    continue;

                for (const fromNonTermName of [corefSource + '_coref', 'the_base_table', 'the_out_param_Any']) {
                    if (corefSource === 'list_context' && fromNonTermName !== corefSource + '_coref')
                        continue;

                    let fromNonTerm;
                    if (fromNonTermName === 'out_param_Any')
                        fromNonTerm = new this._runtime.NonTerminal(fromNonTermName, ['type', example.args[tableParam]]);
                    else if (fromNonTermName === 'the_base_table')
                        fromNonTerm = new this._runtime.NonTerminal(fromNonTermName, ['idType', example.args[tableParam]]);
                    else
                        fromNonTerm = new this._runtime.NonTerminal(fromNonTermName);

                    const clone = expansion.slice();
                    clone[paramIdx] = fromNonTerm;

                    this._addRule<Array<Ast.Value|Ast.Expression|ParamSlot|string>, ExpressionWithCoreference>(grammarCat + '_coref_' + corefSource, clone,
                        (...args) => replacePlaceholderWithCoreference(example, names, paramIdx, args),
                        keyfns.expressionWithCoreferenceKeyFn);
                }
            }
        }
    }

    /**
     * Convert a primitive template into a regular template that performs
     * a join with parameter passing by replacing exactly one placeholder
     * with a whole query or stream, and replacing the other placeholders with constants
     * or undefined.
     */
    private _addPlaceholderReplacementJoinPrimitiveTemplate(grammarCat : 'action'|'query'|'get_command'|'action_past',
                                                            expansion : Array<string|Genie.SentenceGeneratorRuntime.NonTerminal>,
                                                            names : Array<string|null>,
                                                            options : string[],
                                                            example : Ast.Example) {
        const exParams = Object.keys(example.args);

        const fromNonTermNames =
            grammarCat === 'action_past' ? ['ctx_current_query'] :
            ['with_filtered_table', 'with_arg_min_max_table', 'projection_Any', 'stream_projection_Any'];

        // generate one rule for each possible parameter
        // in each rule, choose a different parameter to be replaced with a table
        // and the rest is constant or undefined
        for (const tableParam of exParams) {
            const paramIdx = names.indexOf(tableParam);
            assert(paramIdx >= 0);

            const option = options[paramIdx];
            if (option === 'const') // no parameter passing if parameter uses :const in the placeholder
                continue;

            const intoType = example.args[tableParam];

            for (const fromNonTermName of fromNonTermNames) {
                if (grammarCat === 'query' && fromNonTermName === 'stream_projection_Any') // TODO
                    continue;

                // non-terminal constraints only support equality (because they are mapped
                // to hashtable) so we expand all possible sub entity to replace into
                // so we can still replace efficiently
                const fromTypes : Type[] = [intoType];
                if (fromNonTermName !== 'ctx_current_query') {
                    if (intoType instanceof Type.Entity) {
                        for (const subEntity of this._subEntityMap.get(intoType.type) || [])
                            fromTypes.push(new Type.Entity(subEntity));
                    }
                }

                for (const fromType of fromTypes) {
                    let fromNonTerm;
                    if (fromNonTermName === 'ctx_current_query')
                        fromNonTerm = new this._runtime.NonTerminal(fromNonTermName);
                    else if (fromNonTermName === 'projection_Any' || fromNonTermName === 'stream_projection_Any')
                        fromNonTerm = new this._runtime.NonTerminal(fromNonTermName, ['projectionType', fromType]);
                    else
                        fromNonTerm = new this._runtime.NonTerminal(fromNonTermName, ['implicitParamPassingType', fromType]);

                    const clone = expansion.slice();
                    clone[paramIdx] = fromNonTerm;

                    let intoNonTerm;
                    if (grammarCat === 'action_past')
                        intoNonTerm = 'thingpedia_complete_join_action_past';
                    else if (grammarCat === 'query')
                        intoNonTerm = 'table_join_replace_placeholder';
                    else if (fromNonTermName === 'stream_projection_Any')
                        intoNonTerm = 'action_replace_param_with_stream';
                    else
                        intoNonTerm = 'action_replace_param_with_table';

                    this._addRule<Array<Ast.Value|Ast.Expression>, Ast.ChainExpression>(intoNonTerm, clone,
                        (...args) => replacePlaceholderWithTableOrStream(example, names, paramIdx, args, this),
                        keyfns.expressionKeyFn);
                }
            }
        }
    }

    /**
     * Convert a primitive template into a regular template that uses
     * only constants and undefined.
     */
    private _addConstantOrUndefinedPrimitiveTemplate(grammarCat : PrimitiveTemplateType,
                                                     expansion : Array<string|Genie.SentenceGeneratorRuntime.NonTerminal>,
                                                     names : Array<string|null>,
                                                     example : Ast.Example) {
        this._addRule<Ast.Value[], Ast.Expression>('thingpedia_complete_' + grammarCat, expansion,
            (...args) => replacePlaceholdersWithConstants(example, names, args),
            keyfns.expressionKeyFn);
    }

    private async _makeExampleFromQuery(q : Ast.FunctionDef) {
        const device = new Ast.DeviceSelector(null, q.class!.name, null, null);
        const invocation = new Ast.Invocation(null, device, q.name, [], q);

        const canonical : string[] = q.canonical ?
            (Array.isArray(q.canonical) ? q.canonical : [q.canonical]) :
            [this._ttUtils.clean(q.name)];

        for (const form of canonical) {
            const pluralized = this._langPack.pluralize(form);
            if (pluralized !== undefined && pluralized !== form)
                canonical.push(pluralized);
        }

        const table = new Ast.InvocationExpression(null, invocation, q);

        let shortCanonical = q.metadata.canonical_short || canonical;
        if (!Array.isArray(shortCanonical))
            shortCanonical = [shortCanonical];
        for (const form of shortCanonical) {
            this._addRule('base_table', [form], () => table, keyfns.expressionKeyFn);
            this._addRule('base_noun_phrase', [form], () => q, keyfns.functionDefKeyFn);
        }

        // FIXME English words should not be here
        for (const form of ['anything', 'one', 'something'])
            this._addRule('generic_anything_noun_phrase', [form], () => table, keyfns.expressionKeyFn);
        for (const form of ['option', 'choice'])
            this._addRule('generic_base_noun_phrase', [form], () => table, keyfns.expressionKeyFn);

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
        this._grammar.addConstants('constant_name', 'GENERIC_ENTITY_' + idType.type, idType,
            keyfns.entityOrNumberValueKeyFn);

        let hasParentEntity = false;
        if (entity.subtype_of) {
            const parentFnDef = this.idQueries.get(entity.subtype_of);
            if (parentFnDef)
                hasParentEntity = true;
        }

        let span;
        if (idType.type === q.class!.name + ':' + q.name && !hasParentEntity) {
            // we make an example with just the name if and only if
            // - this is the main query of this entity
            // - this entity has no parent entity
            span = [`\${p_name:no-undefined}`, ...canonical.map((c) => `${c} \${p_name:no-undefined}`)];
        } else {
            // make examples by name using the canonical form of the table
            // to make the dataset unambiguous
            span = canonical.map((c) => `${c} \${p_name:no-undefined}`);
        }

        const idfilter = new Ast.BooleanExpression.Atom(null, 'id', '==', new Ast.Value.VarRef('p_name'));
        await this._loadTemplate(new Ast.Example(
            null,
            -1,
            'query',
            { p_name: id.type },
            new Ast.FilterExpression(null, table, idfilter, schemaClone),
            span,
            span,
            {}
        ));
        const namefilter = new Ast.BooleanExpression.Atom(null, 'id', '=~', new Ast.Value.VarRef('p_name'));
        await this._loadTemplate(new Ast.Example(
            null,
            -1,
            'query',
            { p_name: Type.String },
            new Ast.FilterExpression(null, table, namefilter, table.schema),
            span,
            span,
            {}
        ));

        // we only apply reverse_property/implicit_identity to the function's
        // _own_ arguments
        //
        // that way, we don't have confusion with the superfunction
        // FIXME this probably doesn't work with whitelist
        for (const argname of q.args) {
            const arg = q.getArgument(argname)!;

            if (typeof arg.metadata.canonical === 'string' ||
                typeof arg.metadata.canonical === 'undefined' ||
                Array.isArray(arg.metadata.canonical))
                continue;

            let op = '==';
            let vtype : Type[] = [arg.type];
            if (arg.direction === Ast.ArgDirection.OUT) {
                const slotOperator = arg.getImplementationAnnotation<string>('slot_operator');
                if (slotOperator) {
                    op = slotOperator;
                } else {
                    if (arg.type instanceof Type.Array) {
                        vtype = [arg.type.elem as Type];
                        if (arg.type.elem === Type.String)
                            op = 'contains~';
                        else
                            op = 'contains';
                    } else if (arg.type.isRecurrentTimeSpecification) {
                        vtype = [Type.Date, Type.Time];
                        op = 'contains';
                    } else if (arg.type === Type.String) {
                        op = '=~';
                    }
                }
            }
            for (const type of vtype) {
                const args : Record<string, Type> = {};
                args[`p_${arg.name}`] = type;
                let ast;
                if (arg.direction === Ast.ArgDirection.OUT) {
                    const filter = new Ast.BooleanExpression.Atom(null, arg.name, op, new Ast.Value.VarRef(`p_${arg.name}`));
                    ast = new Ast.FilterExpression(null, table, filter, table.schema);
                } else {
                    const inparams = [new Ast.InputParam(null, arg.name, new Ast.Value.VarRef(`p_${arg.name}`))];
                    ast = table.clone();
                    ast.invocation.in_params = inparams;
                }
                for (let canonical of arg.metadata.canonical.reverse_property || arg.metadata.canonical.npi || []) {
                    if (!canonical.includes('#'))
                        canonical += ' #';
                    await this._loadTemplate(new Ast.Example(
                        null,
                        -1,
                        'query',
                        args,
                        ast,
                        [canonical.replace('#', `\${p_${arg.name}:no-undefined}`)],
                        [canonical.replace('#', `\${p_${arg.name}:no-undefined}`)],
                        {}
                    ));
                }
                if ('implicit_identity' in arg.metadata.canonical || ANNOTATION_RENAME.implicit_identity in arg.metadata.canonical) {
                    await this._loadTemplate(new Ast.Example(
                        null,
                        -1,
                        'query',
                        args,
                        ast,
                        [`\${p_${arg.name}:no-undefined}`],
                        [`\${p_${arg.name}:no-undefined}`],
                        {}
                    ));
                }
            }
        }
    }

    private async _recordFunction(functionDef : Ast.FunctionDef) {
        if (this.globalWhiteList && !this.globalWhiteList.includes(functionDef.name))
            return;

        for (const arg of functionDef.iterateArguments()) {
            if (arg.is_input)
                this._recordInputParam(functionDef, arg);
            else
                this._recordOutputParam(functionDef, arg);
        }

        if (functionDef.functionType === 'query') {
            if (functionDef.is_list && functionDef.hasArgument('id')) {
                const idarg = functionDef.getArgument('id')!;
                const functionEntityType = functionDef.class!.kind + ':' + functionDef.name;
                if (idarg.type instanceof Type.Entity && idarg.type.type === functionEntityType)
                    this.idQueries.set(functionEntityType, functionDef);
            }
        }
    }

    private async _loadFunction(functionDef : Ast.FunctionDef) {
        if (functionDef.functionType === 'query')
            await this._makeExampleFromQuery(functionDef);

        if (functionDef.metadata.result)
            await this._loadCustomResultString(functionDef);
        if (functionDef.metadata.on_error)
            await this._loadCustomErrorMessages(functionDef);
    }

    private async _loadCustomErrorMessages(functionDef : Ast.FunctionDef) {
        const bag = new SlotBag(functionDef);

        const normalized : Record<string, string[]> = {};
        this._errorMessages.set(functionDef.qualifiedName, normalized);
        for (const code in functionDef.metadata.on_error) {
            let messages = functionDef.metadata.on_error[code];
            if (!Array.isArray(messages))
                messages = [messages];
            normalized[code] = messages;

            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                const chunks = msg.trim().split(' ');
                const expansion : Array<string|Genie.SentenceGeneratorRuntime.NonTerminal> = [];
                const names : Array<string|null> = [];

                for (const chunk of chunks) {
                    if (chunk === '')
                        continue;
                    if (chunk.startsWith('$') && chunk !== '$$') {
                        const [, param1, param2,] = /^\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})$/.exec(chunk)!;
                        const param = param1 || param2;
                        assert(param);
                        // TODO use opt

                        const arg = functionDef.getArgument(param);
                        if (!arg)
                            throw new Error(`Invalid placeholder \${param} in #_[on_error] annotation for @${functionDef.qualifiedName}`);

                        assert(this._recordType(arg.type));
                        expansion.push(this._getConstantNT(arg.type, { mustBeTrueConstant: true }));
                        names.push(param);
                    } else {
                        expansion.push(chunk);
                        names.push(null);
                    }
                }

                // give a small priority boost to each phrase, depending on the order
                // in which they are given
                const attributes = { priority: (messages.length-i) * 0.1 };
                this._addRule<Ast.Value[], ErrorMessage>('thingpedia_error_message', expansion, (...args) => replaceErrorMessagePlaceholders({ code, bag }, names, args), keyfns.errorMessageKeyFn, attributes);
            }
        }
    }

    private async _loadCustomResultString(functionDef : Ast.FunctionDef) {
        const bag = new SlotBag(functionDef);

        let resultstring = functionDef.metadata.result;
        if (!Array.isArray(resultstring))
            resultstring = [resultstring];

        this._resultStrings.set(functionDef.qualifiedName, resultstring);
        for (let i = 0; i < resultstring.length; i++) {
            const form = resultstring[i];

            const chunks = form.trim().split(' ');
            const expansion : Array<string|Genie.SentenceGeneratorRuntime.NonTerminal> = [];
            const names : Array<string|null> = [];

            for (const chunk of chunks) {
                if (chunk === '')
                    continue;
                if (chunk.startsWith('$') && chunk !== '$$') {
                    const [, param1, param2,] = /^\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_-]+))?})$/.exec(chunk)!;
                    const param = param1 || param2;
                    assert(param);
                    // TODO use opt

                    const arg = functionDef.getArgument(param);
                    if (!arg)
                        throw new Error(`Invalid placeholder \${param} in #_[result] annotation for @${functionDef.qualifiedName}`);

                    assert(this._recordType(arg.type));
                    expansion.push(this._getConstantNT(arg.type, { mustBeTrueConstant: true }));
                    names.push(param);
                } else {
                    expansion.push(chunk);
                    names.push(null);
                }
            }

            // give a small priority boost to each phrase, depending on the order
            // in which they are given
            const attributes = { priority: (resultstring.length-i) * 0.1 };
            this._addRule<Ast.Value[], SlotBag>('thingpedia_result', expansion, (...args) => replaceSlotBagPlaceholders(bag, names, args),
                keyfns.slotBagKeyFn, attributes);
        }
    }

    private async _loadDevice(kind : string) {
        const classDef = await this._schemas.getFullMeta(kind);

        if (classDef.metadata.canonical) {
            this._addRule('constant_Entity__tt__device', [classDef.metadata.canonical],
                () => new Ast.Value.Entity(kind, 'tt:device', null), keyfns.valueKeyFn);
        }

        for (const entity of classDef.entities) {
            let hasNer = entity.getImplementationAnnotation<boolean>('has_ner');
            if (hasNer === undefined)
                hasNer = true;
            let subTypeOf = null;
            if (entity.extends) {
                subTypeOf = entity.extends.includes(':') ? entity.extends
                    : classDef.kind + ':' + entity.extends;
            }
            const entityRecord : ExtendedEntityRecord = {
                type: classDef.kind + ':' + entity.name,
                name: entity.getImplementationAnnotation<string>('description')||'',
                has_ner_support: hasNer,
                is_well_known: false,
                subtype_of: subTypeOf
            };
            this._loadEntityType(entityRecord.type, entityRecord);
        }

        const whitelist = classDef.getImplementationAnnotation<string[]>('whitelist');
        let queries = Object.keys(classDef.queries);
        let actions = Object.keys(classDef.actions);
        if (whitelist && whitelist.length > 0) {
            queries = queries.filter((name) => whitelist.includes(name));
            actions = actions.filter((name) => whitelist.includes(name));
        }

        // do one pass over all functions to learn about idQueries first
        await Promise.all(queries.map((name) => classDef.queries[name]).map(this._recordFunction.bind(this)));
        await Promise.all(actions.map((name) => classDef.actions[name]).map(this._recordFunction.bind(this)));

        // do another pass to add primitive templates for each canonical form
        await Promise.all(queries.map((name) => classDef.queries[name]).map(this._loadFunction.bind(this)));
        await Promise.all(actions.map((name) => classDef.actions[name]).map(this._loadFunction.bind(this)));
    }

    private _loadEntityType(entityType : string, typeRecord : ExtendedEntityRecord) {
        this._entities[entityType] = typeRecord;
        if (typeRecord.subtype_of) {
            this.entitySubTypeMap[entityType] = typeRecord.subtype_of;

            // TODO this only supports a flat hierarchy
            // if we have a deeper hierarchy this code will not code
            const subEntities = this._subEntityMap.get(typeRecord.subtype_of);
            if (subEntities)
                subEntities.push(typeRecord.type);
            else
                this._subEntityMap.set(typeRecord.subtype_of, [typeRecord.type]);
        }
    }

    private _addEntityConstants() {
        for (const entityType in this._entities) {
            const ttType = new Type.Entity(entityType);
            const { has_ner_support } = this._entities[entityType];
            const typestr = this._recordType(ttType);

            if (has_ner_support) {
                if (this.idQueries.has(entityType)) {
                    if (this._options.debug >= this._runtime.LogLevel.DUMP_TEMPLATES)
                        console.log('Loaded entity ' + entityType + ' as id entity');
                } else {
                    if (this._options.debug >= this._runtime.LogLevel.DUMP_TEMPLATES)
                        console.log('Loaded entity ' + entityType + ' as generic entity');
                }

                this._grammar.addConstants('constant_' + typestr, 'GENERIC_ENTITY_' + entityType, ttType,
                    keyfns.entityOrNumberValueKeyFn);
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

    private async _loadMetadata() {
        const entityTypes : ExtendedEntityRecord[] = await this._tpClient.getAllEntityTypes();

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
                const dataset = await this._schemas.getExamplesByKind(d);
                this._describer.setDataset(d, dataset);
                return dataset;
            }));
        } else {
            const code = await this._tpClient.getAllExamples();
            let parsed;
            try {
                parsed = Syntax.parse(code);
            } catch(e) {
                if (e.name !== 'SyntaxError')
                    throw e;
                // try parsing using legacy syntax too in case we're talking
                // to an old Thingpedia that has not been migrated
                parsed = Syntax.parse(code, Syntax.SyntaxType.Legacy);
            }
            assert(parsed instanceof Ast.Library);
            datasets = parsed.datasets;
            this._describer.setFullDataset(datasets);
        }

        if (this._options.debug >= this._runtime.LogLevel.INFO) {
            const countTemplates = datasets.map((d) => d.examples.length).reduce((a, b) => a+b, 0);
            console.log('Loaded ' + devices.length + ' devices');
            console.log('Loaded ' + countTemplates + ' templates');
        }

        for (const entity of entityTypes) {
            entity.has_ner_support = !!(entity.type.startsWith('tt:') && entity.has_ner_support);
            this._loadEntityType(entity.type, entity);
        }
        for (const device of devices)
            await this._loadDevice(device);
        this._addEntityConstants();
        for (const dataset of datasets)
            await this._loadDataset(dataset);
    }
}
