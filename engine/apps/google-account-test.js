// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseApp = require('../base_app');

const GoogleAccountTestApp = new lang.Class({
    Name: 'GoogleAccountTestApp',
    Extends: BaseApp,

    _init: function(engine, state) {
        this.parent(engine, state);
    },

    start: function() {
        console.log('Google Account Test App starting');

        var devices = this.engine.devices.getAllDevicesOfKind('google-account');
        if (devices.length == 0) {
            console.log('No Google Account configured');
            return Q();
        }

        var account = devices[0];
        var googleFit = account.queryInterface('google-fit');
        if (googleFit === null) {
            console.log('Google Fit API not available');
            return Q();
        }

        function listSessions(sessionList) {
            if (sessionList === null)
                return;

            console.log('Google Fit sessions', sessionList.reply);
            //return sessionList.next().then(listSessions);
        }
        googleFit.listSessions().then(listSessions).catch(function(e) {
            console.log('Error listing google fit sessions', e);
        }).done();

        var now = new Date;
        var oneweekago = new Date;
        oneweekago.setTime(now.getTime() - 7*3600*24*1000);

        function listDataSet(dataset) {
            if (dataset === null)
                return;

            console.log('Google Fit dataset for ' + dataset.reply.dataSourceId);
            console.log(dataset.reply);
            return dataset.next().then(listDataSet);
        }

        googleFit.listDataSources().then(function(dataSources) {
            console.log('=========================================');
            dataSources.forEach(function(source) {
                if (source.type === 'raw')
                    return;
                console.log('Google Fit data source');
                console.log(source);
            });
            console.log('=========================================');

            Q.all(dataSources.map(function(source) {
                return googleFit.getDataSet(source.dataStreamId, oneweekago, now).then(listDataSet);
            }));
        }).catch(function(e) {
            console.log('Error listing google fit data sources', e);
        }).done();

        return Q();
    },

    stop: function() {
        return Q();
    }
});

function createApp(engine, state) {
    return new GoogleAccountTestApp(engine, state);
}

module.exports.createApp = createApp;
