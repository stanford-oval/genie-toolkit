// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const express = require('express');

const db = require('../util/db');
const user = require('../util/user');
const feeds = require('../../shared/util/feeds');
const model = require('../model/app');

const EngineManager = require('../enginemanager');

const ThingTalk = require('thingtalk');
const AppCompiler = ThingTalk.Compiler;

var router = express.Router();

function SchemaRetriever() {
    this._request = null;
    this._pendingRequests = [];
}

SchemaRetriever.prototype._ensureRequest = function() {
    if (this._request !== null)
        return;

    this._request = Q.delay(0).then(function() {
        var pending = this._pendingRequests;
        this._pendingRequests = [];

        return db.withClient(function(dbClient) {
            return schema.getTypesByKinds(dbClient, pending, null);
        }).then(function(rows) {
            var obj = {};

            rows.forEach(function(row) {
                if (row.types === null)
                    return;
                obj[row.kind] = {
                    triggers: row.types[0],
                    actions: row.types[1]
                };
            });

            return obj;
        });
    }.bind(this));
};

SchemaRetriever.prototype.getSchema = function(kind) {
    if (this._pendingRequests.indexOf(kind) < 0)
        this._pendingRequests.push(kind);
    this._ensureRequest();
    return this._request.then(function(everything) {
        if (kind in everything)
            return everything[kind];
        else
            return null;
    });
};

var _schemaRetriever = new SchemaRetriever();

router.get('/install/:id(\\d+)', user.redirectLogIn, function(req, res, next) {
    db.withClient(function(dbClient) {
        return model.get(dbClient, req.params.id);
    }).then(function(app) {
        // sanity check the app for version incompatibilities
        var compiler = new AppCompiler();
        compiler.setSchemaRetriever(_schemaRetriever);
        return compiler.compileCode(app.code).then(function() {
            var params = Object.keys(compiler.params).map(function(k) {
                return [k, compiler.params[k]];
            });

            return Q.try(function() {
                if (compiler.feedAccess) {
                    return EngineManager.get().getEngine(req.user.id).then(function(engine) {
                        return feeds.getFeedList(engine, true);
                    });
                } else {
                    return null;
                }
            }).then(function(feeds) {
                res.render('app_install', { page_title: "ThingEngine - Install App",
                                            csrfToken: req.csrfToken(),
                                            thingpediaId: req.params.id,
                                            params: params,
                                            name: app.name,
                                            description: app.description,
                                            feeds: feeds,
                                            code: app.code });
            });
        });
    }).catch(function(e) {
        res.status(400).render('error', { page_title: "ThingEngine - Error",
                                          message: e.message });
    }).done();
});

module.exports = router;
