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

// cmdline platform

const Tp = require('thingpedia');

const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');
const stream = require('stream');
const util = require('util');
const Gettext = require('node-gettext');
let PulseAudio;
try {
    PulseAudio = require('pulseaudio2');
} catch(e) {
    PulseAudio = null;
}
let snowboy;
try {
    snowboy = require('snowboy');
} catch(e) {
    snowboy = null;
}

const _unzipApi = {
    unzip(zipPath, dir) {
        var args = ['-uo', zipPath, '-d', dir];
        return util.promisify(child_process.execFile)('/usr/bin/unzip', args, {
            maxBuffer: 10 * 1024 * 1024 }).then(({ stdout, stderr }) => {
            console.log('stdout', stdout);
            console.log('stderr', stderr);
        });
    }
};

const _contentApi = {
    getStream(url) {
        return new Promise((resolve, reject) => {
            if (url.startsWith('file:///')) {
                const path = url.substring('file://'.length);
                child_process.execFile('xdg-mime', ['query', 'filetype', path], (err, stdout, stderr) => {
                    let stream = fs.createReadStream(path);
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

function safeMkdirSync(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

class SnowboyDetectorStream extends stream.Writable {
    constructor(modelPath) {
        super();

        let models = new snowboy.Models();
        const modelName = path.basename(modelPath);
        models.add({
             file: path.resolve(modelPath),
             sensitivity: '0.6',

             // remove '.pmdl' or '.umdl' extension
             hotwords: modelName.substring(0, modelName.length-5)
        });

        this._detector = new snowboy.Detector({
            resource: path.resolve(path.dirname(modelPath), 'common.res'),
            models: models,
            audioGain: 1.0,
            applyFrontend: true,
        });

        this._detector.on('silence', () => {
            this.emit('silence');
        });
        this._detector.on('sound', () => {
            this.emit('sound');
        });
        this._detector.on('hotword', (index, hotword, buffer) => {
            this.emit('wakeword', hotword);
        });
    }

    _write(chunk, encoding, callback) {
        this._detector.write(chunk, encoding, callback);
    }
}

module.exports = class Platform extends Tp.BasePlatform {
    // Initialize the platform code
    // Will be called before instantiating the engine
    constructor(homedir, locale, thingpediaUrl, snowboyPath) {
        super();

        this._locale = locale;
        this._gettext = new Gettext();
        this._gettext.setLocale(this._locale);


        this._timezone = process.env.TZ;

        this._filesDir = homedir;
        this._cacheDir = path.resolve(homedir, 'cache');
        safeMkdirSync(this._cacheDir);
        this._prefs = new Tp.Helpers.FilePreferences(this._filesDir + '/prefs.db');

        this._tpClient = new Tp.HttpClient(this, thingpediaUrl);

        if (PulseAudio) {
            this._pulse = new PulseAudio({
                client: "genie-toolkit"
            });
        } else {
            this._pulse = null;
        }

        if (snowboy && snowboyPath)
            this._wakeWordDetector = new SnowboyDetectorStream(snowboyPath);
        else
            this._wakeWordDetector = null;
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
    hasFeature(feature) {
        return true;
    }

    // Check if this platform has the required capability
    // (eg. long running, big storage, reliable connectivity, server
    // connectivity, stable IP, local device discovery, bluetooth, etc.)
    //
    // Which capabilities are available affects which apps are allowed to run
    hasCapability(cap) {
        switch(cap) {
        case 'code-download':
        case 'thingpedia-client':
        case 'gettext':
        case 'content-api':
            return true;

        case 'pulseaudio':
        case 'sound':
            return this._pulse !== null;

        case 'wake-word-detector':
            return this._wakeWordDetector !== null;

        default:
            return false;
        }
    }

    // Retrieve an interface to an optional functionality provided by the
    // platform
    //
    // This will return null if hasCapability(cap) is false
    getCapability(cap) {
        switch(cap) {
        case 'code-download':
            return _unzipApi;
        case 'thingpedia-client':
            return this._tpClient;
        case 'gettext':
            return this._gettext;
        case 'content-api':
            return _contentApi;
        case 'sound':
        case 'pulseaudio': // legacy name for "sound"
            return this._pulse;
        case 'wake-word-detector':
            return this._wakeWordDetector;
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
        return this._prefs.get('developer-key');
    }

    // Change the Thingpedia developer key, if possible
    // Returns true if the change actually happened
    setDeveloperKey(key) {
        return this._prefs.set('developer-key', key);
    }

    getOrigin() {
        // pretend to be a local thingpedia server
        // the user is expected to copy-paste oauth urls manually
        return 'http://127.0.0.1:8080';
    }

    getCloudId() {
        return this._prefs.get('cloud-id');
    }

    getAuthToken() {
        return this._prefs.get('auth-token');
    }

    // Change the auth token
    // Returns true if a change actually occurred, false if the change
    // was rejected
    setAuthToken(authToken) {
        var oldAuthToken = this._prefs.get('auth-token');
        if (oldAuthToken !== undefined && authToken !== oldAuthToken)
            return false;
        this._prefs.set('auth-token', authToken);
        return true;
    }
};
