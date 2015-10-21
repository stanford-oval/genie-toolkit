var fs = require('fs');
var express = require('express');
var router = express.Router();
var crypto = require('crypto');

var movieDBPath = './db/movies.json';

/* GET home page. */
router.get('/', function(req, res, next) {
    res.render('add', { title: '' });
});

router.post('/', function(req, res) {
  console.log(req.body);

  try {    
    var movieEntry = req.body;
    var movies = loadMoviesFromDB();
    console.log('movies ' + movies);

    if(movies[movieEntry.url])
    {
      console.log('Movie entry already exist');
      res.status(500);
      res.end();
    }
    else
    {
        movies[movieEntry.url] = movieEntry;
        saveMoviesToDB(movies);
        res.status(200);
        res.end();
    }

  } catch (e) {
    console.log('Error saving movie');
    res.status(500);
    res.end();
  }
});








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
