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
import * as ThingTalk from 'thingtalk';
import * as Tp from 'thingpedia';

import * as I18n from '../i18n';

import DeviceDatabase from './devices/database';
import TierManager from './tiers/tier_manager';
import PairedEngineManager from './tiers/paired';
import Builtins from './devices/builtins';
import AudioController from './audio_controller';

import AppDatabase from './apps/database';
import AppRunner from './apps/runner';
import type AppExecutor from './apps/app_executor';

import AssistantDispatcher from '../dialogue-agent/dispatcher';
import TextFormatter, { FormattedChunk } from '../dialogue-agent/card-output/text-formatter';

import * as Config from '../config';

import * as sqlite from './db/sqlite';

/**
 * Information about a running ThingTalk program (app).
 */
export interface AppInfo {
    /**
     * The unique ID of the app.
     */
    uniqueId : string;
    /**
     * A short string identifying the app.
     */
    name : string;
    /**
     * A longer description of the code in the app.
     */
    description : string;
    code : string;
    /**
     * The icon associated with the app (as a Thingpedia class ID).
     */
    icon : string|null;
    /**
     * Whether the app is currently running (executing ThingTalk code).
     */
    isRunning : boolean;
    /**
     * Whether the app is set to run in the background.
     */
    isEnabled : boolean;
    /**
     * The last error reported by the app.
     */
    error : string|null;
}

/**
 * Information about a configured Thingpedia device.
 */
export interface DeviceInfo {
    /**
     * The unique ID of the device.
     */
    uniqueId : string;
    /**
     * A short, human-readable string identifying the device.
     */
    name : string;
    /**
     * A longer string describing the device.
     */
    description : string;
    /**
     * The Thingpedia class ID this device belongs to (suitable to select an icon).
     */
    kind : string;
    /**
     * The version of the class this device belongs to.
     */
    version : number;
    /**
     * The coarse categorization of the device: `physical`, `online`, `data`, or `system`.
     */
    class : 'physical' | 'online' | 'data' | 'system';
    /**
     * The ID of the engine that configured this device (for purposes of cloud sync).
     */
    ownerTier : string;
    /**
     * `true` if this device was created on the fly by some discovery module, `false`
     * if it was configured manually and is stored on disk.
     */
    isTransient : boolean;
}

interface EngineModule {
    start() : Promise<void>;
    stop() : Promise<void>;
}

interface DeviceState {
    kind : string;
    accessToken ?: string;
    refreshToken ?: string;
    [key : string] : unknown;
}

interface AssistantEngineOptions {
    cloudSyncUrl ?: string;
    nluModelUrl ?: string;
    thingpediaUrl ?: string;
}

interface CreateAppOptions {
    uniqueId ?: string;
    name ?: string;
    description ?: string;
    icon ?: string;
    conversation ?: string;
}

interface AppResult {
    raw : Record<string, unknown>;
    type : string;
    formatted : FormattedChunk[];
}

/**
 * The core Genie engine.
 *
 * There is one engine instance per user. Multiple engine instances
 * can run in the same process, but they must be associated with
 * different platform objects.
 *
 */
export default class AssistantEngine extends Tp.BaseEngine {
    readonly _ : (x : string) => string;

    // should be private, but it is accessed from @org.thingpedia.builtin.thingengine
    _tiers : TierManager;
    private _modules : EngineModule[];

    private _devices : DeviceDatabase;
    private _appdb : AppDatabase;
    private _assistant : AssistantDispatcher;
    private _audio : AudioController|null;

    private _running : boolean;
    private _stopCallback : (() => void)|null;

    /**
     * Construct a new engine.
     *
     * @param {external:thingpedia.BasePlatform} platform - the platform associated with this engine
     * @param {Object} options - additional options; this is also passed to the parent class
     * @param {string} [options.cloudSyncUrl] - URL to use for cloud sync
     */
    constructor(platform : Tp.BasePlatform, options : AssistantEngineOptions = {}) {
        super(platform, options);

        this._ = I18n.get(platform.locale).gettext;

        this._tiers = new TierManager(platform, options.cloudSyncUrl || Config.THINGENGINE_URL);

        this._modules = [];

        const deviceFactory = new Tp.DeviceFactory(this, this._thingpedia, Builtins);
        this._devices = new DeviceDatabase(platform, this._tiers,
                                           deviceFactory, this._schemas);
        this._tiers.devices = this._devices;

        this._appdb = new AppDatabase(this);

        this._assistant = new AssistantDispatcher(this, options.nluModelUrl);

        if (platform.hasCapability('sound'))
            this._audio = new AudioController(this._devices);
        else
            this._audio = null;

        // in loading order
        this._modules = [this._tiers,
                         this._devices,
                         new PairedEngineManager(platform, this._devices, deviceFactory, this._tiers),
                         this._appdb];
        if (this._audio)
            this._modules.push(this._audio);
        this._modules.push(this._assistant,
                           new AppRunner(this._appdb));

        this._running = false;
        this._stopCallback = null;
    }

