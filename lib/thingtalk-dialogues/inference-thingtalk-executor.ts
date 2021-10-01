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
import { Ast, Type, } from 'thingtalk';

import type Engine from '../engine';
import type { AppExecutor, DeviceInfo } from '../engine';

import { cleanKind } from '../utils/misc-utils';
import { ReplacedList, ReplacedConcatenation } from '../utils/template-string';
import * as ThingTalkUtils from '../utils/thingtalk';
import ValueCategory from '../dialogue-runtime/value-category';
import type { NewProgramRecord } from '../dialogue-runtime/conversation';
import { CancellationError } from '../dialogue-runtime/errors';
import { EntityRecord } from './entity-linking/entity-finder';
import { Contact } from './entity-linking/contact_search';

import AbstractThingTalkExecutor, {
    DisambiguationHints, ExecutionResult, NotificationConfig, RawExecutionResult, UserContextVariable,
} from './abstract-thingtalk-executor';
import { DialogueInterface } from './interface';
import { TemplatePlaceholderMap } from '../sentence-generator/types';

interface AbstractConversation {
    id : string;
    sendNewProgram(newProgram : NewProgramRecord) : Promise<void>
}

// above MORE_SIZE, we set the "more" bit
const MORE_SIZE = 50;
// above PAGE_SIZE, we set the count but don't actually show the full list of results
const PAGE_SIZE = 10;

/**
 * The execution time dialogue agent.
 *
 * Provides access to the real user's information, stored in the engine.
 */
export default class InferenceTimeThingTalkExecutor extends AbstractThingTalkExecutor {
    readonly _ : (x : string) => string;
    private _conversation : AbstractConversation;
    private _engine : Engine;
    private _platform : Tp.BasePlatform;

    constructor(engine : Engine, conversation : AbstractConversation, debug = true) {
        super(engine.thingpedia, engine.schemas, {
            debug: debug,
            locale: engine.platform.locale,
            timezone: engine.platform.timezone
        });

        this._ = engine.langPack._;
        this._engine = engine;
        this._platform = engine.platform;
        this._conversation = conversation;
    }

    private async _iterateResults(app : AppExecutor,
                                  schema : Ast.FunctionDef,
                                  into : Ast.DialogueHistoryResultItem[],
                                  intoRaw : RawExecutionResult) : Promise<[boolean, ThingTalkUtils.ErrorWithCode|undefined]> {
        let count = 0;
        if (app === null)
            return [false, undefined];

        let error : ThingTalkUtils.ErrorWithCode|undefined;
        for await (const value of app.mainOutput) {
            if (count >= MORE_SIZE)
                return [true, error];

            if (value instanceof Error) {
                error = value;
            } else {
                const mapped = await ThingTalkUtils.mapResult(schema, value.outputValue);
                into.push(mapped);
                intoRaw.push([value.outputType, value.outputValue]);
                count ++;
            }
        }

        // if we get here, we iterated all results from the app, so we can stop
        return [false, error];
    }

    async execute(dlg : DialogueInterface, program : Ast.Program, notifications : NotificationConfig|undefined) : Promise<ExecutionResult[]> {
        const app = await this._engine.createApp(program, { notifications, conversation: this._conversation.id });
        if (program.statements.length > 1)
            throw new Error(`not implemented yet: program with multiple statements`);
        if (!(program.statements[0] instanceof Ast.ExpressionStatement))
            throw new Error(`not implemented yet: ${program.statements[0].constructor.name}`);
        const stmt = program.statements[0];

        // by now the statement must have been typechecked
        assert(stmt.expression.schema);
        const results : Ast.DialogueHistoryResultItem[] = [];
        const rawResults : RawExecutionResult = [];
        const [more, error] = await this._iterateResults(app, stmt.expression.schema, results, rawResults);

        const annotations : Ast.AnnotationMap = {};
        let errorValue;
        if (error) {
            if (error.code)
                errorValue = new Ast.Value.Enum(error.code);
            else
                errorValue = new Ast.Value.String(error.message);
            annotations.error_detail = new Ast.Value.String(error.message);
            if (error.stack)
                annotations.error_stack = new Ast.Value.String(error.stack);
        }

        const resultList = new Ast.DialogueHistoryResultList(null, results.slice(0, PAGE_SIZE),
            new Ast.Value.Number(results.length), more, errorValue);
        const newProgramRecord = {
            uniqueId: app.uniqueId!,
            name: app.name,
            code: program.prettyprint(),
            results: rawResults.map((r) => r[1]),
            errors: errorValue ? [errorValue.toJS()] : [],
            icon: app.icon,
        };
        await this._conversation.sendNewProgram(newProgramRecord);
        return [{ stmt, results: resultList, rawResults }];
    }

