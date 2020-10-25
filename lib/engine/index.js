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


import * as ThingTalk from 'thingtalk';
import * as Tp from 'thingpedia';

import DeviceDatabase from './devices/database';
import TierManager from './tiers/tier_manager';
import PairedEngineManager from './tiers/paired';
import Builtins from './devices/builtins';

import AppDatabase from './apps/database';
import AppRunner from './apps/runner';

import AssistantDispatcher from '../dialogue-agent/dispatcher';

import Config from './config';

import * as sqlite from './db/sqlite';

const DEFAULT_GETTEXT = {
    dgettext: (domain, msg) => msg,
    dngettext: (domain, msg, msgp, n) => (n === 1 ? msg : msgp),
    dpgettext: (domain, ctx, msg) => msg,
};

/**
 * The Thingpedia SDK.
 * @external thingpedia
 * @see https://almond.stanford.edu/doc/jsdoc/thingpedia/
 */
/**
 * The ThingTalk library.
 * @external thingtalk
 * @see https://almond.stanford.edu/doc/jsdoc/thingtalk/
 */

/**
 * Information about a running ThingTalk program (app).
 * @typedef {Object} AppInfo
 * @property {string} uniqueId - the unique ID of the app
 * @property {string} name - a short string identifying the app
 * @property {string} description - a longer description of the code in the app
 * @property {string|null} icon - the icon associated with the app (as a Thingpedia class ID)
 * @property {boolean} isRunning - whether the app is currently running (executing ThingTalk code)
 * @property {boolean} isEnabled - whether the app is set to run in the background
 * @property {string|null} error - the last error reported by the app
 */

/**
 * Information about a configured Thingpedia device.
 * @typedef {Object} DeviceInfo
 * @property {string} uniqueId - the unique ID of the device
 * @property {string} name - a short, human-readable string identifying the device
 * @property {string} description - a longer string describing the device
 * @property {string} kind - the Thingpedia class ID this device belongs to (suitable to select an icon)
 * @property {number} version - the version of the class this device belongs to
 * @property {string} class - the coarse categorization of the device: `physical`, `online`, `data`, or `system`
 * @property {string} ownerTier - the ID of the engine that configured this device (for purposes of cloud sync)
 * @property {boolean} isTransient - true if this device was created on the fly by some discovery module, false
 *           if it was configured manually and is stored on disk
 */

/**
 * The core Genie engine.
 *
 * There is one engine instance per user. Multiple engine instances
 * can run in the same process, but they must be associated with
 * different platform objects.
 *
 * @extends external:thingpedia.BaseEngine
 */
export default class AssistantEngine extends Tp.BaseEngine {
    /**
     * Construct a new engine.
     *
     * @param {external:thingpedia.BasePlatform} platform - the platform associated with this engine
     * @param {Object} options - additional options; this is also passed to the parent class
     * @param {string} [options.cloudSyncUrl] - URL to use for cloud sync
     */
    constructor(platform, options = {}) {
        super(platform, options);
        // constructor

        this._initGettext();

        // tiers and devices are always enabled
        this._tiers = new TierManager(platform, options.cloudSyncUrl || Config.THINGENGINE_URL);

        this._modules = [];

        let deviceFactory = new Tp.DeviceFactory(this, this._thingpedia, Builtins);
        this._devices = new DeviceDatabase(platform, this._tiers,
                                           deviceFactory, this._schemas);
        this._tiers.devices = this._devices;

        this._appdb = new AppDatabase(this);

        this._assistant = new AssistantDispatcher(this, options.nluModelUrl);

        // in loading order
        this._modules = [this._tiers,
                         this._devices,
                         new PairedEngineManager(platform, this._devices, deviceFactory, this._tiers),
                         this._appdb,
                         this._assistant,
                         new AppRunner(this._appdb)];

        this._running = false;
        this._stopCallback = null;
        this._fatalCallback = null;
    }

    /**
     * Return a unique identifier associated with this engine.
     *
     * This is a string composed of two parts: the high-level tier type
     * (phone, cloud, server, desktop), and a unique identifier. The tier
     * is used by the cloud sync subsystem, and can be used by devices
     * that use local communication to distinguish which engine configured them.
     *
     * @type {string}
     */
    get ownTier() {
        return this._tiers.ownAddress;
    }

    /**
     * Access the device database of this engine.
     * @type {DeviceDatabase}
     */
    get devices() {
        return this._devices;
    }

    /**
     * Access the app database of this engine.
     * @type {AppDatabase}
     */
    get apps() {
        return this._appdb;
    }

    /**
     * Access the assistant dispatcher of this engine.
     * @type {AssistantDispatcher}
     */
    get assistant() {
        return this._assistant;
    }

    _initGettext() {
        let gettext = this.platform.getCapability('gettext');
        if (!gettext)
            gettext = DEFAULT_GETTEXT;
        this.gettext = function(string) {
            return gettext.dgettext('genie-toolkit', string);
        };
        this.ngettext = function(msg, msgplural, count) {
            return gettext.dngettext('genie-toolkit', msg, msgplural, count);
        };
        this.pgettext = function(msgctx, msg) {
            return gettext.dpgettext('genie-toolkit', msgctx, msg);
        };
        this._ = this.gettext;
    }

