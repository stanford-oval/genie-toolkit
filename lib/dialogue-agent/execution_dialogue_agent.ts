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
import { Ast, Type } from 'thingtalk';

import type Engine from '../engine';
import type { DeviceInfo } from '../engine';

import { cleanKind } from '../utils/misc-utils';
import { ReplacedList, ReplacedConcatenation } from '../utils/template-string';
import ValueCategory from './value-category';
import StatementExecutor from './statement_executor';
import { CancellationError } from './errors';
import { EntityRecord, getBestEntityMatch } from './entity-linking/entity-finder';
import { Contact } from './entity-linking/contact_search';
import { PlatformData } from './protocol';
import { ConversationState } from './conversation';

import AbstractDialogueAgent, {
    DisambiguationHints,
} from './abstract_dialogue_agent';

interface AbstractConversation {
    id : string;
    getState() : ConversationState;
}

/**
 * The interface that the {@link ExecutionDialogueAgent} uses to communicate
 * with outside.
 *
 * In some code paths, {@link ExecutionDialogueAgent} needs to send messages
 * to the user or ask questions, in the middle of preparing for execution
 * and outside of the normal dialogue loop.
 *
 * It does so by calling this interface, which for the normal assistant is
 * implemented by {@link DialogueLoop}.
 *
 * TODO: This interface has some ugly inversion of control where the outside
 * code that drives the dialogue gets called synchronously by this code.
 * We should refactor all of this.
 */
export interface AbstractDialogueLoop {
    platformData : PlatformData;
    isAnonymous : boolean;
    _ : (x : string) => string;
    conversation : AbstractConversation;

    reply(msg : string) : Promise<void>;
    replyLink(title : string, link : string, state ?: ConversationState) : Promise<void>;
    interpolate(msg : string, args : Record<string, unknown>) : string;
    replyInterp(msg : string, args : Record<string, unknown>) : Promise<void>;
    ask(expected : ValueCategory.PhoneNumber|ValueCategory.EmailAddress|ValueCategory.Location|ValueCategory.Time,
        question : string,
        args ?: Record<string, unknown>) : Promise<Ast.Value>;
    askChoices(question : string, choices : string[]) : Promise<number>;
}

/**
 * The execution time dialogue agent.
 *
 * Provides access to the real user's information, stored in the engine.
 */
export default class ExecutionDialogueAgent extends AbstractDialogueAgent<undefined> {
    private _engine : Engine;
    private _platform : Tp.BasePlatform;
    private _dlg : AbstractDialogueLoop;
    private _executor : StatementExecutor;

    constructor(engine : Engine, dlg : AbstractDialogueLoop, debug : boolean) {
        super(engine.thingpedia, engine.schemas, {
            debug: debug,
            locale: engine.platform.locale,
            timezone: engine.platform.timezone
        });

        this._engine = engine;
        this._platform = engine.platform;
        this._executor = new StatementExecutor(engine, dlg.conversation.id);
        this._dlg = dlg;
    }

    get _() {
        return this._dlg._;
    }
    get executor() {
        return this._executor;
    }

    async getAllDevicesOfKind(kind : string) {
        return this._engine.getDeviceInfos(kind);
    }

    private async _requireRegistration(msg : string) : Promise<never> {
        const state = this._dlg.conversation.getState();
        await this._dlg.reply(msg);
        await this._dlg.replyLink(this._("Sign up for Genie"), "/user/register", state);
        throw new CancellationError();
    }

    protected async checkForPermission(stmt : Ast.ExpressionStatement) {
        if (!this._dlg.isAnonymous)
            return;

        if (stmt.last.schema!.functionType === 'action' &&
            !['org.thingpedia.builtin.thingengine.builtin.faq_reply',
              'org.thingpedia.builtin.thingengine.builtin.say'].includes(stmt.last.schema!.qualifiedName))
            await this._requireRegistration(this._("To use this command you must first create a personal Genie account."));

        if (stmt.stream) {
            // check available notification backends
            // if we have one, we allow notifications from anonymous accounts
            // and we'll ask the user for the notification configuration
            // otherwise, we reject them
            const available = this._engine.assistant.getAvailableNotificationBackends();

            if (available.length === 0)
                await this._requireRegistration(this._("To receive notifications you must first create a personal Genie account."));
        }
    }

