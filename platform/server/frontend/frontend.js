
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
var expressWs = require('express-ws');
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

    this._app.set('port', process.env.PORT || 3000);
    this._app.set('views', path.join(__dirname, 'views'));
    this._app.set('view engine', 'jade');
    //this._app.use(favicon());
    this._app.use(logger('dev'));
    this._app.use(bodyParser.json());
    this._app.use(bodyParser.urlencoded({ extended: true }));
    this._app.use(cookieParser());
    this._app.use(session({ resave: false,
                            saveUninitialized: false,
                            secret: secretKey.getSecretKey() }));
    this._app.use(csurf({ cookie: false,
                          ignoreMethods: ['GET','HEAD','OPTIONS',
                                          'UPGRADE','CONNECT']
                        }));
    this._app.use(connect_flash());
    this._app.use(express.static(path.join(__dirname, 'public')));
    expressWs(this._app);

    // development only
    if ('development' == this._app.get('env')) {
        console.log('Frontend initialized in development mode');
        this._app.use(errorHandler());
    }

    this._app.use(passport.initialize());
    this._app.use(passport.session());
    user.initializePassport();
    this._app.use(function(req, res, next) {
        if (req.user) {
            res.locals.authenticated = true;
            res.locals.user = { username: req.user, isConfigured: true };
        } else {
            res.locals.authenticated = false;
            res.locals.user = { isConfigured: user.isConfigured() };
        }
        next();
    });

    this._app.use('/', require('./routes/index'));
    this._app.use('/apps', require('./routes/apps'));
    this._app.use('/user', require('./routes/user'));
    this._app.use('/config', require('./routes/config'));
    this._app.use('/devices', require('./routes/devices'));
    require('./routes/query')(this._app);
}

var server = null;

Frontend.prototype.open = function() {
    // '::' means the same as 0.0.0.0 but for IPv6
    // without it, node.js will only listen on IPv4
    return Q.ninvoke(this._app, 'listen', this._app.get('port'), '::')
        .then(function() {
            console.log('Express server listening on port ' + this._app.get('port'));
        }.bind(this));
};

Frontend.prototype.close = function() {
    return Q.ninvoke(server, 'close').then(function() {
        console.log('Express server stopped');
    }).catch(function(error) {
        console.log('Error stopping Express server: ' + error);
        console.log(error.stack);
    });
};

Frontend.prototype.getApp = function() {
    return this._app;
};

Frontend.prototype.setEngine = function(engine) {
    this._app.engine = engine;
};

module.exports = Frontend;
