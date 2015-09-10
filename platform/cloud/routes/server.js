// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

var express = require('express');
var passport = require('passport');

var model = require('../model/user');
var user = require('../util/user');
var db = require('../util/db');

var router = express.Router();

router.post('/login', passport.authenticate('local'), function(req, res, next) {
    res.json({
        success: true,
        cloudId: user.cloud_id,
        authToken: user.auth_token
    });
});


module.exports = router;
