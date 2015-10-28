var fs = require("fs");

var data = fs.readFileSync('c:/users/tj/desktop/mig/mig.txt');
var decoded = JSON.parse(data);
data = null;

var todo = fs.readFileSync("done.txt", {encoding:"utf8"});

var skip_list = todo.split("\n");
var skip = {};
for(var i = 0; i < skip_list.length; ++i)
	skip[skip_list[i]] = 1;
var filtered = [];
for (var i = 0; i < decoded.length; ++i) {
	if(decoded[i].Phone.indexOf('+593') == 0)
		continue;
	if(decoded[i].Phone.indexOf('+61') == 0)
		continue;
	if(decoded[i].Phone.indexOf('+380') == 0)
		continue;
	if(decoded[i].Phone.indexOf('+49') == 0)
		continue;
	if(decoded[i].Phone.indexOf('+66') == 0)
		continue;
	if(decoded[i].Phone.indexOf('+86') == 0)
		continue;
	if(decoded[i].Phone.indexOf('+55') == 0)
		continue;
	if(decoded[i].Phone in skip)
		continue;
	filtered.push(decoded[i]);
}

function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex ;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}
shuffle(filtered);

console.log(filtered.length);

var om = require('../../lib/om');
var ourcrypto = require('../../lib/crypto')
var connection = require('../../lib/connection');

var assert = om.assert;
var counter = 0;
var fails = 0;
var success = 0;
function next() {
	var entry = filtered.shift();
    ++counter;
        
    console.log("started " + counter + " failed " + fails + " success " + success + " remaining " + filtered.length);
	console.log(entry);

	var private_key = new om.Buffer(entry.Key, "base64");
	var c = new connection.Connection("idp", "/device", om.client.DefaultConfiguration, private_key);
    c._verbose = function() {}
    c._warn = function() {}
	c.enable();
	
	var lr = new om.proto.LDCheckIdentityLinkedRequest();
	lr.RequestedCluster = entry.Cluster;
	c.call(lr, done.bind(this, lr, entry, c));
}
function done(lr, entry, c, e, resp) {
	if(e) {
        if(!entry.Errors)
            entry.Errors = 0;
        entry.Errors++;
		console.log("==================="+ entry.Errors + " " + entry.Errors + "====================");
        console.log(e);
		console.log("===================*******====================");
        if(entry.Errors < 3) {
            c.call(lr, done.bind(this, lr, entry, c));
        } else {
            c.disable();
            next();
            ++fails;
        }
	} else {
		fs.appendFileSync("done.txt", entry.Phone + "\n");
        ++success;
	    console.log(resp);
		c.disable();
		next();
	}
}
next();
