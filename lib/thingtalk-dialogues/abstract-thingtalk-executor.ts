// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import assert from 'assert';
import * as Tp from 'thingpedia';
import { Ast, SchemaRetriever, Builtin, Type } from 'thingtalk';

import * as I18n from '../i18n';
import { cleanKind } from '../utils/misc-utils';
import { addIndexToIDQuery } from '../utils/thingtalk';
import { contactSearch, Contact } from './entity-linking/contact_search';
import { collectDisambiguationHints, getBestEntityMatch, EntityRecord } from './entity-linking/entity-finder';

import { CancellationError } from '../dialogue-runtime/errors';
import ValueCategory from '../dialogue-runtime/value-category';
import type { DialogueInterface } from './interface';

interface AbstractThingTalkExecutorOptions {
    locale : string;
    timezone : string;
    debug : boolean;
}

export interface NotificationConfig {
    backend : string;
    config : Record<string, string>;
}

export type RawExecutionResult = Array<[string, Record<string, unknown>]>;

export interface DisambiguationHints {
    devices : Map<string, [string|null, Ast.InputParam|undefined]>;
    idEntities : Map<string, EntityRecord[]>;
    previousLocations : Ast.AbsoluteLocation[];
}

export interface DeviceInfo {
    kind : string;
    uniqueId : string;
    name : string;
}

/**
 * The result of executing a ThingTalk statement.
 */
export interface ExecutionResult {
    /**
     * The statement for which this result was obtained
     */
    stmt : Ast.ExpressionStatement;

    /**
     * The results of executing the ThingTalk program, if any.
     *
     * This is a container with the list of actual results, a boolean indicating that more
     * results could be fetched from the API, and whether any error occurred.
     *
     * This will be null if the statement was not executed. The statement might not be executed
     * if some required parameter is missing, or if some value needs entity linking or user
     * context resolution (`$location.current_location`, `$self.phone_number`, etc.)
     */
    results : Ast.DialogueHistoryResultList|null;

    /**
     * The raw results of executing the ThingTalk program.
     *
     * This is equivalent to {@link results} but contains runtime representations of
     * the ThingTalk values (as produced/seen by Thingpedia skills) instead of AST values.
     */
    rawResults : RawExecutionResult;
}

class AddDefaultParamVisitor extends Ast.NodeVisitor {
    visitInvocation(invocation : Ast.Invocation) {
        const set = new Set;
        for (const inParam of invocation.in_params)
            set.add(inParam.name);

        for (const arg of invocation.schema!.iterateArguments()) {
            if (arg.is_input && !arg.required && arg.impl_annotations.default && !set.has(arg.name))
                invocation.in_params.push(new Ast.InputParam(null, arg.name, arg.impl_annotations.default));
        }
        return false;
    }
}

export type UserContextVariable =
    `$self.${'phone_number' | 'email_address'}`
    | `$location.${'current_location' | 'home' | 'work'}`
    | `$time.${'morning'|'evening'}`

/**
 * Base class of a ThingTalk executor.
 *
 * The class contains the code that is common between real execution of ThingTalk
 * (at inference time) and simulation (at training time and during annotation).
 *
 * This class is completely stateless.
 *
 * The public API of this class is used by the entity linking & device choice code
 * (during the "prepare for execution" step) to abstract the access to the "user".
 *
 * There are two subclasses, one used during simulation, and one used for execution.
 */
export default abstract class AbstractThingTalkExecutor {
    protected _tpClient : Tp.BaseClient;
    protected _schemas : SchemaRetriever;
    protected _debug : boolean;
    private _langPack : I18n.LanguagePack;
    locale : string;
    timezone : string;

    constructor(tpClient : Tp.BaseClient, schemas : SchemaRetriever, options : AbstractThingTalkExecutorOptions) {
        this._tpClient = tpClient;
        this._schemas = schemas;
        this._langPack = I18n.get(options.locale);

        this._debug = options.debug;
        this.locale = options.locale;
        this.timezone = options.timezone;
    }

    /**
     * Execute the given ThingTalk program.
     *
     * @param program - the program to execute
     * @param privateState - additional state carried by the dialogue agent (per dialogue)
     * @return the result of the execution
     */
    abstract execute(dlg : DialogueInterface, program : Ast.Program, notificationConfig : NotificationConfig|undefined) : Promise<ExecutionResult[]>;

