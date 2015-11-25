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

const BaseChannel = require('../../base_channel');

const NFL_API_KEY = 'e8jqhrn3pw2ebddn5bbpctyg';
const NFL_URL = 'https://api.sportradar.us/nfl-t1/%d/%s/%d/%s/%s/summary.json?api_key=e8jqhrn3pw2ebddn5bbpctyg'
;const POLL_INTERVAL = 3600 * 1000; // 1h

const SportRadarChannel = new lang.Class({
    Name: 'SportRadarChannel',
    Extends: BaseChannel,

    _init: function(engine, device, filters) {
        this.parent();

        // figure out the sport
        var nfl = null;
        var interval = 0, at = "";
        for (var i = 0; i < filters.length; i++) {
            if (filters[i].isThreshold) {
                if (filters[i].lhs.name === 'nfl') {
                    nfl = filters[i].rhs.value.value.split('-');
                    if (nfl.length != 5)
                        throw new TypeError("Invalid nfl value");
                    break;
                }
            } else {
                throw new TypeError();
            }
        }

        if (nfl === null)
            throw new TypeError();

        this._nfl = nfl.join('-');
        this._url = NFL_URL.format.apply(NFL_URL, nfl);
        this.filterString = 'nfl-' + nfl.join('-');
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
                this.emitEvent({ nfl: this._nfl, winner: parsed.home_team.id, score: homeScore });
            else
                this.emitEvent({ nfl: this._nfl, winner: parsed.away_score.id, score: awayScore });
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
    return new SportRadarChannel(engine, device, filters);
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
