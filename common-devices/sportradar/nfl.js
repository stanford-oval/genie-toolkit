// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const Tp = require('thingpedia');

const NFL_API_KEY = 'e8jqhrn3pw2ebddn5bbpctyg';
const NFL_URL = 'https://api.sportradar.us/nfl-t1/%d/%s/%d/%s/%s/summary.json?api_key=e8jqhrn3pw2ebddn5bbpctyg';
const POLL_INTERVAL = 3600 * 1000; // 1h

module.exports = new Tp.ChannelClass({
    Name: 'SportRadarNflChannel',
    Extends: Tp.HttpPollingTrigger,
    interval: POLL_INTERVAL,

    _init: function(engine, device, params) {
        this.parent();

        if (params.length < 5)
            throw new TypeError("Missing required parameters");

        params = params.slice(0, 5);
        this.url = NFL_URL.format.apply(NFL_URL, params);
        this.filterString = params.join('-');
    },

    _onResponse: function(response) {
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

        this.stopPolling();
    },
});
