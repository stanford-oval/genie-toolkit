var express = require('express');
var model = require('../model/user');
var router = express.Router();
var user = require('../util/user');
var db = require('../util/db');

router.post('/login', function(req, res, next) {
  db.withClient(function(client) {
    return user.login(req, res, client, req.body['username'], req.body['password'])
      .then(function(user) {
        res.json({ 
          success: true,
          cloudId: user.cloud_id,
          authToken: user.auth_token 
        });
      });
  }).catch(function(error) {
    res.json({ 
      success: false,
      error: error.message 
    });
  });
});


module.exports = router;
