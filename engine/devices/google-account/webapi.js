// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

// This module provides access to google APIs using OAuth and
// the web APIs
// A separate module provides the same access using Android APIs

const Q = require('q');
const lang = require('lang');
const http = require('http');
const https = require('https');
const url = require('url');

const GOOGLE_FIT_BASE_URL = 'https://www.googleapis.com/fitness/v1/users';

function httpRequest(method, fullUrl, accessToken, data, dataContentType) {
    console.log('HTTP ' + method + ' to ' + fullUrl);
    var parsed = url.parse(fullUrl);
    parsed.method = method;

    parsed.headers = {
        'Authorization': 'Bearer ' + accessToken
    };
    if (data !== undefined) {
        if (!(data instanceof Buffer))
            data = new Buffer(data);
        parsed.headers['Content-Type'] = dataContentType;
        parsed.headers['Content-Length'] = data.length;
    }

    var defer = Q.defer();
    var request = https.request(parsed, function(response) {
        response.on('error', function(err) {
            defer.reject(err);
        });
        if (response.statusCode != 200) {
            var err = new Error(http.STATUS_CODES[response.statusCode]);
            err.code = response.statusCode;
            defer.reject(err);
            return;
        }
        var buffers = [];
        var length = 0;
        response.on('data', function(data) {
            length += data.length;
            buffers.push(data);
        });
        response.on('end', function() {
            defer.resolve(Buffer.concat(buffers, length));
        });
    });
    if (data !== undefined)
        request.write(data);
    request.end();
    return defer.promise;
}

const GoogleDocsAPI = new lang.Class({
    Name: 'GoogleDocsWebAPI',

    _init: function(device) {
        this._device = device;
    },

    // FINISHME implement something useful here
});

const PagedList = new lang.Class({
    Name: 'PagedList',

    _init: function(reply, key, baseurl, accessToken) {
        var parsed = url.parse(baseurl);

        this._baseurl = baseurl;
        this._url = baseurl;
        if (!parsed.search)
            this._url += '?pageToken=';
        else
            this._url += '&pageToken=';

        this._key = key;
        this._accessToken = accessToken;

        this.reply = reply;
        this.objects = reply[key];
        this._nextToken = reply.nextPageToken;
    },

    next: function() {
        if (!this._nextToken)
            return Q(null);

        return httpRequest('GET', this._url + encodeURIComponent(this._nextToken),
                           this._accessToken)
            .then(function(reply) {
                reply = JSON.parse(reply.toString('utf8'));
                var list = new PagedList(reply, this._key,
                                         this._baseurl, this._accessToken);
                //if (!list.objects || list.objects.length == 0)
                //    return null;
                //else
                    return list;
            }.bind(this));
    }
});

function pagedRequest(key, baseurl, accessToken) {
    return httpRequest('GET', baseurl, accessToken).then(function(reply) {
        reply = JSON.parse(reply.toString('utf8'));
        return new PagedList(reply, key, baseurl, accessToken);
    });
}

const GoogleFitAPI = new lang.Class({
    Name: 'GoogleFitAPI',

    _init: function(device) {
        this._device = device;
    },

    _request: function(method, path, query, data, dataContentType) {
        var fullUrl = GOOGLE_FIT_BASE_URL + '/me' + path;
        if (query !== undefined)
            fullUrl += '?' + query;

        return httpRequest(method, fullUrl, this._device.accessToken,
                           data, dataContentType)
            .then(function(reply) {
                return JSON.parse(reply.toString('utf8'));
            });
    },

    listSessions: function() {
        return pagedRequest('sessions', GOOGLE_FIT_BASE_URL + '/me/sessions',
                            this._device.accessToken);
    },

    listDataSources: function() {
        return this._request('GET', '/dataSources').then(function(reply) {
            return reply.dataSource;
        });
    },

    getDataSet: function(dataSourceId, startTime, endTime, limit) {
        // note the ugly math: this is intentional: the range of a double
        // is not enough to represent nanoseconds since the epoch, and we
        // don't want to put fractions in the url
        if (typeof startTime == 'object')
            startTime = String(startTime.getTime()) + '000000';
        if (typeof endTime == 'object')
            endTime = String(endTime.getTime()) + '000000';
        var url = GOOGLE_FIT_BASE_URL + '/me/dataSources/' +
            encodeURIComponent(dataSourceId)
            + '/datasets/' + startTime + '-' + endTime;
        if (limit !== undefined)
            url += '?limit=' + limit;

        return pagedRequest('point', url, this._device.accessToken);
    }
});

module.exports = function(device) {
    var docs = null;
    var fit = null;

    return ({
        get googleDocs() {
            if (docs === null)
                docs = new GoogleDocsAPI(device);
            return docs;
        },

        get googleFit() {
            if (fit === null)
                fit = new GoogleFitAPI(device);
            return fit;
        }
    });
};
