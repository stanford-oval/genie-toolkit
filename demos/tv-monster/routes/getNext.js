var fs = require('fs');
var express = require('express');
var router = express.Router();
var crypto = require('crypto');

var movieDBPath = './db/movies.json';

/* GET home page. */
router.get('/', function(req, res, next) {
    res.render('getNext', { title: '' });
});

router.post('/', function(req, res) {
  console.log(req.body);

  try {    
    var movies = loadMoviesFromDB();

    if(Object.keys(movies).length)
    {
      var movieEntry = pickRandomProperty(movies);
      res.status(200);
      res.end(JSON.stringify(movieEntry, null, 4));
    }
    else
    {
      console.log('Empty movie entries');
      res.status(404);
      res.end();
    }

  } catch (e) {
    console.log('Error getting next movie ' + e);
    res.status(500);
    res.end();
  }
});


function pickRandomProperty(obj) {
  var keys = Object.keys(obj)
  return obj[keys[ keys.length * Math.random() >>> 0]];
}








function saveMoviesToDB(movies) {
  var data = JSON.stringify(movies, null, 4);
  fs.writeFileSync(movieDBPath, data, 'utf-8');
}

function loadMoviesFromDB() {
  //console.log('process.cwd(): ' + process.cwd());
  try {
    var data = fs.readFileSync(movieDBPath);
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}



module.exports = router;
