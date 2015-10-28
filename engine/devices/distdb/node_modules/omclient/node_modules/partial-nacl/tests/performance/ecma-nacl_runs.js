/**
 * This script makes timed runs in node.
 */

var randomBytes = require('crypto').randomBytes;
var boxes = require('../../lib/ecma-nacl');
var sbox = boxes.secret_box;
var box = boxes.box;
var compareVectors = boxes.compareVectors;
var assert = require('assert');

function getRandom(numOfBytes) {
	return new Uint8Array(randomBytes(numOfBytes));
}

function timeBoxPubKeyGeneration(numOfRuns) {
	"use strict";
	var sk1 = getRandom(32);
	console.log("Do calculation of a public key for a given secret key.\n" +
			"Calculations are performed "+numOfRuns+" times, to provide an average time.");
	var startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		box.generate_pubkey(sk1);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\taverage: "+diff.toFixed(3)+" milliseconds");
}

timeBoxPubKeyGeneration(10);
console.log();

function timeBoxEncryption(numOfRuns, msgKs) {
	"use strict";
	var sk1 = getRandom(32);
	var pk1 = box.generate_pubkey(sk1);
	var sk2 = getRandom(32);
	var pk2 = box.generate_pubkey(sk2);
	var nonce = getRandom(24);
	var msg = getRandom(msgKs*1024);
	var cipher, recoveredMsg;

	console.log("Do public key encryption of "+msgKs+"KB of message.\n" +
			"Calculations are performed "+numOfRuns+" times, to provide an average time.");
	var startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		cipher = box.pack(msg, nonce, pk2, sk1);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\taverage for packing: "+diff.toFixed(3)+" milliseconds");
	startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		recoveredMsg = box.open(cipher, nonce, pk1, sk2);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\taverage for opening: "+diff.toFixed(3)+" milliseconds");
	assert.ok(compareVectors(msg, recoveredMsg), "Message was incorrectly decrypted.");
}

timeBoxEncryption(10, 4);
timeBoxEncryption(10, 40);
console.log();

function timeSecretBoxEncryption(numOfRuns, msgKs) {
	"use strict";
	var k = getRandom(32);
	var nonce = getRandom(24);
	var msg = getRandom(msgKs*1024);
	var cipher, recoveredMsg;

	console.log("Do secret key encryption of "+msgKs+"KB of message.\n" +
			"Calculations are performed "+numOfRuns+" times, to provide an average time.");
	var startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		cipher = sbox.pack(msg, nonce, k);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\taverage for packing: "+diff.toFixed(3)+" milliseconds");
	startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		recoveredMsg = sbox.open(cipher, nonce, k);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\taverage for opening: "+diff.toFixed(3)+" milliseconds");
	assert.ok(compareVectors(msg, recoveredMsg), "Message was incorrectly decrypted.");
}

timeSecretBoxEncryption(1000, 1);
timeSecretBoxEncryption(3, 1024);
console.log();
