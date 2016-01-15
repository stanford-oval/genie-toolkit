// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const express = require('express');
const url = require('url');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

const user = require('../util/user');
const EngineManager = require('../enginemanager');

const AppGrammar = require('../instance/engine/app_grammar');
const AppCompiler = require('../instance/engine/app_compiler');

const THINGPEDIA_ORIGIN = 'https://thingpedia.herokuapp.com';
//const THINGPEDIA_ORIGIN = 'http://127.0.0.1:5000';

var router = express.Router();

function getModule(parsed) {
    if (parsed.protocol === 'https:')
        return https;
    else
        return http;
}

function httpRequest(to) {
    var parsed = url.parse(to);
    parsed.method = 'GET';
    return Q.Promise(function(callback, errback) {
        var req = getModule(parsed).get(parsed, function(res) {
            if (res.statusCode == 404)
                return errback(new Error('No such app'));
            if (res.statusCode != 200)
                return errback(new Error('Unexpected HTTP error ' + res.statusCode));

            var data = '';
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                data += chunk;
            });
            res.on('end', function() {
                callback(data);
            });
        });
        req.on('error', errback);
    });
}

router.get('/install/:id(\\d+)', user.redirectLogIn, function(req, res, next) {
    httpRequest(THINGPEDIA_ORIGIN + '/api/code/apps/' + req.params.id)
        .then(function(response) {
            var parsed = JSON.parse(response);
            if (parsed.error)
                throw new Error(parsed.error);

            // sanity check the app for version incompatibilities
            var ast = AppGrammar.parse(parsed.code);
            var compiler = new AppCompiler();
            compiler.compileProgram(ast);

            var params = Object.keys(compiler.params).map(function(k) {
                return [k, compiler.params[k]];
            });

            res.render('app_install', { page_title: "ThingEngine - Install App",
                                        csrfToken: req.csrfToken(),
                                        thingpediaId: req.params.id,
                                        params: params,
                                        name: parsed.name,
                                        description: parsed.description,
                                        code: parsed.code });
        }).catch(function(e) {
            res.status(400).render('error', { page_title: "ThingEngine - Error",
                                              message: e.message });
        }).done();
});

module.exports = router;