    async disambiguate(type : 'device'|'device-missing'|'contact',
                       name : string|null,
                       choices : string[],
                       hint ?: string) : Promise<number> {
        let question : string;
        if (type === 'device-missing') {
            assert(name);
            question = this._dlg.interpolate(this._("I cannot find any ${name} ${device} device. Which device do you want to use?"), {
                name, device: cleanKind(hint!)
            });
        } else if (type === 'device') {
            question = this._dlg.interpolate(this._("You have multiple {${name}| }${device} devices. Which one do you want to use?"), {
                name, device: cleanKind(hint!)
            });
        } else {
            question = this._dlg.interpolate(this._("Multiple contacts match “${name}”. Who do you mean?"), { name });
        }
        return this._dlg.askChoices(question, choices);
    }

    protected async tryConfigureDevice(kind : string) : Promise<DeviceInfo|null> {
        const factories = await this._tpClient.getDeviceSetup([kind]);
        const factory = factories[kind];
        if (!factory) {
            await this._dlg.replyInterp(this._("You need to enable ${device} before you can use that command."), {
                device: cleanKind(kind)
            });
            await this._dlg.replyLink(this._dlg.interpolate(this._("Configure ${device}"), {
                device: cleanKind(kind)
            }), "/devices/create");
            return null;
        }

        if (factory.type === 'none') {
            const device = await this._engine.createDevice({ kind: factory.kind });
            return this._engine.getDeviceInfo(device.uniqueId!);
        } else {
            if (this._dlg.isAnonymous) {
                await this._requireRegistration(this._dlg.interpolate(this._("Sorry, to use ${device}, you must create a personal Almond account."), {
                    device: factory.text,
                }));
            }

            if (factory.type === 'multiple' && factory.choices.length === 0) {
                await this._dlg.replyInterp(this._("You need to enable ${device} before you can use that command."), {
                    device: factory.text
                });
            } else if (factory.type === 'multiple') {
                await this._dlg.replyInterp(this._("You do not have a ${device} configured. You will need to enable ${choices} before you can use that command."), {
                    device: factory.text,
                    choices: new ReplacedList(factory.choices.map((f) => new ReplacedConcatenation([f.text], {}, {})), this._engine.platform.locale, 'disjunction')
                });
            } else if ((await this.getAllDevicesOfKind(factory.kind)).length > 0) {
                await this._dlg.replyInterp(this._("You do not have a ${device} configured. You will need to configure it inside your ${factory} before you can use that command."), {
                    device: cleanKind(kind),
                    factory: factory.text,
                });
                // exit early without any button
                return null;
            } else {
                await this._dlg.replyInterp(this._("You need to enable ${device} before you can use that command."), {
                    device: factory.text
                });
            }

            // HACK: home assistant cannot be configured here, override the factory type
            if (factory.type !== 'multiple' && factory.kind === 'io.home-assistant')
                factory.type = 'interactive'; // this code is CHAOTIC EVIL as it exploits the unsoundness of TypeScript :D

            switch (factory.type) {
            case 'oauth2':
                await this._dlg.replyLink(this._dlg.interpolate(this._("Configure ${device}"), { device: factory.text }),
                    `/devices/oauth2/${factory.kind}?name=${encodeURIComponent(factory.text)}`);
                break;
            case 'multiple':
                await this._dlg.replyLink(this._("Configure a new skill"), "/devices/create");
                break;
            default:
                await this._dlg.replyLink(this._dlg.interpolate(this._("Configure ${device}"), { device: factory.text }), "/devices/create");
            }
            return null;
        }
    }

    async lookupContact(category : ValueCategory, name : string) : Promise<Contact[]> {
        if (this._dlg.platformData.contacts) {
            for (const platformContact of this._dlg.platformData.contacts) {
                if (platformContact.value === name) {
                    this.debug(`Mapped @${name} to ${platformContact.principal} using platform data`);
                    return [{
                        value: platformContact.principal,
                        displayName: platformContact.display
                    }];
                }
            }
        }

        const contactApi = this._platform.getCapability('contacts');
        if (contactApi === null)
            return [];

        let what : 'phone_number' | 'email_address' | 'contact';
        if (category === ValueCategory.PhoneNumber)
            what = 'phone_number';
        else if (category === ValueCategory.EmailAddress)
            what = 'email_address';
        else
            what = 'contact';
        return contactApi.lookup(what, name);
    }

