const express = require('express');
var router = express.Router();

router.get('/', function(req, res, next) {
    res.render('index', { page_title: "ThingEngine - run your things!" });
});

module.exports = router;
