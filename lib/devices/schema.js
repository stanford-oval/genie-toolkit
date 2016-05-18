// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const path = require('path');
const Q = require('q');

module.exports = class SchemaRetriever {
    constructor(client) {
        this._schemaRequest = null;
        this._pendingSchemaRequests = [];
        this._metaRequest = null;
        this._pendingMetaRequests = [];

        this._client = client;
    }

    _ensureSchemaRequest() {
        if (this._schemaRequest !== null)
            return;

        this._schemaRequest = Q.delay(0).then(function() {
            var pending = this._pendingSchemaRequests;
            this._pendingSchemaRequests = [];
            this._schemaRequest = null;
            console.log('Batched schema request for ' + pending);
            return this._client.getSchemas(pending);
        }.bind(this));
    }

    _ensureMetaRequest() {
        if (this._metaRequest !== null)
            return;

        this._metaRequest = Q.delay(0).then(function() {
            var pending = this._pendingMetaRequests;
            this._pendingMetaRequests = [];
            this._metaRequest = null;
            console.log('Batched schema-meta request for ' + pending);
            return this._client.getMetas(pending);
        }.bind(this));
    }


    getSchema(kind) {
        if (this._pendingSchemaRequests.indexOf(kind) < 0)
            this._pendingSchemaRequests.push(kind);
        this._ensureSchemaRequest();
        return this._schemaRequest.then(function(everything) {
            if (kind in everything)
                return everything[kind];
            else
                return null;
        });
    }

    getMeta(kind) {
        if (this._pendingMetaRequests.indexOf(kind) < 0)
            this._pendingMetaRequests.push(kind);
        this._ensureMetaRequest();
        return this._metaRequest.then(function(everything) {
            if (kind in everything)
                return everything[kind];
            else
                return null;
        });
    }
}
module.exports.prototype.$rpcMethods = ['getSchema', 'getMeta'];