    async askMissingContact(category : ValueCategory.EmailAddress|ValueCategory.PhoneNumber|ValueCategory.Contact,
                            name : string) : Promise<Ast.EntityValue> {
        await this._dlg.replyInterp(this._("No contact matches “${name}”."), { name });

        // straight up ask for the target category
        // this ensures we show a contact picker, which is better than
        // repeatedly asking the user
        const value = await this._dlg.ask(category === ValueCategory.Contact ? ValueCategory.PhoneNumber : category,
            this._("Who do you want to contact?"));
        assert(value instanceof Ast.EntityValue);
        return value;
    }

    protected async addDisplayToContact(contact : Ast.EntityValue) : Promise<void> {
        const principal = contact.value;
        if (!principal)
            return;

        if (this._dlg.platformData.contacts) {
            for (const platformContact of this._dlg.platformData.contacts) {
                if (platformContact.principal === principal) {
                    contact.display = platformContact.display;
                    return;
                }
            }
        }

        const contactApi = this._platform.getCapability('contacts');
        if (contactApi === null)
            return;

        const addressBookContact = await contactApi.lookupPrincipal(principal);
        if (addressBookContact)
            contact.display = addressBookContact.displayName;
    }

    private async _constructEntityQuery(kind : string, query : string, entityDisplay : string) {
        const schema = await this._schemas.getSchemaAndNames(kind, 'query', query);
        const filter = new Ast.BooleanExpression.Atom(null, 'id', '=~', new Ast.Value.String(entityDisplay));
        const invocation = (new Ast.Invocation(null, new Ast.DeviceSelector(null, kind, null, null), query, [], schema));
        const invocationTable = new Ast.InvocationExpression(null, invocation, schema);
        const filteredTable = new Ast.FilterExpression(null, invocationTable, filter, schema);
        return new Ast.ExpressionStatement(null, filteredTable);
    }

    protected async resolveEntity(entityType : string,
                                  entityDisplay : string,
                                  hints : DisambiguationHints) : Promise<EntityRecord> {
        const hintsCandidates = hints.idEntities.get(entityType);
        if (hintsCandidates)
            return getBestEntityMatch(entityDisplay, entityType, hintsCandidates);

        // HACK this should be made generic with some new Genie annotation
        if (entityType === 'org.freedesktop:app_id') {
            const appLauncher = this._platform.getCapability('app-launcher');
            if (appLauncher) {
                const apps = await appLauncher.listApps();
                return getBestEntityMatch(entityDisplay, entityType, apps);
            }
        }

        const { data: tpCandidates, /*meta*/ } = await this._tpClient.lookupEntity(entityType, entityDisplay);
        if (tpCandidates.length > 0)
            return getBestEntityMatch(entityDisplay, entityType, tpCandidates);

        let stmt;
        try {
            const kind = entityType.split(":")[0];
            const query = entityType.split(":")[1];
            stmt = await this._constructEntityQuery(kind, query, entityDisplay);
        } catch(e) {
            // ignore an error here (it indicates the query is not an ID query)
        }

        let candidates = tpCandidates;
        if (stmt) {
            await this._prepareForExecution(stmt, hints);
            const [results,] = await this._executor.executeStatement(stmt, undefined, undefined);
            candidates = [];
            for (const item of results!.results) {
                const id = item.value.id;
                if (!id || !(id instanceof Ast.EntityValue))
                    continue;

                const entity = {
                    type: entityType,
                    value: id.value!,
                    canonical: id.display!.toLowerCase(),
                    name: id.display!
                };
                candidates.push(entity);
            }
        }

        if (candidates.length === 0) {
            console.error(`Cannot find any entity of type ${entityType} matching "${entityDisplay}"`);
            /*await this._dlg.replyInterp(this._("Sorry, I cannot find any ${entity_type} matching “${name}”."), {
                entity_type: meta.name,
                name: entityDisplay
            });*/
            throw new CancellationError();
        }
        return candidates[0];
    }