    /**
     * Extract hints from the current dialogue state that can be used to
     * disambiguate entities in a program.
     *
     * @param state the current dialogue state
     * @returns
     */
    collectDisambiguationHintsForState(state : Ast.DialogueState|null) {
        const idEntities = new Map<string, EntityRecord[]>();
        const devices = new Map<string, [string|null, Ast.InputParam|undefined]>();
        const previousLocations : Ast.AbsoluteLocation[] = [];

        if (state === null)
            return { devices, idEntities, previousLocations };

        // collect all ID entities and all locations from the state
        for (const item of state.history) {
            const results = item.results;
            if (results === null)
                continue;

            for (const slot of item.stmt.iterateSlots2()) {
                if (slot instanceof Ast.DeviceSelector)
                    devices.set(slot.kind, [slot.id, slot.getAttribute('name')]);
            }

            for (const result of results.results)
                collectDisambiguationHints(result, idEntities, previousLocations);
        }

        return { devices, idEntities, previousLocations };
    }

    /**
     * Ensure that notifications are configured for the user, and gather
     * all the information we need.
     */
    abstract configureNotifications(dlg : DialogueInterface) : Promise<NotificationConfig|undefined>;

    /**
     * Check that a given statement is permitted for the current user.
     *
     * This is the hook to prevent running unsafe statements in anonymous mode.
     */
    protected abstract checkForPermission(dlg : DialogueInterface, stmt : Ast.ExpressionStatement) : Promise<void>;

    /**
     * Prepare a statement for being executed.
     *
     * This will resolve all ThingTalk values that are relative to the user, such as `$location.current_location`,
     * and will assign device IDs to all Thingpedia function calls.
     *
     * Statements in the state are modified in place.
     *
     * @param dlg - the dialogue interface to use to communicate with the user if necessary
     * @param stmt - the statement to prepare
     * @param hints - hints to use to resolve any ambiguity
     */
    async prepareStatementForExecution(dlg : DialogueInterface, stmt : Ast.ExpressionStatement, hints : DisambiguationHints) {
        // somewhat of a HACK:
        // add a [1] clause to immediate-mode statements that refer to "id" in
        // the query and don't have an index clause already
        addIndexToIDQuery(stmt);

        await this.checkForPermission(dlg, stmt);

        // FIXME this method can cause a few questions that
        // bypass the neural network, which is not great
        //
        // In particular, the following questions need to be fixed:
        // - "Who do you want to contact?" (from contact_search)
        // - "Where are you now?" / "What is your home address?" ... (from user_context)
        //
        // OTOH, questions that use "askChoices" or raw mode are fine,
        // because those are intentionally skipping the neural network
        //
        // (OTOOH, a proper IoT skill would probably use a more conversational
        // model for device choice, so the user can say "use the light in this room"
        // or "use the light closest to me", or similar)

        stmt.visit(new AddDefaultParamVisitor());
        for (const slot of stmt.iterateSlots2()) {
            if (slot instanceof Ast.DeviceSelector)
                await this._chooseDevice(dlg, slot, hints);
            else
                await this._concretizeValue(dlg, slot, hints);
        }
    }

    /**
     * Show a debug message.
     *
     * @param {any} msg - what to show
     */
    debug(...args : unknown[]) : void {
        if (!this._debug)
            return;
        console.log(...args);
    }

    private async _chooseDevice(dlg : DialogueInterface, selector : Ast.DeviceSelector, hints : DisambiguationHints) : Promise<void> {
        if (selector.id !== null)
            return;

        const kind = selector.kind;
        const name = selector.getAttribute('name');
        if (!name && hints.devices.has(kind) && !selector.all) {
            // if we have already selected a device for this kind in the context, reuse what
            // we chose before without asking again
            const [previousId, previousName] = hints.devices.get(kind)!;
            selector.id = previousId;
            if (previousName)
                selector.attributes.push(previousName.clone());
            return;
        }

        const alldevices = await this.getAllDevicesOfKind(kind);

        if (alldevices.length === 0) {
            this.debug('No device of kind ' + kind + ' available, attempting configure...');
            const device = await this.tryConfigureDevice(dlg, kind);
            if (!device) // cancel the dialogue if we failed to set up a device
                throw new CancellationError();
            if (selector.all)
                return;
            selector.id = device.uniqueId;
            if (name)
                name.value = new Ast.Value.String(device.name);
            else
                selector.attributes.push(new Ast.InputParam(null, 'name', new Ast.Value.String(device.name)));
            return;
        }

        if (selector.all)
            return;

        let selecteddevices = alldevices;
        // note: we ignore the name if there is only one device configured - this protects against some bad parses
        if (alldevices.length > 1 && name !== undefined)
            selecteddevices = alldevices.filter((d) => Builtin.like(d.name, name.value.toJS() as string));

        if (selecteddevices.length === 1) {
            selector.id = selecteddevices[0].uniqueId;
            if (name)
                name.value = new Ast.Value.String(selecteddevices[0].name);
            else
                selector.attributes.push(new Ast.InputParam(null, 'name', new Ast.Value.String(selecteddevices[0].name)));
            return;
        }

        const choosefrom = (selecteddevices.length ? selecteddevices : alldevices);
        const choice = await this.disambiguate(dlg, selecteddevices.length ? 'device' : 'device-missing',
            name ? name.value.toJS() as string : null, choosefrom.map((d) => d.name), kind);
        selector.id = choosefrom[choice].uniqueId;
        if (name)
            name.value = new Ast.Value.String(choosefrom[choice].name);
        else
            selector.attributes.push(new Ast.InputParam(null, 'name', new Ast.Value.String(choosefrom[choice].name)));
    }

