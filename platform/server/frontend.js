
/**
 * Module dependencies.
 */

var express = require('express');
var routes = require('./routes');
var user = require('./routes/user');
var http = require('http');
var path = require('path');

function Frontend() {
    this._init.apply(this, arguments);
}

Frontend.prototype._init = function _init() {
    // all environments
    this._app = express();

    this._app.set('port', process.env.PORT || 3000);
    this._app.set('views', path.join(__dirname, 'views'));
    this._app.set('view engine', 'jade');
    this._app.use(express.favicon());
    this._app.use(express.logger('dev'));
    this._app.use(express.json());
    this._app.use(express.urlencoded());
    this._app.use(express.methodOverride());
    this._app.use(this._app.router);
    this._app.use(express.static(path.join(__dirname, 'public')));

    // development only
    if ('development' == this._app.get('env')) {
        this._app.use(express.errorHandler());
    }

    this._app.get('/', routes.index);
    this._app.get('/users', user.list);
}

Frontend.prototype.start = function() {
    http.createServer(this._app).listen(this._app.get('port'), (function() {
        console.log('Express server listening on port ' + this._app.get('port'));
    }).bind(this));
}

Frontend.prototype.stop = function() {
    // FIXME find a way to stop
}

module.exports = Frontend;
