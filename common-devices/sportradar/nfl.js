// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');
const https = require('https');
const Url = require('url');

const BaseChannel = require('../base_channel');

const NFL_API_KEY = 'e8jqhrn3pw2ebddn5bbpctyg';
const NFL_URL = 'https://api.sportradar.us/nfl-t1/%d/%s/%d/%s/%s/summary.json?api_key=e8jqhrn3pw2ebddn5bbpctyg'
;const POLL_INTERVAL = 3600 * 1000; // 1h

const SportRadarNflChannel = new lang.Class({
    Name: 'SportRadarNflChannel',
    Extends: BaseChannel,

    _init: function(engine, device, params) {
        this.parent();

        if (params.length < 5)
            throw new TypeError("Missing required parameters");

        params = params.slice(0, 5);
        this._url = NFL_URL.format.apply(NFL_URL, params);
        this.filterString = params.join('-');
        this._timeout = -1;
    },

    _onTick: function() {
        var url = this._url;

        return Q.nfcall(httpGetAsync, url).then(function(response) {
            if (!response)
                return;
            var parsed = JSON.parse(response);

            console.log('Parsed response: ' + parsed);

            if (parsed.status !== 'closed')
                return;

            var homeScore = parsed.home_team.points;
            var awayScore = parsed.away_team.points;

            if (homeScore > awayScore)
                this.emitEvent([this._params].concat([parsed.home_team.id, homeScore]));
            else
                this.emitEvent([this._params].concat([parsed.away_team.id, awayScore]));
            clearInterval(this._timeout);
            this._timeout = -1;
        }.bind(this), function(error) {
            console.log('Error reading from SportRadar server: ' + error.message);
        });
    },

    _doOpen: function() {
        this._timeout = setInterval(function() {
            this._onTick().done();
        }.bind(this), POLL_INTERVAL);
        return this._onTick();
    },

    _doClose: function() {
        if (this._timeout !== -1)
            clearInterval(this._timeout);
        this._timeout = -1;
        return Q();
    }
});

function createChannel(engine, device, filters) {
    return new SportRadarNflChannel(engine, device, filters);
}

function httpGetAsync(url, callback) {
    var options = Url.parse(url);
    var req = https.get(options, function(res) {
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            data += chunk;
        });
        res.on('end', function() {
            callback(null, data);
        });
    });
    req.on('error', function(err) {
        callback(err);
    });
}

module.exports.createChannel = createChannel;
module.exports.requiredCapabilities = [];