    private async _addDisplayToDevice(value : Ast.EntityValue) : Promise<void> {
        try {
            const classDef = await this._schemas.getFullMeta(value.value!);

            value.display = classDef.metadata.thingpedia_name || classDef.metadata.canonical || cleanKind(value.value!);
        } catch(e) {
            /* ignore if the device does not exist, it might be a constant of the form
               "str:ENTITY_tt:device::" */
        }
    }

    private async _maybeAddDisplayToValue(dlg : DialogueInterface, value : Ast.EntityValue) : Promise<void> {
        switch (value.type) {
        case 'tt:contact':
            await this.addDisplayToContact(dlg, value);
            break;

        case 'tt:device':
            await this._addDisplayToDevice(value);
            break;
        }
    }

    private async _concretizeValue(dlg : DialogueInterface, slot : Ast.AbstractSlot, hints : DisambiguationHints) : Promise<void> {
        let value = slot.get();

        // default units (e.g. defaultTemperature) will be concretized
        // according to the user's preferences or locale
        // since dlg.locale is overwritten to be en-US, we infer the locale
        // via other environment variables like LANG (language) or TZ (timezone)
        if (value instanceof Ast.MeasureValue && value.unit.startsWith('default')) {
            const key = value.unit.substring('default'.length).toLowerCase();
            const preference = this.getPreferredUnit(key);
            if (preference) {
                value.unit = preference;
            } else {
                switch (key) {
                case 'temperature':
                    value.unit = this._langPack.getDefaultTemperatureUnit();
                    break;
                default:
                    throw new TypeError('Unexpected default unit ' + value.unit);
                }
            }
        } else if (value instanceof Ast.LocationValue && value.value instanceof Ast.UnresolvedLocation) {
            slot.set(await this.lookupLocation(dlg, value.value.name, hints.previousLocations || []));
        } else if (value instanceof Ast.LocationValue && value.value instanceof Ast.RelativeLocation) {
            assert(value.value.relativeTag === 'current_location' || value.value.relativeTag === 'home' || value.value.relativeTag === 'work');
            slot.set(await this.resolveUserContext(dlg, `$location.${value.value.relativeTag}` as UserContextVariable));
        } else if (value instanceof Ast.TimeValue && value.value instanceof Ast.RelativeTime) {
            assert(value.value.relativeTag === 'morning' || value.value.relativeTag === 'evening');
            slot.set(await this.resolveUserContext(dlg, `$time.${value.value.relativeTag}` as UserContextVariable));
        } else if (value instanceof Ast.EntityValue && value.value === null) {
            if (value.type === 'tt:email_address' || value.type === 'tt:phone_number' ||
                value.type === 'tt:contact') {
                slot.set(await contactSearch(dlg, this, value.type, value.display!));
            } else if (value.type === 'tt:device') {
                const candidates = await this._tpClient.searchDevice(value.display!);
                const tokenizer = this._langPack.getTokenizer();
                const resolved = getBestEntityMatch(value.display!, value.type, candidates.map((d) => ({
                    value: d.primary_kind,
                    name: d.name,
                    canonical: tokenizer.tokenize(d.name).rawTokens.join(' ')
                })));
                value.value = resolved.value;
                value.display = resolved.name;
            } else {
                const candidates = (hints.idEntities ? hints.idEntities.get(value.type) : undefined)
                    || await this.lookupEntityCandidates(dlg, value.type, value.display!, hints);
                const resolved = getBestEntityMatch(value.display!, value.type, candidates);
                value.value = resolved.value;
                value.display = resolved.name;
            }
        }

        value = slot.get();
        assert(value.isConcrete());
        if (value instanceof Ast.EntityValue && !value.display)
            await this._maybeAddDisplayToValue(dlg, value);
    }

