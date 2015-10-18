// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

/**
 * Module dependencies.
 */

var Q = require('q');

var express = require('express');
var http = require('http');
var path = require('path');
var logger = require('morgan');
var favicon = require('serve-favicon');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var session = require('express-session');
var csurf = require('csurf');
var errorHandler = require('errorhandler');
var url = require('url');
var connect_flash = require('connect-flash');
var expressWs = require('express-ws');

var secretKey = require('./util/secret_key');
var mdns = require('mdns');

var PORT_NUMBER = 4444;

function main() {
    // advertise a http server on port 4444
    var service = mdns.createAdvertisement(mdns.tcp('_http'), PORT_NUMBER, {
        name:'ThingEngine-TV',
        txt:{
            txtvers:'1'
        }
    });
    service.start();


    app = expressWs(express()).app;

    app.set('port', process.env.PORT || PORT_NUMBER);
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'jade');
    //app.use(favicon());
    app.use(logger('dev'));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(cookieParser());
    app.use(session({ resave: false,
                      saveUninitialized: false,
                      secret: secretKey.getSecretKey(app) }));
    app.use(connect_flash());
    app.use(express.static(path.join(__dirname, 'public')));

    // development only
    if ('development' == app.get('env')) {
        app.use(errorHandler());
    }

    app.thingtv = {};
    app.thingtv.clients = [];

    // mount /api before CSRF
    // as we don't need CSRF protection for that
    app.use('/api', require('./routes/api'));
    app.use(csurf({ cookie: false }));
    // need to install this way to support express-ws
    require('./routes/index')(app);

    app.listen(app.get('port'));
}
main();
