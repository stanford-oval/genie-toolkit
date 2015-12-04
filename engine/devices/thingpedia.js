// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('../config');

const Q = require('q');
const https = require('https');
const path = require('path');
const url = require('url');

var _agent = null;
function getAgent() {
    if (_agent === null) {
        var caFile = path.resolve(path.dirname(module.filename), '../data/thingpedia.cert');
        _agent = new https.Agent({ keepAlive: false,
                                   maxSockets: 10,
                                   ca: fs.readFileSync(caFile) });
    }

    return _agent;
}

function httpRequest(to, id) {
    var parsed = url.parse(to);
    parsed.agent = getAgent();
    return Q.Promise(function(callback, errback) {
        https.get(parsed, function(response) {
            if (response.statusCode == 404)
                return errback(new Error('No such device ' + id));
            if (response.statusCode != 200)
                return errback(new Error('Unexpected HTTP error ' + response.statusCode + ' downloading channel ' + id));

            return response;
        }.bind(this)).on('error', function(error) {
            errback(error);
        });
    });
}

function httpDiscoveryRequest(to, blob) {
    var parsed = url.parse(to);
    parsed.method = 'POST';
    parsed.headers = {};
    parsed.headers['Content-Type'] = 'application/json';

    return Q.Promise(function(callback, errback) {
        var req = https.request(options, function(res) {
            if (response.statusCode == 404)
                return errback(new Error('No such device'));
            if (response.statusCode != 200)
                return errback(new Error('Unexpected HTTP error ' + response.statusCode + ' decoding discovery'));

            var data = '';
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                data += chunk;
            });
            res.on('end', function() {
                callback(data);
            });
        });
        req.on('error', function(err) {
            callback(err);
        });
        req.end(JSON.stringify(blob));
    });
}

module.exports = {
    getZip: function(id) {
        return httpRequest(Config.THINGPEDIA_URL + '/download/devices/' + id, id);
    },

    getCode: function(id) {
        return httpRequest(Config.THINGPEDIA_URL + '/api/code/devices/' + id, id);
    },

    getKindByDiscovery: function(publicData) {
        return httpDiscoveryRequest(Config.THINGPEDIA_URL + '/api/discovery', publicData);
    }
};
