var express = require('express');
var router = express.Router();
const user = require('../util/user');
const db = require('../util/db');

router.get('/', function(req, res, next) {
    res.render('index', {
        page_title: 'ThingEngine - run your things!',
    });
});

module.exports = router;