    private async _tryGetCurrentLocation() : Promise<Ast.AbsoluteLocation|null> {
        const gps = this._platform.getCapability('gps');
        if (gps === null)
            return null;
        const location = await gps.getCurrentLocation();
        if (location === null) {
            this.debug('GPS location not available');
            return null;
        } else {
            return new Ast.Location.Absolute(location.latitude, location.longitude, location.display||null);
        }
    }

    protected async lookupLocation(searchKey : string, previousLocations : Ast.AbsoluteLocation[]) : Promise<Ast.LocationValue> {
        const currentLocation = await this._tryGetCurrentLocation();
        const lastLocation = previousLocations.length ? previousLocations[previousLocations.length - 1] : undefined;

        let around;
        if (lastLocation)
            around = { latitude: lastLocation.lat, longitude: lastLocation.lon };
        else if (currentLocation)
            around = { latitude: currentLocation.lat, longitude: currentLocation.lon };

        const candidates = await this._tpClient.lookupLocation(searchKey, around);

        // ignore locations larger than a city
        const mapped = candidates.filter((c) => c.rank >= 16).map((c) => {
            return new Ast.Location.Absolute(c.latitude, c.longitude, c.display);
        });

        if (mapped.length === 0) {
            await this._dlg.replyInterp(this._("Sorry, I cannot find any location matching “${location}”."), {
                location: searchKey,
            });
            throw new CancellationError();
        }

        return new Ast.Value.Location(mapped[0]);
    }

    private _tryGetStoredVariable(type : Type, variable : string) : Ast.Value|null {
        if (this._dlg.isAnonymous)
            return null;

        const sharedPrefs = this._platform.getSharedPreferences();

        const value = sharedPrefs.get('context-' + variable);
        if (value === undefined)
            return null;
        return Ast.Value.fromJSON(type, value);
    }

    private async _resolvePhoneNumber() : Promise<Ast.Value> {
        // if we received the command over SMS, that's our phone number, immediately
        if (this._dlg.platformData.from && this._dlg.platformData.from.startsWith('phone:'))
            return new Ast.Value.Entity(this._dlg.platformData.from.substring('phone:'.length), 'tt:phone_number', null);

        if (!this._dlg.isAnonymous) {
            const profile = this._platform.getProfile();
            if (profile.phone) {
                // TODO phone verification???
                assert(profile.phone_verified);
                return new Ast.Value.Entity(profile.phone, 'tt:phone_number', null);
            }
        }

        const phone = await this._dlg.ask(ValueCategory.PhoneNumber, this._("What is your phone number?"));
        if (this._dlg.isAnonymous) {
            return phone;
        } else {
            if (!await this._platform.setProfile({ phone: String(phone.toJS()) }))
                return phone;

            const profile = this._platform.getProfile();
            assert(profile.phone_verified);
            return phone;
        }
    }

    private async _resolveEmailAddress() : Promise<Ast.Value> {
        // if we received the command over email, that's our email address, immediately
        if (this._dlg.platformData.from && this._dlg.platformData.from.startsWith('email:'))
            return new Ast.Value.Entity(this._dlg.platformData.from.substring('email:'.length), 'tt:email_address', null);

        if (!this._dlg.isAnonymous) {
            const profile = this._platform.getProfile();
            if (profile.email) {
                if (!profile.email_verified)
                    await this._dlg.reply(this._("You must verify your email address by clicking the verification link before you can use it to receive notifications."));
                return new Ast.Value.Entity(profile.email, 'tt:email_address', null);
            }
        }

        const email = await this._dlg.ask(ValueCategory.EmailAddress, this._("What is your email address?"));
        if (this._dlg.isAnonymous) {
            return email;
        } else {
            if (!await this._platform.setProfile({ email: String(email.toJS()) }))
                return email;

            const profile = this._platform.getProfile();
            if (!profile.email_verified)
                await this._dlg.reply(this._("Thank you! Please verify your email address by clicking the verification link before continuing."));

            return email;
        }
    }

