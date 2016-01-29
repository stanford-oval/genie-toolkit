const express = require('express');
var router = express.Router();
const user = require('../util/user');
const db = require('../util/db');

router.get('/', function(req, res, next) {
    res.render('index', {
        page_title: 'ThingEngine - run your things!',
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
