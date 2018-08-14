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
const qs = require('querystring');

module.exports = class ThingpediaClientHttp {
    constructor(platform, url) {
        this.platform = platform;
        this._url = url;
    }

    get developerKey() {
        return this.platform.getDeveloperKey();
    }

    get locale() {
        return this.platform.locale;
    }

    getModuleLocation(id) {
        var to = this._url + '/download/devices/' + id + '.zip';
        if (this.developerKey)
            to += '?developer_key=' + this.developerKey;
        return Tp.Helpers.Http.get(to, { followRedirects: false }).then((res) => {
            throw new Error(`Expected a redirect downloading channel ${id}`);
        }, (err) => {
            if (err.code !== 301)
                throw new Error(`Unexpected HTTP status ${err.code} downloading channel ${id}`);

            return err.redirect;
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
        return Tp.Helpers.Http.post(to + '?' + qs.stringify(params), JSON.stringify(publicData), { dataContentType: 'application/json' });
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
};
