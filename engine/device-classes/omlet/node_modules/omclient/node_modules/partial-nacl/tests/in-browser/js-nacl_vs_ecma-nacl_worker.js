if ('undefined' !== typeof window) { throw new Error(
		"This script is for web worker, and should not be loaded directly."); }

importScripts("./ecma-nacl_browserified.js");
// js-nacl can be attached either into window object (not here), or module, which we fake here.
importScripts("nacl_factory.js");
var js_nacl = nacl_factory.instantiate()
, ecmaNacl = require('ecma-nacl');

self.addEventListener('message', function(e) {
	switch (e.data.cmd) {
	case "boxEnc":
		boxEnc(e.data);
		break;
	case "secretBoxEnc":
		secretBoxEnc(e.data);
		break;
	default:
		throw new Error("Command "+e.data.cmd+" is not known to worker.");
	}
});

function boxEnc(data) {
	"use strict";
	var numOfRuns = data.numOfRuns
	, box = ecmaNacl.box;

	var sk1 = new Uint8Array(data.sk1)
	, sk2 = new Uint8Array(data.sk2);
	var pk1 = box.generate_pubkey(sk1)
	, pk2 = box.generate_pubkey(sk2)
	, nonce = new Uint8Array(data.nonce)
	, msg = new Uint8Array(data.msg)
	, cipher1, cipher2, recoveredMsg;

	self.postMessage({ logMsg: "Do public key encryption of "+(msg.length/1024)+"KB of message.\n"+
		"Calculations are performed "+numOfRuns+" times, to provide an average time." });
	
	// ecma-nacl encryption 
	var millis = Date.now();
	for ( var i = 0; i < numOfRuns; i += 1) {
		cipher1 = box.pack(msg, nonce, pk2, sk1);
	}
	millis = (Date.now() - millis)/numOfRuns;
	self.postMessage({ logMsg: "\tecma-nacl average for packing: "+millis.toFixed(3)+" milliseconds" });
	
	// js-nacl encryption
	millis = Date.now();
	for ( var i = 0; i < numOfRuns; i += 1) {
		cipher2 = js_nacl.crypto_box(msg, nonce, pk2, sk1);
	}
	millis = (Date.now() - millis)/numOfRuns;
	self.postMessage({ logMsg: "\js-nacl average for packing: "+millis.toFixed(3)+" milliseconds" });
	
	if(!ecmaNacl.compareVectors(cipher1, cipher2)) { throw new Error(
			"Resulting ciphers are incompatible."); }

	// ecma-nacl decryption
	millis = Date.now();
	for ( var i = 0; i < numOfRuns; i += 1) {
		recoveredMsg = box.open(cipher1, nonce, pk1, sk2);
	}
	millis = (Date.now() - millis)/numOfRuns;
	if (!ecmaNacl.compareVectors(msg, recoveredMsg)) {
		throw new Error("Message was incorrectly decrypted.");
	}
	self.postMessage({
		logMsg: "\tecma-nacl average for opening: "+millis.toFixed(3)+" milliseconds" });

	// js-nacl decryption
	millis = Date.now();
	for ( var i = 0; i < numOfRuns; i += 1) {
		recoveredMsg = js_nacl.crypto_box_open(cipher1, nonce, pk1, sk2);
	}
	millis = (Date.now() - millis)/numOfRuns;
	if (!ecmaNacl.compareVectors(msg, recoveredMsg)) {
		throw new Error("Message was incorrectly decrypted.");
	}
	self.postMessage({
		logMsg: "\tjs-nacl average for opening: "+millis.toFixed(3)+" milliseconds",
		done: true });

}

//TODO redo things below for comparison runs

function secretBoxEnc(data) {
	"use strict";
	var numOfRuns = data.numOfRuns
	, sbox = ecmaNacl.secret_box;

	var k = new Uint8Array(data.key)
	, nonce = new Uint8Array(data.nonce)
	, msg = new Uint8Array(data.msg)
	, cipher1, cipher2, recoveredMsg;

	self.postMessage({ logMsg: "Do secret key encryption of "+(msg.length/1024)+"KB of message.\n"+
		"Calculations are performed "+numOfRuns+" times, to provide an average time." });
	
	// ecma-nacl encryption
	var millis = Date.now();
	for ( var i = 0; i < numOfRuns; i += 1) {
		cipher1 = sbox.pack(msg, nonce, k);
	}
	millis = (Date.now() - millis)/numOfRuns;
	self.postMessage({ logMsg: "\tecma-nacl average for packing: "+millis.toFixed(3)+" milliseconds" });
	
	// js-nacl encryption
	millis = Date.now();
	for ( var i = 0; i < numOfRuns; i += 1) {
		cipher2 = js_nacl.crypto_secretbox(msg, nonce, k);
	}
	millis = (Date.now() - millis)/numOfRuns;
	self.postMessage({ logMsg: "\tjs-nacl average for packing: "+millis.toFixed(3)+" milliseconds" });
	
	if(!ecmaNacl.compareVectors(cipher1, cipher2)) { throw new Error(
			"Resulting ciphers are incompatible."); }
	
	// ecma-nacl decryption
	millis = Date.now();
	for ( var i = 0; i < numOfRuns; i += 1) {
		recoveredMsg = sbox.open(cipher1, nonce, k);
	}
	millis = (Date.now() - millis)/numOfRuns;
	if (!ecmaNacl.compareVectors(msg, recoveredMsg)) {
		throw new Error("Message was incorrectly decrypted.");
	}
	self.postMessage({
		logMsg: "\tecma-nacl average for opening: " + millis.toFixed(3) + " milliseconds" });
	
	// js-nacl decryption
	millis = Date.now();
	for ( var i = 0; i < numOfRuns; i += 1) {
		recoveredMsg = js_nacl.crypto_secretbox_open(cipher1, nonce, k);
	}
	millis = (Date.now() - millis)/numOfRuns;
	if (!ecmaNacl.compareVectors(msg, recoveredMsg)) {
		throw new Error("Message was incorrectly decrypted.");
	}
	self.postMessage({
		logMsg: "\tjs-nacl average for opening: " + millis.toFixed(3) + " milliseconds",
		done: true });
}
