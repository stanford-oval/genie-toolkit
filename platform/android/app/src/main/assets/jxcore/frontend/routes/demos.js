var os = require('os');
var fs = require('fs');
var path = require('path');
var jade = require('jade');
var express = require('express');
var router = express.Router();

var LINKEDIN_CODE = 'LinkedInApp(g : Group) {' +
'    module compute() {' +
'        event newcolleague(name : String, ind : String);' +
'        function newmessage(name : String, ind :  String) {' +
'            query1("linkedin()").then(function(v) {' +
'                if (ind === v.industry)' +
'                    newcolleague(name, ind);' +
'            }).done();' +
'        }' +
'    }' +
'' +
'    mylin = linkedin() => g.compute.newmessage(name = mylin.formattedName, ind = mylin.industry);' +
'    (name, ind) = compute.newcolleague() => notify(message = name + " also works in " + ind);' +
'}';

var WEIGHTCOMP_CODE = 'WeightCompApp(g : Group) {' +
'  table weightHistory(time : Number, weight : Measure(kg));' +
'  table weightBoard(name : String, delta : Measure(kg));' +
'' +
'  scale = #scale() => weightHistory(time = scale.ts, weight = scale.weight);' +
'' +
'  initial = min(weightHistory.alldata, time),' +
'  current = max(weightHistory.oninsert, time) =>' +
'  weightBoard(key_="name", name = @self.name, delta = (initial.weight - current.weight) / initial.weight);'+
'' +
'  weightBoard.oninsert(), board = all(g.weightBoard.alldata, delta) =>' +
'  g(title="Weight Competition", text="New results for the weight competition", callback="weightcomp",' +
'    data=board);' +
'}';

router.get('/linkedin', function(req, res, next) {
    var feedId = req.session['linkedin-feed-id'];
    if (!feedId) {
        feedId = req.query['feedId'];
        if (feedId)
            req.session['linkedin-feed-id'] = feedId;
    }
    if (!feedId) {
        res.render('demo_view', { page_title: "LinkedIn Party!", nofeed: true, done: false });
        return;
    }
    req.session['device-redirect-to'] = req.originalUrl;

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
    console.log('Messaging Group Id');
    var appId = 'app-LinkedInApp-' + messagingGroupId;

    if (apps.getApp(appId) === undefined) {
        engine.apps.loadOneApp(LINKEDIN_CODE, { g: messagingGroupId }, appId, 'phone', true).then(function() {
            delete req.session['device-redirect-to'];
            res.render('demo_view', { page_title: "LinkedIn Party!", nofeed: false, done: true });
        }).done();
    } else {
        delete req.session['device-redirect-to'];
        res.render('demo_view', { page_title: "LinkedIn Party!", nofeed: false, done: true });
    }
});

router.get('/weightcomp', function(req, res, next) {
    var feedId = req.session['weightcomp-feed-id'];
    if (!feedId) {
        feedId = req.query['feedId'];
        if (feedId)
            req.session['weightcomp-feed-id'] = feedId;
    }
    if (!feedId) {
        res.render('demo_weightcomp_install_view', { page_title: "Weight Competition!", nofeed: true, done: false });
        return;
    }
    req.session['device-redirect-to'] = req.originalUrl;

    var engine = req.app.engine;
    var devices = engine.devices;
    var apps = engine.apps;

    // first check that we can talk to omlet
    var omletDevices = devices.getAllDevicesOfKind('omlet');
    if (omletDevices.length < 1) {
        res.render('demo_weightcomp_install_view', { page_title: "Weight Competition!", nofeed: false, done: false,
                                                     message: "But first, you must allow your ThingEngine to use your Omlet account",
                                                     link: '/devices/oauth2/omlet' });
        return;
    }

    // now we should check that we have a scale configured
    // but we don't do that, because we only have one scale anyway

    // now check that we have the app installed
    var messagingGroupId = 'messaging-group-omlet' + feedId.replace(/[^a-zA-Z0-9]+/g, '-');
    console.log('Messaging Group Id');
    var appId = 'app-WeightCompApp-' + messagingGroupId;

    if (apps.getApp(appId) === undefined) {
        engine.apps.loadOneApp(WEIGHTCOMP_CODE, { g: messagingGroupId }, appId, 'phone', true).then(function() {
            delete req.session['device-redirect-to'];
            res.render('demo_weightcomp_install_view', { page_title: "Weight Competition!", nofeed: false, done: true });
        }).done();
    } else {
        delete req.session['device-redirect-to'];
        res.render('demo_weightcomp_install_view', { page_title: "Weight Competition!", nofeed: false, done: true });
    }
});

router.get('/callback/weightcomp/:result', function(req, res, next) {
    res.render('demo_weightcomp_board', { page_title: "Weight Competition",
                                          result: (new Buffer(req.params.result, 'base64')).toString() });
});

module.exports = router;