    _openSequential(modules) {
        function open(i) {
            if (i === modules.length)
                return Promise.resolve();

            //console.log('Starting ' + modules[i].constructor.name);
            return modules[i].start().then(() => open(i+1));
        }

        return open(0);
    }

    _closeSequential(modules) {
        function close(i) {
            if (i < 0)
                return Promise.resolve();

            //console.log('Stopping ' + modules[i].constructor.name);
            return modules[i].stop().then(() => close(i-1));
        }

        return close(modules.length-1);
    }

    /**
     * Initialize this engine.
     *
     * This will initialize all modules sequentially in the right
     * order. It must be called before {@link Engine#run}.
     *
     * @async
     */
    open() {
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
     * This should not be called if {@link Engine#start} fails. After
     * this method succeed, the engine is in undefined state and must
     * not be used.
     *
     * @async
     */
    close() {
        return this._closeSequential(this._modules).then(() => {
            console.log('Engine closed');
        });
    }

    /**
     * Run ThingTalk rules.
     *
     * Kick start the engine by returning a promise that will
     * run each rule in sequence, forever, without ever being
     * fulfilled until {@link Engine#stop} is called.
     *
     * @async
     */
    run() {
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
     * This will cause the {@link Engine#run} promise to be fulfilled.
     *
     * This method can be called multiple times and is idempotent.
     * It can also be called before {@link Engine#run}.
     */
    stop() {
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
     * @async
     */
    startOAuth(kind) {
        return this._devices.addFromOAuth(kind);
    }
    /**
     * Complete OAuth-like configuration for a device.
     *
     * @param {string} kind - the Thingpedia class ID of the device to configure.
     * @param {string} redirectUri - the OAuth redirect URI that was called at the end of the OAuth flow.
     * @param {Object.<string,string>} session - an object with session information.
     * @return {external:thingpedia.BaseDevice} the configured device
     * @async
     */
    completeOAuth(kind, redirectUri, session) {
        return this._devices.completeOAuth(kind, redirectUri, session);
    }

    /**
     * Configure a simple device with no configuration information needed.
     *
     * @param {string} kind - the Thingpedia class ID of the device to configure.
     * @return {external:thingpedia.BaseDevice} the configured device
     * @async
     */
    createSimpleDevice(kind) {
        return this._devices.addSerialized({ kind });
    }
    /**
     * Configure a device with direct configuration information.
     *
     * @param {Object} state - the configured device parameters.
     * @param {string} state.kind - the Thingpedia class ID of the device to configure.
     * @return {external:thingpedia.BaseDevice} the configured device
     * @async
     */
    createDevice(state) {
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
    async deleteDevice(uniqueId) {
        let device = this._devices.getDevice(uniqueId);
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
    upgradeDevice(kind) {
        return this._devices.updateDevicesOfKind(kind);
    }
    /**
     * Returns the list of all device classes that have been previously cached.
     *
     * @async
     */
    getCachedDeviceClasses() {
        return this._devices.getCachedDeviceClasses();
    }
    /**
     * Returns whether a specific device has been configured or not.
     *
     * @param {string} uniqueId - the device ID to check
     * @return {boolean} true if the device exists, false otherwise
     */
    hasDevice(uniqueId) {
        return this._devices.hasDevice(uniqueId);
    }

    _toDeviceInfo(d) {
        let deviceKlass = 'physical';
        if (d.hasKind('data-source'))
            deviceKlass = 'data';
        else if (d.hasKind('online-account'))
            deviceKlass = 'online';
        else if (d.hasKind('thingengine-system'))
            deviceKlass = 'system';

        return {
            uniqueId: d.uniqueId,
            name: d.name || this._("Unknown device"),
            description: d.description || this._("Description not available"),
            kind: d.kind,
            version: d.constructor.metadata.version || 0,
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
    getDeviceInfos(kind) {
        const devices = this._devices.getAllDevices(kind);
        return devices.map((d) => this._toDeviceInfo(d));
    }
    /**
     * Get information about one configured device by ID.
     *
     * @param {string} uniqueId - the ID of the device to return info for
     * @return {DeviceInfo|undefined} information about that device, or `undefined` if it
     *                                does not exist
     */
    getDeviceInfo(uniqueId) {
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
     * @async
     */
    async checkDeviceAvailable(uniqueId) {
        const d = this._devices.getDevice(uniqueId);
        if (d === undefined)
            return -1;

        return d.checkAvailable();
    }

    _toAppInfo(a) {
        return {
            uniqueId: a.uniqueId,
            name: a.name,
            description: a.description,
            code: a.code,
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
    getAppInfos() {
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
    getAppInfo(uniqueId, throw_ = true) {
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
    async deleteApp(uniqueId) {
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
    async createApp(program, options) {
        if (typeof program === 'string')
            program = await ThingTalk.Grammar.parseAndTypecheck(program, this.schemas, true);
        return this._appdb.createApp(program, options);
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
    async setCloudId(cloudId, authToken) {
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
    async addServerAddress(serverHost, serverPort, authToken) {
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