    async getAllDevicesOfKind(kind : string) {
        return this._engine.getDeviceInfos(kind);
    }

    private _requireRegistration(dlg : DialogueInterface, msg : string, args : TemplatePlaceholderMap = {}) : never {
        dlg.say(msg, args);
        dlg.sendLink(this._("Sign up for Genie"), "/user/register");
        throw new CancellationError();
    }

    protected async checkForPermission(dlg : DialogueInterface, stmt : Ast.ExpressionStatement) {
        if (!dlg.anonymous)
            return;

        if (stmt.last.schema!.functionType === 'action' &&
            !['org.thingpedia.builtin.thingengine.builtin.faq_reply',
              'org.thingpedia.builtin.thingengine.builtin.say'].includes(stmt.last.schema!.qualifiedName))
            await this._requireRegistration(dlg, this._("To use this command you must first create a personal Genie account."));

        if (stmt.stream) {
            // check available notification backends
            // if we have one, we allow notifications from anonymous accounts
            // and we'll ask the user for the notification configuration
            // otherwise, we reject them
            const available = this._engine.assistant.getAvailableNotificationBackends();

            if (available.length === 0)
                await this._requireRegistration(dlg, this._("To receive notifications you must first create a personal Genie account."));
        }
    }

    async disambiguate(dlg : DialogueInterface,
                       type : 'device'|'device-missing'|'contact',
                       name : string|null,
                       choices : string[],
                       hint ?: string) : Promise<number> {
        let question : string;
        let args : TemplatePlaceholderMap;
        let act : string;
        if (type === 'device-missing') {
            assert(name);
            question = this._("I cannot find any ${name} ${device} device. Which device do you want to use?");
            args = {
                name, device: cleanKind(hint!)
            };
            act = 'sys_resolve_device';
        } else if (type === 'device') {
            question = this._("You have multiple {${name}| }${device} devices. Which one do you want to use?");
            args = {
                name, device: cleanKind(hint!)
            };
            act = 'sys_resolve_device';
        } else {
            question = this._("Multiple contacts match “${name}”. Who do you mean?");
            args = { name };
            act = 'sys_resolve_contact';
        }
        return dlg.askChoices(question, args, act, choices);
    }

    protected async tryConfigureDevice(dlg : DialogueInterface, kind : string) : Promise<DeviceInfo|null> {
        const factories = await this._tpClient.getDeviceSetup([kind]);
        const factory = factories[kind];
        if (!factory) {
            dlg.say(this._("You need to enable ${device} before you can use that command."), {
                device: cleanKind(kind)
            });
            dlg.sendLink(this._("Configure ${device}"), "/devices/create", {
                device: cleanKind(kind)
            });
            return null;
        }

        if (factory.type === 'none') {
            const device = await this._engine.createDevice({ kind: factory.kind });
            return this._engine.getDeviceInfo(device.uniqueId!);
        } else {
            if (dlg.anonymous) {
                this._requireRegistration(dlg, this._("Sorry, to use ${device}, you must create a personal Genie account."), {
                    device: factory.text,
                });
            }

            if (factory.type === 'multiple' && factory.choices.length === 0) {
                dlg.say(this._("You need to enable ${device} before you can use that command."), {
                    device: factory.text
                });
            } else if (factory.type === 'multiple') {
                dlg.say(this._("You do not have a ${device} configured. You will need to enable ${choices} before you can use that command."), {
                    device: factory.text,
                    choices: new ReplacedList(factory.choices.map((f) => new ReplacedConcatenation([f.text], {}, {})), this._engine.platform.locale, 'disjunction')
                });
            } else if ((await this.getAllDevicesOfKind(factory.kind)).length > 0) {
                dlg.say(this._("You do not have a ${device} configured. You will need to configure it inside your ${factory} before you can use that command."), {
                    device: cleanKind(kind),
                    factory: factory.text,
                });
                // exit early without any button
                return null;
            } else {
                dlg.say(this._("You need to enable ${device} before you can use that command."), {
                    device: factory.text
                });
            }

            // HACK: home assistant cannot be configured here, override the factory type
            if (factory.type !== 'multiple' && factory.kind === 'io.home-assistant')
                factory.type = 'interactive'; // this code is CHAOTIC EVIL as it exploits the unsoundness of TypeScript :D

            switch (factory.type) {
            case 'oauth2':
                await dlg.sendLink(this._("Configure ${device}"),
                    `/devices/oauth2/${factory.kind}?name=${encodeURIComponent(factory.text)}`,
                    { device: factory.text });
                break;
            case 'multiple':
                await dlg.sendLink(this._("Configure a new skill"), "/devices/create");
                break;
            default:
                await dlg.sendLink(this._("Configure ${device}"), "/devices/create", { device: factory.text });
            }
            return null;
        }
    }

