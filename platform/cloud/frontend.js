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
var passport = require('passport');
var connect_flash = require('connect-flash');

var user = require('./util/user');
var secretKey = require('./util/secret_key');

function Frontend() {
    this._init.apply(this, arguments);
}

Frontend.prototype._init = function _init() {
    // all environments
    this._app = express();

    this._app.set('port', process.env.PORT || 8080);
    this._app.set('views', path.join(__dirname, 'views'));
    this._app.set('view engine', 'jade');
    //this._app.use(favicon());
    this._app.use(logger('dev'));
    this._app.use(bodyParser.json());
    this._app.use(bodyParser.urlencoded({ extended: true }));
    this._app.use(cookieParser());
    this._app.use(session({ resave: false,
                            saveUninitialized: false,
                            secret: secretKey.getSecretKey(this._app) }));
    this._app.use(connect_flash());
    this._app.use(express.static(path.join(__dirname, 'public')));

    // development only
    if ('development' == this._app.get('env')) {
        this._app.use(errorHandler());
    }

    this._app.use(passport.initialize());
    this._app.use(passport.session());
    user.initializePassport();

    var basicAuth = passport.authenticate('basic', { failWithError: true });
    this._app.use(function(req, res, next) {
        if (req.query.auth == 'app') {
            basicAuth(req, res, function(err) {
                if (err)
                    res.status(401);
                // eat the error
                next();
            });
        } else
            next();
    });
    this._app.use(function(req, res, next) {
        if (req.user) {
            res.locals.authenticated = true;
            res.locals.user = req.user;
        } else {
            res.locals.authenticated = false;
            res.locals.user = { isConfigured: true };
        }
        next();
    });

    // mount /api before CSRF
    // as we don't need CSRF protection for that
    this._app.use('/api', require('./routes/server'));
    this._app.use(csurf({ cookie: false }));

    this._app.use('/', require('./routes/index'));
    this._app.use('/', require('./routes/qrcode'));
    this._app.use('/user', require('./routes/user'));
    this._app.use('/apps', require('./routes/apps'));
    this._app.use('/devices', require('./routes/devices'));
    require('./routes/install')(this._app);

    this._websocketEndpoints = {};
}

var server = null;

Frontend.prototype.open = function() {
    var server = http.createServer(this._app);
    server.on('upgrade', function(req, socket, head) {
        var parsed = url.parse(req.url);
        var endpoint = this._websocketEndpoints[parsed.pathname];
        if (endpoint === undefined) {
            socket.write('HTTP/1.1 404 Not Found\r\n');
            socket.write('Content-type: text/plain;charset=utf8;\r\n');
            socket.write('\r\n\r\n');
            socket.end('Invalid cloud ID');
            return;
        }

        endpoint(req, socket, head);
    }.bind(this));
    this.server = server;

    // '::' means the same as 0.0.0.0 but for IPv6
    // without it, node.js will only listen on IPv4
    return Q.ninvoke(server, 'listen', this._app.get('port'), '::')
        .then(function() {
            console.log('Express server listening on port ' + this._app.get('port'));
        }.bind(this));
}

Frontend.prototype.close = function() {
    return Q.ninvoke(this.server, 'close').then(function() {
        console.log('Express server stopped');
    }).catch(function(error) {
        console.log('Error stopping Express server: ' + error);
        console.log(error.stack);
    });
}

Frontend.prototype.getApp = function() {
    return this._app;
}

Frontend.prototype.registerWebSocketEndpoint = function(path, callback) {
    this._websocketEndpoints[path] = callback;
}

module.exports = Frontend;
