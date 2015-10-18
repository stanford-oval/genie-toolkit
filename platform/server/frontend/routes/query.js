// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var Q = require('q');
var express = require('express');

var user = require('../util/user');

module.exports = function(app) {
    app.get('/query', user.redirectLogIn, function(req, res, next) {
        res.render('query', {
            csrfToken: req.csrfToken(),
            page_title: "ThingEngine - Query"
        });
    });

    //app.ws('/query', user.requireLogIn, function(ws, req) {
    app.ws('/query/:code', function(ws, req) {
        console.log('Running continuous query...');

        var code = req.params.code;
        var state = req.query;

        var engine = req.app.engine;
        var runner = engine.getQueryRunner();

        try {
            var query = runner.runQuery(code, state, {
                triggered: function(data) {
                    console.log('Query triggered');
                    ws.send(JSON.stringify(data));
                }
            });

            ws.on('close', function() {
                console.log('Query client disconnected, stopping');
                query.stop().done();
            });
            query.start()
        } catch(e) {
            console.log('Failed to run query: ' + e);
            console.log(e.stack);

            ws.close();
        }
    });
}

