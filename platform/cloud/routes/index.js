// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const express = require('express');
const router = express.Router();
const user = require('../util/user');
const db = require('../util/db');

const EngineManager = require('../enginemanager');

router.get('/', function(req, res, next) {
    res.render('index', {
        page_title: 'ThingEngine - run your things!',
        isRunning: req.user ? EngineManager.get().isRunning(req.user.id) : false,
    });
});

router.get('/about', function(req, res, next) {
    res.render('about', {
        page_title: 'About ThingEngine'
    });
});

router.get('/about/toc', function(req, res, next) {
    res.render('toc', {
        page_title: 'Terms & Conditions for ThingEngine'
    });
});

module.exports = router;