    async lookupContact(dlg : DialogueInterface, category : ValueCategory, name : string) : Promise<Contact[]> {
        const platformContacts = dlg.command?.platformData.contacts;
        if (platformContacts) {
            for (const platformContact of platformContacts) {
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

    async askMissingContact(dlg : DialogueInterface,
                            // FIXME ugly
                            type : InstanceType<typeof Type.Entity>,
                            name : string) : Promise<Ast.EntityValue> {
        dlg.say(this._("No contact matches “${name}”."), { name });

        // straight up ask for the target category
        // this ensures we show a contact picker, which is better than
        // repeatedly asking the user
        const value = await dlg.ask(this._("Who do you want to contact?"), {}, 'sys_resolve_contact', [], type);
        assert(value instanceof Ast.EntityValue);
        return value;
    }

    protected async addDisplayToContact(dlg : DialogueInterface, contact : Ast.EntityValue) : Promise<void> {
        const principal = contact.value;
        if (!principal)
            return;

        const platformContacts = dlg.command?.platformData.contacts;
        if (platformContacts) {
            for (const platformContact of platformContacts) {
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

    protected async lookupEntityCandidates(dlg : DialogueInterface,
                                           entityType : string,
                                           entityDisplay : string,
                                           hints : DisambiguationHints) : Promise<EntityRecord[]> {
        // HACK this should be made generic with some new Genie annotation
        if (entityType === 'org.freedesktop:app_id') {
            const appLauncher = this._platform.getCapability('app-launcher');
            if (appLauncher)
                return appLauncher.listApps();
        }

        const { data: tpCandidates, meta } = await this._tpClient.lookupEntity(entityType, entityDisplay);
        if (tpCandidates.length > 0)
            return tpCandidates;

        let statement;
        try {
            const kind = entityType.split(":")[0];
            const query = entityType.split(":")[1];
            statement = await this._constructEntityQuery(kind, query, entityDisplay);
        } catch(e) {
            // ignore an error here (it indicates the query is not an ID query)
        }

        let candidates = tpCandidates;
        if (statement) {
            await this.prepareStatementForExecution(dlg, statement, hints);
            const [results,] = await this.execute(dlg, new Ast.Program(null, [], [], [statement]), undefined);
            candidates = [];
            for (const item of results.results!.results) {
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
            dlg.say(this._("Sorry, I cannot find any ${entity_type} matching “${name}”."), {
                entity_type: meta.name,
                name: entityDisplay
            });
            throw new CancellationError();
        }
        return candidates;
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

    protected async lookupLocation(dlg : DialogueInterface, searchKey : string, previousLocations : Ast.AbsoluteLocation[]) : Promise<Ast.LocationValue> {
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
            dlg.say(this._("Sorry, I cannot find any location matching “${location}”."), {
                location: searchKey,
            });
            throw new CancellationError();
        }

        return new Ast.Value.Location(mapped[0]);
    }

    private _tryGetStoredVariable(dlg : DialogueInterface, type : Type, variable : string) : Ast.Value|null {
        if (dlg.anonymous)
            return null;

        const sharedPrefs = this._platform.getSharedPreferences();

        const value = sharedPrefs.get('context-' + variable);
        if (value === undefined)
            return null;
        return Ast.Value.fromJSON(type, value);
    }

    private async _resolvePhoneNumber(dlg : DialogueInterface) : Promise<Ast.Value> {
        // if we received the command over SMS, that's our phone number, immediately
        const from = dlg.command?.platformData.from;
        if (from && from.startsWith('phone:'))
            return new Ast.Value.Entity(from.substring('phone:'.length), 'tt:phone_number', null);

        if (!dlg.anonymous) {
            const profile = this._platform.getProfile();
            if (profile.phone) {
                // TODO phone verification???
                assert(profile.phone_verified);
                return new Ast.Value.Entity(profile.phone, 'tt:phone_number', null);
            }
        }

        const phone = await dlg.ask(this._("What is your phone number?"), {}, 'sys_ask_phone_number', [], new Type.Entity('tt:phone_number'));
        if (dlg.anonymous) {
            return phone;
        } else {
            if (!await this._platform.setProfile({ phone: String(phone.toJS()) }))
                return phone;

            const profile = this._platform.getProfile();
            assert(profile.phone_verified);
            return phone;
        }
    }

    private async _resolveEmailAddress(dlg : DialogueInterface) : Promise<Ast.Value> {
        // if we received the command over email, that's our email address, immediately
        const from = dlg.command?.platformData.from;
        if (from && from.startsWith('email:'))
            return new Ast.Value.Entity(from.substring('email:'.length), 'tt:email_address', null);

        if (!dlg.anonymous) {
            const profile = this._platform.getProfile();
            if (profile.email) {
                if (!profile.email_verified)
                    dlg.say(this._("You must verify your email address by clicking the verification link before you can use it to receive notifications."));
                return new Ast.Value.Entity(profile.email, 'tt:email_address', null);
            }
        }

        const email = await dlg.ask(this._("What is your email address?"), {}, 'sys_ask_email_address', [], new Type.Entity('tt:phone_number'));
        if (dlg.anonymous) {
            return email;
        } else {
            if (!await this._platform.setProfile({ email: String(email.toJS()) }))
                return email;

            const profile = this._platform.getProfile();
            if (!profile.email_verified)
                dlg.say(this._("Thank you! Please verify your email address by clicking the verification link before continuing."));

            return email;
        }
    }

    protected async resolveUserContext(dlg : DialogueInterface, variable : UserContextVariable) : Promise<Ast.Value> {
        switch (variable) {
        case '$self.phone_number':
            return this._resolvePhoneNumber(dlg);
        case '$self.email_address':
            return this._resolveEmailAddress(dlg);
        }

        let value : Ast.Value|null = null;
        switch (variable) {
            case '$location.current_location': {
                const location = await this._tryGetCurrentLocation();
                if (location)
                    value = new Ast.Value.Location(location);
                else
                    value = this._tryGetStoredVariable(dlg, Type.Location, variable);
                break;
            }
            case '$location.home':
            case '$location.work':
                value = this._tryGetStoredVariable(dlg, Type.Location, variable);
                break;
            case '$time.morning':
            case '$time.evening':
                value = this._tryGetStoredVariable(dlg, Type.Time, variable);
                break;
            default:
                throw new TypeError('Invalid variable ' + variable);
        }
        if (value !== null)
            return value;

        let question, act, actParam, type;
        switch (variable) {
        case '$location.current_location':
            question = this._("Where are you now?");
            act = 'sys_resolve_location';
            actParam = 'current_location';
            type = Type.Location;
            break;
        case '$location.home':
            question = this._("What is your home address?");
            act = 'sys_resolve_location';
            actParam = 'home';
            type = Type.Location;
            break;
        case '$location.work':
            question = this._("What is your work address?");
            act = 'sys_resolve_location';
            actParam = 'work';
            type = Type.Location;
            break;
        case '$time.morning':
            question = this._("What time does your morning begin?");
            act = 'sys_resolve_time';
            actParam = 'morning';
            type = Type.Time;
            break;
        case '$time.evening':
            question = this._("What time does your evening begin?");
            act = 'sys_resolve_time';
            actParam = 'evening';
            type = Type.Time;
            break;
        }

        let answer = await dlg.ask(question, {}, act, [actParam], type);
        if (type === Type.Location) {
            assert(answer instanceof Ast.LocationValue);

            if (answer.value instanceof Ast.RelativeLocation) {
                assert(answer.value.relativeTag === 'current_location' || answer.value.relativeTag === 'home' || answer.value.relativeTag === 'work');
                answer = await this.resolveUserContext(dlg, `$location.${answer.value.relativeTag}` as UserContextVariable);
            } else if (answer.value instanceof Ast.UnresolvedLocation) {
                answer = await this.lookupLocation(dlg, answer.value.name, []);
            }
        }

        if (!dlg.anonymous) {
            const sharedPrefs = this._platform.getSharedPreferences();
            sharedPrefs.set('context-' + variable, answer.toJS());
        }
        return answer;
    }

    getPreferredUnit(type : string) : string|undefined {
        const pref = this._platform.getSharedPreferences();
        return pref.get('preferred-' + type) as string|undefined;
    }

    async configureNotifications(dlg : DialogueInterface) {
        if (!dlg.anonymous) {
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
        const from = dlg.command?.platformData.from;
        if (from) {
            if (from.startsWith('email:'))
                backend = available.find((b) => b.uniqueId === 'email');
            else if (from.startsWith('phone:'))
                backend = available.find((b) => b.uniqueId === 'twilio');
        }
        if (!backend) {
            let chosen;
            if (available.length > 1) {
                const choices = available.map((c) => c.name);
                chosen = await dlg.askChoices(this._("How would you like to be notified?"), {}, 'sys_configure_notifications', choices);
            } else {
                chosen = 0;
            }
            backend = available[chosen];
        }

        const settings = backend.requiredSettings;
        const config : Record<string, string> = {};
        // ensure that all settings needed by the notification backend are set
        for (const key in settings) {
            const variable = settings[key] as UserContextVariable;
            config[key] = String((await this.resolveUserContext(dlg, variable)).toJS());
        }

        // if we get here, the user has given meaningful answers to our questions
        // in anonymous mode, we make up a transient notification config that we'll
        // use just for this program
        //
        // in non-anonymous mode, we save the choice the notification backend
        // other info has been saved to the profile already

        if (dlg.anonymous) {
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
