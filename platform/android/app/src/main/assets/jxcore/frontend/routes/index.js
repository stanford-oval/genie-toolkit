var os = require('os');
var fs = require('fs');
var path = require('path');
var jade = require('jade');
var express = require('express');
var router = express.Router();

router.get('/', function(req, res, next) {
    res.render('index', { page_title: "ThingEngine - run your things!" });
});

module.exports = router;
