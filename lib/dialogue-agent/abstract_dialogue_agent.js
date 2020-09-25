// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
"use strict";

import assert from 'assert';
import * as ThingTalk from 'thingtalk';
const Ast = ThingTalk.Ast;

import { isExecutable, shouldAutoConfirmStatement } from './dialogue_state_utils';
import { contactSearch } from './entity-linking/contact_search';
import { collectDisambiguationHints, getBestEntityMatch } from './entity-linking/entity-finder';

import * as Helpers from './helpers';

// FIXME should add this to Ast.Selector...
function getDeviceAttribute(selector, name) {
    for (let attr of selector.attributes) {
        if (attr.name === name)
            return attr;
    }
    return undefined;
}

/**
 * Base class of a dialogue agent.
 *
 * The class contains the code that is common between execution (aka inference time)
 * and simulation (aka training time).
 * Because it is used for simulation, the class is completely stateless
 *
 * The public API of this class is used by the entity linking & device choice code
 * (during the "prepare for execution" step) to abstract the access to the "user".
 *
 * There are two subclasses, one used during simulation, and one used for execution.
 */
export default class AbstractDialogueAgent {
    constructor(schemas, options) {
        this._schemas = schemas;

        this._debug = options.debug;
        this.locale = options.locale;
        this.timezone = options.timezone;
    }

    /**
     * Execute the query or action implied by the current dialogue state.
     *
     * This method should return a new dialogue state with filled information
     * about the result. It should not modify the state in-place.
     *
     * This is the only public method in this class.
     *
     * @param {Ast.DialogueState} state - the current state, representing the query or action to execute
     * @param {any} privateState - additional state carried by the dialogue agent (per dialogue)
     * @return {Ast.DialogueState} - the new state, with information about the returned query or action
     */
    async execute(state, privateState) {
        let anyChange = false;
        let clone = state;

        const hints = this._collectDisambiguationHintsForState(state);
        for (let i = 0; i < clone.history.length; i++) {
            if (clone.history[i].results !== null)
                continue;

            if (!anyChange) {
                clone = state.clone();
                anyChange = true;
            }
            // prepare for execution now, even if we don't execute yet
            // so we slot-fill eagerly
            await this._prepareForExecution(clone.history[i].stmt, hints);

            if (clone.history[i].confirm === 'accepted' &&
                isExecutable(clone.history[i].stmt) &&
                shouldAutoConfirmStatement(clone.history[i].stmt))
                clone.history[i].confirm = 'confirmed';
            if (clone.history[i].confirm !== 'confirmed')
                continue;
            assert(isExecutable(clone.history[i].stmt));

            [clone.history[i].results, privateState] = await this._executor.executeStatement(clone.history[i].stmt, privateState);
        }

        return [clone, privateState, anyChange];
    }

    _collectDisambiguationHintsForState(state) {
        const idEntities = new Map;
        const devices = new Map;
        const previousLocations = [];

        // collect all ID entities and all locations from the state
        for (let item of state.history) {
            if (item.results === null)
                continue;

            for (let slot of item.stmt.iterateSlots2()) {
                if (slot instanceof Ast.Selector)
                    devices.set(slot.kind, [slot.id, getDeviceAttribute(slot, 'name')]);
            }

            for (let result of item.results.results)
                collectDisambiguationHints(result, idEntities, previousLocations);
        }

        return { devices, idEntities, previousLocations };
    }

    /**
     * Prepare a statement for being executed.
     *
     * This will resolve all ThingTalk values that are relative to the user, such as
     * `$context.location.current_location`, and will assign device IDs to all Thingpedia
     * function calls.
     *
     * The statement is modified in place.
     *
     * @param {thingtalk.Ast.Statement} stmt - the statement to prepare
     * @param {any} hints - hints to use to resolve any ambiguity
     * @protected
     */
    async _prepareForExecution(stmt, hints) {
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

        stmt.visit(new class extends Ast.NodeVisitor {
            visitInvocation(invocation) {
                let set = new Set;
                for (let inParam of invocation.in_params)
                    set.add(inParam.name);

                for (let arg of invocation.schema.iterateArguments()) {
                    if (arg.is_input && !arg.required && arg.impl_annotations.default && !set.has(arg.name))
                        invocation.in_params.push(new Ast.InputParam(null, arg.name, arg.impl_annotations.default));
                }
                return false;
            }
        });

        for (let slot of stmt.iterateSlots2()) {
            if (slot instanceof Ast.Selector)
                await this._chooseDevice(slot, hints);
            else
                await this._concretizeValue(slot, hints);
        }
    }

