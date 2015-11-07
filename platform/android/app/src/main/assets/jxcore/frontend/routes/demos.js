var os = require('os');
var fs = require('fs');
var path = require('path');
var jade = require('jade');
var express = require('express');
var router = express.Router();

var CODE = 'LinkedInApp(g : Group) {' +
'    module compute() {' +
'        event newcolleague(name : String, ind : String);' +
'        function newmessage(name : String, ind :  String) {' +
'            query1("linkedin()").then(function(v) {' +
'                if (ind === v.industry)' +
'                    newcolleague(name, ind);' +
'            });' +
'        }' +
'    }' +
'' +
'    mylin = linkedin() => g.compute.newmessage(name = mylin.formattedName, ind = mylin.industry);' +
'    (name, ind) = compute.newcolleague() => notify(msg = name + " also works in " + ind);' +
'}';

router.get('/linkedin', function(req, res, next) {
    var feedId = req.session['linkedin-feed-id'];
    if (feedId === undefined) {
        feedId = req.query['feedId'];
        req.session['linkedin-feed-id'] = feedId;
    }
    if (feedId === undefined) {
        res.render('demo_view', { page_title: "LinkedIn Party!", nofeed: true, done: false });
        return;
    }

    var engine = req.app.engine;
    var devices = engine.devices;
    var apps = engine.apps;

    // first check that we can talk to omlet
    var omletDevices = devices.getAllDevicesOfKind('omlet');
    if (omletDevices.length < 1) {
        res.render('demo_view', { page_title: "LinkedIn Party!", nofeed: false, done: false,
                                  message: "But first, you must allow your ThingEngine to use your Omlet account",
                                  link: '/devices/oauth2/omlet' });
        return;
    }

    // now check that we have LinkedIn configured
    var linkedInDevices = devices.getAllDevicesOfKind('linkedin');
    if (linkedInDevices.length < 1) {
        res.render('demo_view', { page_title: "LinkedIn Party!", nofeed: false, done: false,
                                  message: "But first, you must allow your ThingEngine to access your LinkedIn account",
                                  link: '/devices/oauth2/linkedin' });
        return;
    }

    // now check that we have the app installed
    var messagingGroupId = 'messaging-group-omlet' + feedId.replace(/[^a-zA-Z0-9]+/g, '-');
    var appId = 'app-LinkedInApp-' + messagingGroupId;

    if (apps.getApp(appId) === undefined) {
        engine.apps.loadOneApp(CODE, { g: messagingGroupId }, appId, 'phone', true).then(function() {
            res.render('demo_view', { page_title: "LinkedIn Party!", nofeed: true, done: true });
        });
            res.render('index', { page_title: "ThingEngine - run your things!" });
});

module.exports = router;
