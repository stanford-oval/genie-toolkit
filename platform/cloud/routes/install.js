var http = require('http');
const user = require('../util/user');

module.exports = function(app){

	app.install = {url: null};

	app.get("/", function(req, res) {
		res.render('home');
	});

	app.get("/install", function(req, res) {
		res.render('install', {downloaded: false});
	});

	app.get("/install/rule/:rule", function(req, res) {
		var rule = JSON.parse(req.params.rule);

		res.render('install', {name: rule.name, url: rule.id, downloaded: false});
		console.log('rule id: ', rule.id);
		app.install.id= rule.id;
	});

	app.get("/install/agree", user.redirectLogIn, function(req, res) {
		if (!app.install.id) {
			res.render('install', {name: "Sorry: null pointer error"});
		};

		http.get("https://thingpedia.stanford.edu/rules/" + app.install.id, function(response) {
		    //another chunk of data has been recieved, so append it to `str`
		  	var code = '';
			response.on('data', function (chunk) {
				code += chunk;
			});

			//the whole response has been recieved, so we just print it out here
			response.on('end', function () {
			  	res.render('install', {name: null, url: null, downloaded: true, code: code});
			});

			/*
			var options = {
			  	host: 'https://thingpedia.stanford.edu/rules' + app.install.url,
			  	method: 'GET'
			};

			callback = function(response) {
			  var str = '';

			  //another chunk of data has been recieved, so append it to `str`
			  response.on('data', function (chunk) {
			    str += chunk;
			  });

			  //the whole response has been recieved, so we just print it out here
			  response.on('end', function () {
			    console.log('end', str);
			  });
			}

			http.request(options, callback).end();
			*/
			app.install.url = null;
		});
	})
}