    /**
     * Return a unique identifier associated with this engine.
     *
     * This is a string composed of two parts: the high-level tier type
     * (phone, cloud, server, desktop), and a unique identifier. The tier
     * is used by the cloud sync subsystem, and can be used by devices
     * that use local communication to distinguish which engine configured them.
     */
    get ownTier() : string {
        return this._tiers.ownAddress;
    }

    /**
     * Access the device database of this engine.
     */
    get devices() {
        return this._devices;
    }

    /**
     * Access the app database of this engine.
     */
    get apps() {
        return this._appdb;
    }

    /**
     * Access the assistant dispatcher of this engine.
     */
    get assistant() {
        return this._assistant;
    }

    /**
     * Access the audio controller to coordinate access to audio.
     */
    get audio() {
        return this._audio;
    }

    private async _openSequential(modules : EngineModule[]) {
        for (let i = 0; i < modules.length; i++) {
            //console.log('Starting ' + modules[i].constructor.name);
            await modules[i].start();
        }
    }

    private async _closeSequential(modules : EngineModule[]) {
        for (let i = 0; i < modules.length; i++) {
            //console.log('Stopping ' + modules[i].constructor.name);
            await modules[i].stop();
        }
    }

    /**
     * Initialize this engine.
     *
     * This will initialize all modules sequentially in the right
     * order. It must be called before {@link run}.
     */
    open() : Promise<void> {
        return sqlite.ensureSchema(this.platform).then(() => {
            return this._openSequential(this._modules);
        }).then(() => {
            console.log('Engine started');
        });
    }

    /**
     * Deinitialize this engine.
     *
     * This will sequentially close all modules, save the database
     * and release all resources.
     *
     * This should not be called if {@link start} fails. After
     * this method succeed, the engine is in undefined state and must
     * not be used.
     */
    close() : Promise<void> {
        return this._closeSequential(this._modules).then(() => {
            console.log('Engine closed');
        });
    }

    /**
     * Run ThingTalk rules.
     *
     * Kick start the engine by returning a promise that will
     * run each rule in sequence, forever, without ever being
     * fulfilled until {@link stop} is called.
     */
    run() : Promise<void> {
        console.log('Engine running');

        this._running = true;

        return new Promise((callback, errback) => {
            if (!this._running) {
                callback();
                return;
            }
            this._stopCallback = callback;
        });
    }

    /**
     * Stop any rule execution at the next available moment.
     *
     * This will cause the {@link run} promise to be fulfilled.
     *
     * This method can be called multiple times and is idempotent.
     * It can also be called before {@link run}.
     */
    stop() : void {
        console.log('Engine stopped');
        this._running = false;
        if (this._stopCallback)
            this._stopCallback();
    }

    /**
     * Begin configuring a device with an OAuth-like flow.
     *
     * @param {string} kind - the Thingpedia class ID of the device to configure.
     * @return {Array} a tuple with the redirect URL and the session object.
     */
    startOAuth(kind : string) : Promise<[string, Record<string, string>]> {
        return this._devices.addFromOAuth(kind);
    }
    /**
     * Complete OAuth-like configuration for a device.
     *
     * @param {string} kind - the Thingpedia class ID of the device to configure.
     * @param {string} redirectUri - the OAuth redirect URI that was called at the end of the OAuth flow.
     * @param {Object.<string,string>} session - an object with session information.
     * @return {external:thingpedia.BaseDevice} the configured device
     */
    completeOAuth(kind : string,
                  redirectUri : string,
                  session : Record<string, string>) : Promise<Tp.BaseDevice> {
        return this._devices.completeOAuth(kind, redirectUri, session);
    }