    /**
     * Show a debug message.
     *
     * @param {any} msg - what to show
     * @protected
     */
    debug() {
        if (!this._debug)
            return;
        console.log.apply(console, arguments);
    }

    async _chooseDevice(selector, hints) {
        function like(str, substr) {
            if (!str)
                return false;
            return str.toLowerCase().indexOf(substr.toLowerCase()) >= 0;
        }

        if (selector.isBuiltin) return;
        if (selector.id !== null)
            return;

        const kind = selector.kind;
        const name = getDeviceAttribute(selector, 'name');
        if (hints.devices.has(kind)) {
            // if we have already selected a device for this kind in the context, reuse what
            // we chose before without asking again
            const [previousId, previousName] = hints.devices.get(kind);
            selector.id = previousId;
            if (name && previousName)
                name.value = previousName.value;
            else if (previousName)
                selector.attributes.push(previousName.clone());
            return;
        }

        const alldevices = this.getAllDevicesOfKind(kind);

        if (alldevices.length === 0) {
            this.debug('No device of kind ' + kind + ' available, attempting configure...');
            const device = await this.tryConfigureDevice(kind);
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
        if (name !== undefined)
            selecteddevices = alldevices.filter((d) => like(d.name, name.value.toJS()));

        // TODO let the user choose if multiple devices match...
        if (selecteddevices.length >= 1) {
            selector.id = selecteddevices[0].uniqueId;
            if (name)
                name.value = new Ast.Value.String(selecteddevices[0].name);
            else
                selector.attributes.push(new Ast.InputParam(null, 'name', new Ast.Value.String(selecteddevices[0].name)));
            return;
        }

        const choosefrom = (selecteddevices.length ? selecteddevices : alldevices);
        const choice = await this.disambiguate('device',
            selecteddevices.length && name ? name.value.toJS() : null, choosefrom.map((d) => d.name), kind);
        selector.id = choosefrom[choice].uniqueId;
        if (name)
            name.value = new Ast.Value.String(choosefrom[0].name);
        else
            selector.attributes.push(new Ast.InputParam(null, 'name', new Ast.Value.String(choosefrom[0].name)));
    }

    async _addDisplayToDevice(value) {
        try {
            const classDef = await this._schemas.getFullMeta(value.value);

            value.display = classDef.metadata.thingpedia_name || classDef.metadata.canonical ||
                Helpers.cleanKind(value.value);
        } catch(e) {
            /* ignore if the device does not exist, it might be a constant of the form
               "str:ENTITY_tt:device::" */
        }
    }

    async _maybeAddDisplayToValue(value) {
        switch (value.type) {
        case 'tt:contact':
            await this.addDisplayToContact(value);
            break;

        case 'tt:device':
            await this._addDisplayToDevice(value);
            break;
        }
    }

    async _concretizeValue(slot, hints) {
        let value = slot.get();
        const ptype = slot.type;

        if (value.isEntity && (value.type === 'tt:username' || value.type === 'tt:contact_name')
            && ptype.isEntity && ptype.type !== value.type)
            slot.set(await contactSearch(this, ptype, value.value));
            // continue resolving in case the new type is tt:contact

        // default units (e.g. defaultTemperature) will be concretized
        // according to the user's preferences or locale
        // since dlg.locale is overwritten to be en-US, we infer the locale
        // via other environment variables like LANG (language) or TZ (timezone)
        if (value.isMeasure && value.unit.startsWith('default')) {
            value.unit = this.getPreferredUnit(value.unit.substring('default'.length).toLowerCase());
        } else if (value.isLocation && value.value.isUnresolved) {
            slot.set(await this.lookupLocation(value.value.name, hints.previousLocations || []));
        } else if (value.isLocation && value.value.isRelative) {
            slot.set(await this.resolveUserContext('$context.location.' + value.value.relativeTag));
        } else if (value.isTime && value.value !== undefined && value.value.isRelative) {
            slot.set(await this.resolveUserContext('$context.time.' + value.value.relativeTag));
        } else if (value.isEntity && value.value === null) {
            const candidates = (hints.idEntities ? hints.idEntities.get(value.type) : undefined)
                || await this.lookupEntityCandidates(value.type, value.display, hints);
            const resolved = getBestEntityMatch(value.display, value.type, candidates);
            value.value = resolved.value;
            value.display = resolved.name;
        }

        value = slot.get();
        assert(value.isConcrete());
        if (value.isEntity && !value.display)
            await this._maybeAddDisplayToValue(value);
    }

    // The rest is the API that subclasses must implement

    /* instanbul ignore next */
    /**
     * Retrieve the executor to use for each statement.
     *
     * @type {AbstractStatementExecutor}
     * @readonly
     * @abstract
     * @protected
     */
    get executor() {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * List all configured devices that implement the given ThingTalk kind.
     *
     * @param {string} kind - the kind to check
     * @returns {Array<DeviceInfo>} - the list of configured devices
     * @abstract
     * @protected
     */
    getAllDevicesOfKind() {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Attempt to automatically configure a device of the given kind.
     *
     * @param {string} kind - the kind to configure
     * @returns {DeviceInfo} - the newly configured device
     * @abstract
     * @protected
     */
    async tryConfigureDevice(kind) {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Disambiguate an entity by explicitly asking the user.
     *
     * @param {string} type - the type of disambiguation to perform, either `device`, `contact`,
     *   or `entity`
     * @param {string} name - the name to disambiguate
     * @param {string[]} choices - the choices among which to disambiguate
     * @param {string} hint - a type-specific hint to show to the user
     * @returns {number} - the index of the provided choice
     * @abstract
     * @protected
     */
    async disambiguate(type, name, choices, hint) {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Lookup a contact in the address book.
     *
     * @param {ValueCategory} category - the category of information to look up
     * @param {string} name - the name to look up
     * @returns {string[]} - the list of resolved information of all contacts matching the name
     * @abstract
     * @protected
     */
    async lookupContact(category, name) {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Add the display field to a phone or email entity, by looking up the contact in the address book.
     *
     * @param {thingtalk.Ast.Value} contact - the entity to look up
     * @abstract
     * @protected
     */
    async addDisplayToContact(contact) {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Ask the user about a contact that is not in the address book.
     *
     * @param {ValueCategory} category - the category of information to look up
     * @param {string} name - the name to look up
     * @returns {thingtalk.Ast.Value.Entity} - the entity corresponding to the picked up information
     * @abstract
     * @protected
     */
    async askMissingContact(category, name) {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Resolve a location name to a specific point on Earth.
     *
     * @param {string} searchKey - the location name to look up
     * @param {thingtalk.Ast.Location[]} previousLocations - recently mentioned locations
     * @returns {thingtalk.Ast.Value} - the best match for the given name
     * @abstract
     * @protected
     */
    async lookupLocation(searchKey, previousLocations) {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Lookup all possible candidates for a given entity in the Thingpedia database or
     * by calling the underlying API.
     *
     * @param {string} entityType - the type of entity to look up
     * @param {string} entityDisplay - the display name of the entity look up
     * @param {any} hints - hints to use to resolve any ambiguity
     * @returns {ThingpediaEntity[]} - possible entities that match the given name, in Thingpedia API format
     * @abstract
     * @protected
     */
    async lookupEntityCandidates(entityType, entityDisplay, hints) {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Resolve a `$context` variable to a concrete value.
     *
     * @param {string} variable - the variable name to lookup, including the `$context.` prefix
     * @returns {thingtalk.Ast.Value} - the resolved value
     * @abstract
     * @protected
     */
    async resolveUserContext(variable) {
        throw new TypeError('Abstract method');
    }

    /* instanbul ignore next */
    /**
     * Compute the user's preferred unit to use when the program specifies an ambiguous unit
     * such as "degrees".
     *
     * @param {string} baseUnit - the base unit of the relevant measurement (e.g. `C` for temperature)
     * @returns {string} - the preferred unit
     * @abstract
     * @protected
     */
    getPreferredUnit(type) {
        throw new TypeError('Abstract method');
    }
}
