// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const express = require('express');

const user = require('../util/user');
const EngineManager = require('../enginemanager');

const AppGrammar = require('../instance/engine/app_grammar');
const AppCompiler = require('../instance/engine/app_compiler');
const HttpUtil = require('../instance/engine/util/http');

const THINGPEDIA_ORIGIN = 'https://thingpedia.stanford.edu';
//const THINGPEDIA_ORIGIN = 'http://127.0.0.1:5000';

var router = express.Router();

router.get('/install/:id(\\d+)', user.redirectLogIn, function(req, res, next) {
    HttpUtil.request(THINGPEDIA_ORIGIN + '/api/code/apps/' + req.params.id, 'GET', null, '', function(error, response) {
        if (error) {
            res.status(400).render('error', { page_title: "ThingEngine - Error",
                                              message: error.message });
            return;
        }

        try {
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
        } catch(e) {
            res.status(500).render('error', { page_title: "ThingEngine - Error",
                                              message: "ThingPedia returned an invalid response: " + e.message });
            return;
        }

        res.render('app_install', { page_title: "ThingEngine - Install App",
                                    csrfToken: req.csrfToken(),
                                    thingpediaId: req.params.id,
                                    params: params,
                                    name: parsed.name,
                                    description: parsed.description,
                                    code: parsed.code });
    });
});

module.exports = router;