    /**
     * Configure a simple device with no configuration information needed.
     *
     * @param {string} kind - the Thingpedia class ID of the device to configure.
     * @return {external:thingpedia.BaseDevice} the configured device
     */
    createSimpleDevice(kind : string) : Promise<Tp.BaseDevice> {
        return this._devices.addSerialized({ kind });
    }
    /**
     * Configure a device with direct configuration information.
     *
     * @param {Object} state - the configured device parameters.
     * @param {string} state.kind - the Thingpedia class ID of the device to configure.
     * @return {external:thingpedia.BaseDevice} the configured device
     */
    createDevice(state : DeviceState) : Promise<Tp.BaseDevice> {
        return this._devices.addSerialized(state);
    }
    /**
     * Delete a device by ID.
     *
     * Deleting a device removes any stored credentials and configuration about that device.
     *
     * @param {string} uniqueId - the ID of the device to delete
     * @return {boolean} true if the device was deleted successfully, false if it did not exist
     */
    async deleteDevice(uniqueId : string) : Promise<boolean> {
        const device = this._devices.getDevice(uniqueId);
        if (device === undefined)
            return false;

        await this._devices.removeDevice(device);
        return true;
    }
    /**
     * Update all devices of the given type to the latest version in Thingpedia.
     *
     * @param {string} kind - the Thingpedia class ID of the devices to update
     */
    async upgradeDevice(kind : string) : Promise<void> {
        await this._devices.updateDevicesOfKind(kind);
    }
    /**
     * Returns the list of all device classes that have been previously cached.
     */
    getCachedDeviceClasses() : Promise<any[]> {
        return this._devices.getCachedDeviceClasses();
    }
    /**
     * Returns whether a specific device has been configured or not.
     *
     * @param {string} uniqueId - the device ID to check
     * @return {boolean} true if the device exists, false otherwise
     */
    hasDevice(uniqueId : string) : boolean {
        return this._devices.hasDevice(uniqueId);
    }

    private _toDeviceInfo(d : Tp.BaseDevice) : DeviceInfo {
        let deviceKlass : 'physical' | 'online' | 'data' | 'system' = 'physical';
        if (d.hasKind('data-source'))
            deviceKlass = 'data';
        else if (d.hasKind('online-account'))
            deviceKlass = 'online';
        else if (d.hasKind('thingengine-system'))
            deviceKlass = 'system';

        return {
            uniqueId: d.uniqueId!,
            name: d.name || this._("Unknown device"),
            description: d.description || this._("Description not available"),
            kind: d.kind,
            version: (d.constructor as typeof Tp.BaseDevice).metadata.version || 0,
            class: deviceKlass,
            ownerTier: d.ownerTier,
            isTransient: d.isTransient
        };
    }

    /**
     * Get information about all configured devices.
     *
     * @param {string} [kind] - filter only devices that have the specified kind
     * @return {Array<DeviceInfo>} a list of device info objects, one per device
     */
    getDeviceInfos(kind : string) : DeviceInfo[] {
        const devices = this._devices.getAllDevices(kind);
        return devices.map((d) => this._toDeviceInfo(d));
    }
    /**
     * Get information about one configured device by ID.
     *
     * @param {string} uniqueId - the ID of the device to return info for
     * @return information about that device
     */
    getDeviceInfo(uniqueId : string) : DeviceInfo {
        const d = this._devices.getDevice(uniqueId);
        if (d === undefined)
            throw new Error('Invalid device ' + uniqueId);
        return this._toDeviceInfo(d);
    }

    /**
     * Asynchronously check whether a device is available.
     *
     * @param {string} uniqueId - the ID of the device to check
     * @return {external:thingpedia.Availability} whether the device is available
     */
    async checkDeviceAvailable(uniqueId : string) : Promise<Tp.Availability> {
        const d = this._devices.getDevice(uniqueId);
        if (d === undefined)
            return -1;

        return d.checkAvailable();
    }

    private _toAppInfo(a : AppExecutor) : AppInfo {
        return {
            uniqueId: a.uniqueId!,
            name: a.name,
            description: a.description,
            code: a.program.prettyprint(),
            icon: a.icon || null,
            isRunning: a.isRunning,
            isEnabled: a.isEnabled,
            error: a.error
        };
    }

    /**
     * Get information about all running ThingTalk programs (apps).
     *
     * @return {Array<AppInfo>} a list of app info objects, one per app
     */
    getAppInfos() : AppInfo[] {
        const apps = this._appdb.getAllApps();
        return apps.map((a) => this._toAppInfo(a));
    }
    /**
     * Get information about one running ThingTalk program (app) by ID.
     *
     * @param {string} uniqueId - the ID of the app to return info for
     * @param {boolean} [throw_=true] - throw an error if there is no such app
     * @return {AppInfo} information about that app
     */
    getAppInfo(uniqueId : string, throw_ ?: true) : AppInfo;
    getAppInfo(uniqueId : string, throw_ : boolean) : AppInfo|undefined;
    getAppInfo(uniqueId : string, throw_ = true) {
        const app = this._appdb.getApp(uniqueId);
        if (app === undefined) {
            if (throw_)
                throw new Error('Invalid app ' + uniqueId);
            else
                return undefined;
        }
        return this._toAppInfo(app);
    }

