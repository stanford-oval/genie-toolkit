// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const express = require('express');
const passport = require('passport');

var router = express.Router();

router.post('/login', passport.authenticate('local', { session: false }), function(req, res, next) {
    res.json({
        success: true,
        cloudId: req.user.cloud_id,
        authToken: req.user.auth_token
    });
});

router.use('/oauth2', require('./oauth2'));

module.exports = router;