    protected async resolveUserContext(variable : string) : Promise<Ast.Value> {
        switch (variable) {
        case '$context.self.phone_number':
            return this._resolvePhoneNumber();
        case '$context.self.email_address':
            return this._resolveEmailAddress();
        }

        let value : Ast.Value|null = null;
        switch (variable) {
        case '$context.location.current_location': {
            const location = await this._tryGetCurrentLocation();
            if (location)
                value = new Ast.Value.Location(location);
            else
                value = this._tryGetStoredVariable(Type.Location, variable);
            break;
        }
        case '$context.location.home':
        case '$context.location.work':
            value = this._tryGetStoredVariable(Type.Location, variable);
            break;
        case '$context.time.morning':
        case '$context.time.evening':
            value = this._tryGetStoredVariable(Type.Time, variable);
            break;
        default:
            throw new TypeError('Invalid variable ' + variable);
        }
        if (value !== null)
            return value;

        let question, type;
        switch (variable) {
        case '$context.location.current_location':
            question = this._("Where are you now?");
            type = ValueCategory.Location as const;
            break;
        case '$context.location.home':
            question = this._("What is your home address?");
            type = ValueCategory.Location as const;
            break;
        case '$context.location.work':
            question = this._("What is your work address?");
            type = ValueCategory.Location as const;
            break;
        case '$context.time.morning':
            question = this._("What time does your morning begin?");
            type = ValueCategory.Time as const;
            break;
        case '$context.time.evening':
            question = this._("What time does your evening begin?");
            type = ValueCategory.Time as const;
            break;
        }

        let answer = await this._dlg.ask(type, question);
        if (type === ValueCategory.Location) {
            assert(answer instanceof Ast.LocationValue);

            if (answer.value instanceof Ast.RelativeLocation)
                answer = await this.resolveUserContext('$context.location.' + answer.value.relativeTag);
            else if (answer.value instanceof Ast.UnresolvedLocation)
                answer = await this.lookupLocation(answer.value.name, []);
        }

        if (!this._dlg.isAnonymous) {
            const sharedPrefs = this._platform.getSharedPreferences();
            sharedPrefs.set('context-' + variable, answer.toJS());
        }
        return answer;
    }

    getPreferredUnit(type : string) : string|undefined {
        const pref = this._platform.getSharedPreferences();
        return pref.get('preferred-' + type) as string|undefined;
    }

    protected async configureNotifications() {
        if (!this._dlg.isAnonymous) {
            // if we're not anonymous, look at the previous configuration

            const prefs = this._platform.getSharedPreferences();
            const backendId = prefs.get('notification-backend') as string|undefined;
            // check if the user has chosen a backend, and if that backend was
            // autodiscovered from a thingpedia device, check that the device is
            // still available
            if (backendId !== undefined &&
                (!backendId.startsWith('thingpedia/') || this._engine.hasDevice(backendId.substring('thingpedia/'.length))))
                return undefined; // return null so we don't force a particular configuration now
        }

        const available = this._engine.assistant.getAvailableNotificationBackends();
        // if no backend is available, use the default (which is to blast to all
        // conversations) and leave it unspecified
        if (available.length === 0)
            return undefined;

        // if we have voice, we'll use that for notifications
        if (this._platform.hasCapability('sound'))
            return undefined;


        let backend;
        if (this._dlg.platformData.from) {
            if (this._dlg.platformData.from.startsWith('email:'))
                backend = available.find((b) => b.uniqueId === 'email');
            else if (this._dlg.platformData.from.startsWith('phone:'))
                backend = available.find((b) => b.uniqueId === 'twilio');
        }
        if (!backend) {
            let chosen;
            if (available.length > 1) {
                const choices = available.map((c) => c.name);
                chosen = await this._dlg.askChoices(this._("How would you like to be notified?"), choices);
            } else {
                chosen = 0;
            }
            backend = available[chosen];
        }

        const settings = backend.requiredSettings;
        const config : Record<string, string> = {};
        // ensure that all settings needed by the notification backend are set
        for (const key in settings) {
            const variable = settings[key];
            config[key] = String((await this.resolveUserContext(variable)).toJS());
        }

        // if we get here, the user has given meaningful answers to our questions
        // in anonymous mode, we make up a transient notification config that we'll
        // use just for this program
        //
        // in non-anonymous mode, we save the choice the notification backend
        // other info has been saved to the profile already

        if (this._dlg.isAnonymous) {
            return {
                backend: backend.uniqueId,
                config
            };
        } else {
            const prefs = this._platform.getSharedPreferences();
            prefs.set('notification-backend', backend.uniqueId);
            return undefined;
        }
    }
}
