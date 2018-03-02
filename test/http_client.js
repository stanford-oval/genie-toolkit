// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const http = require('http');
const https = require('https');
const url = require('url');

const THINGPEDIA_URL = process.env.THINGPEDIA_URL || 'https://crowdie.stanford.edu/thingpedia';

function getModule(parsed) {
    if (parsed.protocol === 'https:')
        return https;
    else
        return http;
}

module.exports = class ThingpediaClientHttp {
    constructor(developerKey, locale) {
        this.developerKey = developerKey;
        this.locale = locale || 'en_US';
        this._url = THINGPEDIA_URL;
    }

    getModuleLocation(id) {
        var to = this._url + '/download/devices/' + id + '.zip';
        if (this.developerKey)
            to += '?developer_key=' + this.developerKey;

        var parsed = url.parse(to);
        return new Promise((callback, errback) => {
            getModule(parsed).get(parsed, (res) => {
                // make sure we drain the request or we'll keep the TCP connection
                // alive forever!
                res.resume();

                if (res.statusCode !== 301)
                    errback(new Error(`Unexpected HTTP status ${res.statusCode} downloading channel ${id}`));
                else
                    callback(url.resolve(this._url, res.headers['location']));
            }).on('error', (error) => {
                errback(error);
            });
        });
    }

    _simpleRequest(to, noAppend) {
        if (!noAppend) {
            to += '?locale=' + this.locale;
            if (this.developerKey)
                to += '&developer_key=' + this.developerKey;
        }

        return Tp.Helpers.Http.get(to).then((response) => JSON.parse(response));
    }

    getAppCode(appId) {
        var to = this._url + '/api/code/devices/' + appId;
        return this._simpleRequest(to);
    }

    getApps(start, limit) {
        var to = this._url + '/api/apps';
        to += '?start=' + start + '&limit=' + limit + '&locale=' + this.locale;
        if (this.developerKey)
            to += '&developer_key=' + this.developerKey;
        return this._simpleRequest(to, true);
    }

    getDeviceCode(id) {
        var to = this._url + '/api/code/devices/' + id;
        to += '?version=2&locale=' + this.locale;
        if (this.developerKey)
            to += '&developer_key=' + this.developerKey;
        return this._simpleRequest(to, true);
    }

    getSchemas(kinds) {
        var to = this._url + '/api/schema/' + kinds.join(',');
        to += '?version=2&locale=' + this.locale;
        if (this.developerKey)
            to += '&developer_key=' + this.developerKey;
        return this._simpleRequest(to, true);
    }

    getMetas(kinds) {
        var to = this._url + '/api/schema-metadata/' + kinds.join(',');
        return this._simpleRequest(to);
    }

    getDeviceFactories(klass) {
        var to = this._url + '/api/devices';
        if (klass) {
            to += '?class=' + klass;
            if (this.developerKey)
                to += '&developer_key=' + this.developerKey;
            return this._simpleRequest(to, true);
        } else {
            return this._simpleRequest(to);
        }
    }

    getDeviceSetup(kinds) {
        var to = this._url + '/api/devices/setup/' + kinds.join(',');
        return this._simpleRequest(to);
    }

    getKindByDiscovery(publicData) {
        var to = this._url + '/api/discovery?locale=' + this.locale;
        if (this.developerKey)
            to += '&developer_key=' + this.developerKey;
        return Tp.Helpers.Http.post(to, JSON.stringify(publicData), { dataContentType: 'application/json' });
    }

    getExamplesByKey(key, isBase) {
        var to = this._url + '/api/examples?locale=' + this.locale + '&key=' + encodeURIComponent(key)
            + '&base=' + (isBase ? '1' : '0');
        if (this.developerKey)
            to += '&developer_key=' + this.developerKey;
        return this._simpleRequest(to, true);
    }

    getExamplesByKinds(kinds, isBase) {
        var to = this._url + '/api/examples/by-kinds/' + kinds.join(',') + '?locale=' + this.locale
            + '&base=' + (isBase ? '1' : '0');
        if (this.developerKey)
            to += '&developer_key=' + this.developerKey;
        return this._simpleRequest(to, true);
    }

    clickExample(exampleId) {
        var to = this._url + '/api/examples/click/' + exampleId;
        return this._simpleRequest(to);
    }
};
