// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('../config');

const Q = require('q');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const url = require('url');

function getModule(parsed) {
    if (parsed.protocol === 'https:')
        return https;
    else
        return http;
}

function httpRequest(to, id) {
    var developerKey = platform.getDeveloperKey();
    if (developerKey)
        to += '?developer_key=' + developerKey;

    var parsed = url.parse(to);
    return Q.Promise(function(callback, errback) {
        getModule(parsed).get(parsed, function(response) {
            if (response.statusCode == 404)
                return errback(new Error('No such device ' + id));
            if (response.statusCode == 302 ||
                response.statusCode == 301)
                return httpRequest(response.headers['location'], id).then(callback, errback);
            if (response.statusCode != 200)
                return errback(new Error('Unexpected HTTP error ' + response.statusCode + ' downloading channel ' + id));

            callback(response);
        }.bind(this)).on('error', function(error) {
            errback(error);
        });
    });
}

function httpDiscoveryRequest(to, blob) {
    var developerKey = platform.getDeveloperKey();
    if (developerKey)
        to += '?developer_key=' + developerKey;

    var parsed = url.parse(to);
    parsed.method = 'POST';
    parsed.headers = {};
    parsed.headers['Content-Type'] = 'application/json';

    return Q.Promise(function(callback, errback) {
        var req = getModule(parsed).request(parsed, function(res) {
            if (res.statusCode == 404)
                return errback(new Error('No such device'));
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
        req.end(JSON.stringify(blob));
    });
}

module.exports = {
    getZip: function(id) {
        return httpRequest(Config.THINGPEDIA_URL + '/download/devices/' + id + '.zip', id);
    },

    getCode: function(id) {
        return httpRequest(Config.THINGPEDIA_URL + '/api/code/devices/' + id, id);
    },

    getKindByDiscovery: function(publicData) {
        return httpDiscoveryRequest(Config.THINGPEDIA_URL + '/api/discovery', publicData);
    }
};
