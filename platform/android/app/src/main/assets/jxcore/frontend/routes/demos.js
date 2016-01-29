const express = require('express');
var router = express.Router();

var LINKEDIN_CODE = 'LinkedInApp-F() {' +
    '  @linkedin.profile(name, _, ind) => Company-F[self](name, ind);' +
    '  Company-F[self](_, ind), Company-F[m](name, ind), m in F =>' +
    '    NewColleague(name, ind);' +
    '  NewColleague(name, co) => @$notify(name, co);' +
    '}';

var WEIGHTCOMP_CODE = 'WeightCompetition-F() {' +
    '  var InitialWeight(w : Measure(kg));' +
    '  @(type="scale")(w) => Weight(w);' +
    '  Weight(w), !InitialWeight(_) =>' +
    '    InitialWeight(w);' +
    '  InitialWeight(w1), Weight(w2) =>' +
    '    Loss-F[self]((w1 - w2)/w2);' +
    '  Loss-F[m](_), m in F =>' +
    '    Winner(ArgMax(Loss-F));' +
    '  Winner(w) => @$notify(w);' +
    '}';

var PICTURE_TV_DEMO = 'PictureTVApp-F() {' +
    '  @omlet.newmessage(F, "picture", url) => @(type="tv")(url);' +
    '}';

router.get('/linkedin', function(req, res, next) {
    var feedId = req.session['linkedin-feed-id'];
    if (!feedId) {
        if (req.query.feedId) {
            feedId = (new Buffer(req.query.feedId, 'base64')).toString();
            req.session['linkedin-feed-id'] = feedId;
        }
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
    var appId = 'app-LinkedInApp' + feedId.replace(/[^a-zA-Z0-9]+/g, '-');
    if (apps.getApp(appId) === undefined) {
        engine.apps.loadOneApp(LINKEDIN_CODE, { '$F': feedId }, appId, 'phone', true).then(function() {
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
        if (req.query.feedId) {
            feedId = (new Buffer(req.query['feedId'], 'base64')).toString();
            req.session['weightcomp-feed-id'] = feedId;
        }
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
    var appId = 'app-WeightCompApp' + feedId.replace(/[^a-zA-Z0-9]+/g, '-');

    if (apps.getApp(appId) === undefined) {
        engine.apps.loadOneApp(WEIGHTCOMP_CODE, { '$F': feedId }, appId, 'phone', true).then(function() {
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

router.get('/picturetv', function(req, res, next) {
    var feedId = req.session['picturetv-feed-id'];
    if (!feedId) {
        if (req.query.feedId) {
            feedId = (new Buffer(req.query.feedId, 'base64')).toString();
            req.session['picturetv-feed-id'] = feedId;
        }
    }
    if (!feedId) {
        res.render('demo_picturetv_install_view', { page_title: "Share on TV!", nofeed: true, done: false });
        return;
    }
    req.session['device-redirect-to'] = req.originalUrl;

    var engine = req.app.engine;
    var devices = engine.devices;
    var apps = engine.apps;

    // first check that we can talk to omlet
    var omletDevices = devices.getAllDevicesOfKind('omlet');
    if (omletDevices.length < 1) {
        res.render('demo_picturetv_install_view', { page_title: "Share on TV!", nofeed: false, done: false,
                                                    message: "But first, you must allow your ThingEngine to use your Omlet account",
                                                    link: '/devices/oauth2/omlet' });
        return;
    }

    // now check that we have a tv installed
    var tvDevices = devices.getAllDevicesOfKind('tv');
    if (tvDevices.length < 1) {
        res.render('demo_picturetv_install_view', { page_title: "Share on TV!", nofeed: false, done: false,
                                                    message: "But first, you must set up your TV with ThingEngine",
                                                    link: '/devices/create?class=physical' });
        return;
    }

    // now check that we have the app installed
    var appId = 'app-PictureTVApp' + feedId.replace(/[^a-zA-Z0-9]+/g, '-');

    if (apps.getApp(appId) === undefined) {
        engine.apps.loadOneApp(PICTURE_TV_DEMO, { '$F': feedId }, appId, 'phone', true).then(function() {
            delete req.session['device-redirect-to'];
            res.render('demo_picturetv_install_view', { page_title: "Share on TV!", nofeed: false, done: true });
        }).done();
    } else {
        delete req.session['device-redirect-to'];
        res.render('demo_picturetv_install_view', { page_title: "Share on TV!", nofeed: false, done: true });
    }
});


module.exports = router;