    // The rest is the API that subclasses must implement

    /**
     * List all configured devices that implement the given ThingTalk kind.
     *
     * @param {string} kind - the kind to check
     * @returns {Array<DeviceInfo>} - the list of configured devices
     */
    protected abstract getAllDevicesOfKind(kind : string) : Promise<DeviceInfo[]>;

    /**
     * Attempt to automatically configure a device of the given kind.
     *
     * @param {string} kind - the kind to configure
     * @returns {DeviceInfo} - the newly configured device
     */
    protected abstract tryConfigureDevice(dlg : DialogueInterface, kind : string) : Promise<DeviceInfo|null>;

    /**
     * Disambiguate an entity by explicitly asking the user.
     *
     * @param {string} type - the type of disambiguation to perform, either `device`, `contact`,
     *   or `entity`
     * @param {string} name - the name to disambiguate
     * @param {string[]} choices - the choices among which to disambiguate
     * @param {string} hint - a type-specific hint to show to the user
     * @returns {number} - the index of the provided choice
     */
    abstract disambiguate(dlg : DialogueInterface,
                          type : 'device'|'device-missing'|'contact',
                          name : string|null,
                          choices : string[],
                          hint ?: string) : Promise<number>;

    /**
     * Lookup a contact in the address book.
     *
     * @param {ValueCategory} category - the category of information to look up
     * @param {string} name - the name to look up
     * @returns {string[]} - the list of resolved information of all contacts matching the name
     */
    abstract lookupContact(dlg : DialogueInterface, category : ValueCategory, name : string) : Promise<Contact[]>;

    /**
     * Add the display field to a phone or email entity, by looking up the contact in the address book.
     *
     * @param {thingtalk.Ast.Value} contact - the entity to look up
     */
    protected abstract addDisplayToContact(dlg : DialogueInterface, contact : Ast.EntityValue) : Promise<void>;

    /**
     * Ask the user about a contact that is not in the address book.
     *
     * @param {ValueCategory} category - the category of information to look up
     * @param {string} name - the name to look up
     * @returns {thingtalk.Ast.Value.Entity} - the entity corresponding to the picked up information
     */
    abstract askMissingContact(dlg : DialogueInterface,
                               type : InstanceType<typeof Type.Entity>,
                               name : string) : Promise<Ast.EntityValue>;

    /**
     * Resolve a location name to a specific point on Earth.
     *
     * @param {string} searchKey - the location name to look up
     * @param {thingtalk.Ast.Location[]} previousLocations - recently mentioned locations
     * @returns {thingtalk.Ast.Value} - the best match for the given name
     */
    protected abstract lookupLocation(dlg : DialogueInterface, searchKey : string, previousLocations : Ast.AbsoluteLocation[]) : Promise<Ast.LocationValue>;

    /**
     * Lookup all possible candidates for a given entity in the Thingpedia database or
     * by calling the underlying API.
     *
     * @param {string} entityType - the type of entity to look up
     * @param {string} entityDisplay - the display name of the entity look up
     * @param {any} hints - hints to use to resolve any ambiguity
     * @returns {ThingpediaEntity[]} - possible entities that match the given name, in Thingpedia API format
     */
    protected abstract lookupEntityCandidates(dlg : DialogueInterface,
                                              entityType : string,
                                              entityDisplay : string,
                                              hints : DisambiguationHints) : Promise<EntityRecord[]>;

    /**
     * Resolve a `$context` variable to a concrete value.
     *
     * @param {string} variable - the variable name to lookup, including the prefix
     * @returns {thingtalk.Ast.Value} - the resolved value
     */
    protected abstract resolveUserContext(dlg : DialogueInterface, variable : UserContextVariable) : Promise<Ast.Value>;

    /**
     * Compute the user's preferred unit to use when the program specifies an ambiguous unit
     * such as "degrees".
     *
     * @param {string} type - the type of unit to retrieve (e.g. "temperature"), or undefined
     *   if the user has no preference
     * @returns {string} - the preferred unit
     */
    abstract getPreferredUnit(type : string) : string|undefined;
}