    /**
     * Stop (delete) the ThingTalk program (app) with the given ID.
     *
     * @param {string} uniqueId - the ID of the app to delete
     * @return {boolean} true if the deletion occurred, false otherwise
     */
    async deleteApp(uniqueId : string) : Promise<boolean> {
        const app = this._appdb.getApp(uniqueId);
        if (app === undefined)
            return false;

        await this._appdb.removeApp(app);
        return true;
    }

    /**
     * Create a new ThingTalk app.
     *
     * This is the main entry point to execute ThingTalk code.
     *
     * @param {string|external:thingtalk.Ast.Program} program - the ThingTalk code to execute,
     *        or the parsed ThingTalk program (AST)
     * @param {Object} options
     * @param {string} [options.uniqueId] - the ID to assign to the new app
     * @param {string} [options.name] - the name of the new app
     * @param {string} [options.description] - the human-readable description of the code
     *        being executed
     * @param {string} [options.icon] - the icon of the new app (as a Thingpedia class ID)
     * @param {string} [options.conversation] - the ID of the conversation associated with the new app
     * @return {AppExecutor} the newly created program
     */
    async createApp(programOrString : ThingTalk.Ast.Program|string, options ?: CreateAppOptions) : Promise<AppExecutor> {
        let program : ThingTalk.Ast.Program;
        if (typeof programOrString === 'string') {
            const parsed = await ThingTalk.Syntax.parse(programOrString).typecheck(this.schemas, true);
            assert(parsed instanceof ThingTalk.Ast.Program);
            program = parsed;
        } else {
            program = programOrString;
        }
        return this._appdb.createApp(program, options);
    }

    /**
     * Create a new ThingTalk app, and execute it to compute all results.
     *
     * This is a convenience wrapper over {@link createApp} that also
     * iterates the results of the app and formats them.
     *
     * @param {string|external:thingtalk.Ast.Program} program - the ThingTalk code to execute,
     *        or the parsed ThingTalk program (AST)
     * @param {Object} options
     * @param {string} [options.uniqueId] - the ID to assign to the new app
     * @param {string} [options.name] - the name of the new app
     * @param {string} [options.description] - the human-readable description of the code
     *        being executed
     * @param {string} [options.icon] - the icon of the new app (as a Thingpedia class ID)
     * @param {string} [options.conversation] - the ID of the conversation associated with the new app
     */
    async createAppAndReturnResults(programOrString : ThingTalk.Ast.Program|string, options ?: CreateAppOptions) {
        const app = await this.createApp(programOrString, options);
        const results : AppResult[] = [];
        const errors : Error[] = [];

        const formatter = new TextFormatter(this._platform.locale, this._platform.timezone, this._schemas);
        for await (const value of app.mainOutput) {
            if (value instanceof Error) {
                errors.push(value);
            } else {
                const messages = await formatter.formatForType(value.outputType, value.outputValue, 'messages');
                results.push({ raw: value.outputValue, type: value.outputType, formatted: messages });
            }
        }

        return {
            uniqueId: app.uniqueId!,
            description: app.description,
            code: app.program.prettyprint(),
            icon: app.icon,
            results, errors
        };
    }

    /**
     * Configure cloud synchronization.
     *
     * This method can be called in non-cloud Almond to start synchronization
     * with the cloud.
     *
     * @param {string} cloudId - the ID of the user in Web Almond
     * @param {string} authToken - the access token
     */
    async setCloudId(cloudId : string, authToken : string) : Promise<boolean> {
        if (!this._platform.setAuthToken(authToken))
            return false;

        this._platform.getSharedPreferences().set('cloud-id', cloudId);
        this._tiers.addCloudConfig();
        await this._tiers.tryConnect('cloud');
        return true;
    }

    /**
     * Configure synchronization with a local server.
     *
     * This method can be called in a phone or desktop Almond to synchronize
     * with a locally-setup home server Almond .
     *
     * @param {string} serverHost - the IP address or hostname of the server to connect to
     * @param {number} serverPort - the port at which server is reachable
     * @param {string} authToken - the access token
     */
    async addServerAddress(serverHost : string, serverPort : number, authToken : string) : Promise<boolean> {
        if (authToken !== null) {
            if (!this._platform.setAuthToken(authToken))
                return false;
        }

        this._devices.addSerialized({
            kind: 'org.thingpedia.builtin.thingengine',
            tier: 'server',
            host: serverHost,
            port: serverPort,
            own: true });
        return true;
    }
}
