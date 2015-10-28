var om = require('../lib/om');
var ourcrypto = require('../lib/crypto')
var connection = require('../lib/connection');

var assert = om.assert;

var private_key = ourcrypto.createPrivateKey();;
var connection = new connection.Connection("THREE", "/device", om.client.DefaultConfiguration, private_key);
connection._monitoring = true;
connection.enable();

var count = 100;
var timeoutCount = 100;

function next(lastRtt) {
	var start = new Date().getTime();
	connection.sendPing(1000 * 5 * 60, undefined, function(error, ip, millis) {
		if(error && error.error == "NotConnected" && --timeoutCount >= 0) {
			setTimeout(next, 100);
			return;
		}
		assert.ifError(error);
		lastRtt = new Date().getTime() - start;
		console.log("pong me " + ip + " server ts " + millis + " rtt " + lastRtt);
		if(count-- <= 0) {
			console.log("done");
			connection.disable();
			return;
		}
		next(lastRtt);
	});
}

next();