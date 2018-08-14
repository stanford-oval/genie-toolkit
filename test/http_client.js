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
const qs = require('querystring');

function getModule(parsed) {
    if (parsed.protocol === 'https:')
        return https;
    else
        return http;
}

module.exports = class ThingpediaClientHttp {
    constructor(thingpediaUrl, developerKey, locale) {
        this.developerKey = developerKey;
        this.locale = locale || 'en-US';
        this._url = thingpediaUrl;
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

    _simpleRequest(to, params = {}) {
        params.locale = this.locale;
        if (this.developerKey)
            params.developer_key = this.developerKey;
        to += '?' + qs.stringify(params);
        return Tp.Helpers.Http.get(this._url + to).then((response) => JSON.parse(response));
    }

    getDeviceCode(id) {
        return this._simpleRequest('/api/code/devices/' + id);
    }

    getSchemas(kinds) {
        return this._simpleRequest('/api/schema/' + kinds.join(','));
    }

    getMetas(kinds) {
        return this._simpleRequest('/api/schema-metadata/' + kinds.join(','));
    }

    getDeviceList(klass, page, page_size) {
        const params = { page, page_size };
        if (klass)
            params.class = klass;
        return this._simpleRequest('/api/devices/all', params);
    }

    getDeviceFactories(klass) {
        const params = {};
        if (klass)
            params.class = klass;
        return this._simpleRequest('/api/devices', params);
    }

    getDeviceSetup2(kinds) {
        return this._simpleRequest('/api/v2/devices/setup/' + kinds.join(','));
    }

    getDeviceSetup(kinds) {
        return this._simpleRequest('/api/devices/setup/' + kinds.join(','));
    }

    getKindByDiscovery(publicData) {
        let to = this._url + '/api/discovery';
        const params = { locale: this.locale };
        if (this.developerKey)
            params.developer_key = this.developerKey;
        return Tp.Helpers.Http.post(to + qs.stringify(params), JSON.stringify(publicData), { dataContentType: 'application/json' });
    }

    getExamplesByKey(key) {
        return this._simpleRequest('/api/examples', { key });
    }

    getExamplesByKinds(kinds) {
        return this._simpleRequest('/api/examples/by-kinds/' + kinds.join(','));
    }

    clickExample(exampleId) {
        return this._simpleRequest('/api/examples/click/' + exampleId);
    }

    lookupEntity(entityType, searchTerm) {
        return this._simpleRequest('/api/entities/lookup/' + encodeURIComponent(entityType),
            { q: searchTerm }).then((result) => {
                const array = result.data;
                array.meta = result.meta;
                return array;
            });
    }
};