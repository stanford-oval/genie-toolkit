
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

var index = require('./routes/index');
var user = require('./routes/user');
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
                            secret: secretKey.getSecretKey(this._app) }));
    this._app.use(csurf({ cookie: false }));
    this._app.use(express.static(path.join(__dirname, 'public')));

    // development only
    if ('development' == this._app.get('env')) {
        this._app.use(errorHandler());
    }

    this._app.use('/', index);
    this._app.use('/user', user);

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

    return Q.ninvoke(server, 'listen', this._app.get('port'))
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
