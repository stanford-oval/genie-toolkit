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


// cmdline platform

import * as Tp from 'thingpedia';

import * as stream from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as child_process from 'child_process';
import * as util from 'util';
import Gettext from 'node-gettext';

const _unzipApi : Tp.Capabilities.UnzipApi = {
    unzip(zipPath : string, dir : string) {
        const args = ['-uo', zipPath, '-d', dir];
        return util.promisify(child_process.execFile)('/usr/bin/unzip', args, {
            maxBuffer: 10 * 1024 * 1024 }).then(({ stdout, stderr }) => {
            console.log('stdout', stdout);
            console.log('stderr', stderr);
        });
    }
};

interface ContentTypeStream extends stream.Readable {
    contentType ?: string;
}

const _contentApi = {
    getStream(url : string) : Promise<ContentTypeStream> {
        return new Promise((resolve, reject) => {
            if (url.startsWith('file:///')) {
                const path = url.substring('file://'.length);
                child_process.execFile('xdg-mime', ['query', 'filetype', path], (err, stdout, stderr) => {
                    const stream : ContentTypeStream = fs.createReadStream(path);
                    if (err) {
                        // ignore error if we failed to query the content type (e.g. if xdg-mime is not installed)
                        stream.contentType = 'application/octet-stream';
                    } else {
                        stream.contentType = String(stdout).trim();
                    }
                    resolve(stream);
                });
            } else {
                reject(new Error('Unsupported url ' + url));
            }
        });
    }
};

function safeMkdirSync(dir : string) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

export default class Platform extends Tp.BasePlatform {
    private _locale : string;
    private _gettext : Gettext;
    private _timezone : string;

    private _filesDir : string;
    private _cacheDir : string;

    private _prefs : Tp.Helpers.FilePreferences;
    private _tpClient : Tp.HttpClient;

    // Initialize the platform code
    // Will be called before instantiating the engine
    constructor(homedir : string|undefined, locale : string, thingpediaUrl : string) {
        super();

        this._locale = locale;
        this._gettext = new Gettext();
        this._gettext.setLocale(this._locale);

        this._timezone = process.env.TZ || '';

        if (homedir) {
            this._filesDir = path.resolve(homedir);
            safeMkdirSync(this._filesDir);
            this._cacheDir = path.resolve(homedir, 'cache');
            safeMkdirSync(this._cacheDir);
        } else {
            this._filesDir = path.resolve(os.homedir(), '.config/genie-toolkit');
            safeMkdirSync(path.resolve(os.homedir(), '.config'));
            safeMkdirSync(this._filesDir);
            this._cacheDir = path.resolve(os.homedir(), '.cache/genie-toolkit');
            safeMkdirSync(path.resolve(os.homedir(), '.cache'));
            safeMkdirSync(this._cacheDir);
        }
        this._prefs = new Tp.Helpers.FilePreferences(this._filesDir + '/prefs.db');

        this._tpClient = new Tp.HttpClient(this, thingpediaUrl);
    }

    get type() {
        return 'cmdline';
    }

    get locale() {
        return this._locale;
    }

    get timezone() {
        return this._timezone;
    }

    getPlatformDevice() {
        return null;
    }

    // Check if we need to load and run the given thingengine-module on
    // this platform
    // (eg we don't need discovery on the cloud, and we don't need graphdb,
    // messaging or the apps on the phone client)
    hasFeature(feature : string) {
        return true;
    }

    // Check if this platform has the required capability
    // (eg. long running, big storage, reliable connectivity, server
    // connectivity, stable IP, local device discovery, bluetooth, etc.)
    //
    // Which capabilities are available affects which apps are allowed to run
    hasCapability(cap : string) : boolean {
        switch (cap) {
        case 'code-download':
        case 'thingpedia-client':
        case 'gettext':
        case 'content-api':
            return true;

        default:
            return false;
        }
    }

    // Retrieve an interface to an optional functionality provided by the
    // platform
    //
    // This will return null if hasCapability(cap) is false
    getCapability<T extends keyof Tp.Capabilities.CapabilityMap>(cap : T) : Tp.Capabilities.CapabilityMap[T]|null {
        switch (cap) {
        case 'code-download':
            return _unzipApi;
        case 'thingpedia-client':
            return this._tpClient;
        case 'gettext':
            return this._gettext;
        case 'content-api':
            return _contentApi;
        default:
            return null;
        }
    }

    // Obtain a shared preference store
    // Preferences are simple key/value store which is shared across all apps
    // but private to this instance (tier) of the platform
    // Preferences should be normally used only by the engine code, and a persistent
    // shared store such as DataVault should be used by regular apps
    getSharedPreferences() {
        return this._prefs;
    }

    // Get a directory that is guaranteed to be writable
    // (in the private data space for Android)
    getWritableDir() {
        return this._filesDir;
    }

    // Get a temporary directory
    // Also guaranteed to be writable, but not guaranteed
    // to persist across reboots or for long times
    // (ie, it could be periodically cleaned by the system)
    getTmpDir() {
        return os.tmpdir();
    }

    // Get a directory good for long term caching of code
    // and metadata
    getCacheDir() {
        return this._cacheDir;
    }

    // Get the filename of the sqlite database
    getSqliteDB() {
        return this._filesDir + '/sqlite.db';
    }

    getSqliteKey() {
        return null;
    }

    getGraphDB() {
        return this._filesDir + '/rdf.db';
    }

    // Get the Thingpedia developer key, if one is configured
    getDeveloperKey() {
        return (this._prefs.get('developer-key') || null) as string|null;
    }

    // Change the Thingpedia developer key, if possible
    // Returns true if the change actually happened
    setDeveloperKey(key : string|undefined) {
        return this._prefs.set('developer-key', key);
    }

    getOrigin() {
        // pretend to be a local thingpedia server
        // the user is expected to copy-paste oauth urls manually
        return 'http://127.0.0.1:8080';
    }

    getCloudId() {
        return (this._prefs.get('cloud-id') || null) as string|null;
    }

    getAuthToken() {
        return this._prefs.get('auth-token') as string|undefined;
    }

    // Change the auth token
    // Returns true if a change actually occurred, false if the change
    // was rejected
    setAuthToken(authToken : string) {
        const oldAuthToken = this._prefs.get('auth-token');
        if (oldAuthToken !== undefined && authToken !== oldAuthToken)
            return false;
        this._prefs.set('auth-token', authToken);
        return true;
    }
}
