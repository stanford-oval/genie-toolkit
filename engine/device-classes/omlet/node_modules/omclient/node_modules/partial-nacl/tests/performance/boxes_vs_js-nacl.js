/**
 * This is a speed comparison test of boxes with those in js-nacl (Emscripten compiled C NaCl),
 * all set to run in the same node instance.
 * Make sure to have js-nacl module available to satisfy this script's requirement.
 */

try {
	var js_nacl = require('js-nacl').instantiate();
} catch (err) {
	console.log("To run this performance comparison, js-nacl should be accessable with require()");
}
var randomBytes = require('crypto').randomBytes;
var boxes = require('../../lib/ecma-nacl');
var sbox = boxes.secret_box;
var box = boxes.box;
var compareVectors = boxes.compareVectors;
var assert = require('assert');

function getRandom(numOfBytes) {
	return new Uint8Array(randomBytes(numOfBytes));
}

function boxEncryption(numOfRuns, msgKs) {
	"use strict";
	var js_nacl_gen_keys = js_nacl.crypto_box_keypair();
	var sk1 = js_nacl_gen_keys.boxSk;
	var pk1 = js_nacl_gen_keys.boxPk;
	if(!compareVectors(pk1, box.generate_pubkey(sk1))) { throw new Error(
			"Generation of keys is incompatible."); }
	var sk2 = getRandom(32);
	var pk2 = box.generate_pubkey(sk2);
	var nonce = getRandom(24);
	var msg = getRandom(msgKs*1024);
	var cipher1, cipher2, recoveredMsg;

	console.log("Do public key encryption of "+msgKs+"KB of message.\n" +
			"Calculations are performed "+numOfRuns+" times, to provide an average time.");

	// ecma-nacl encryption
	var startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		cipher1 = box.pack(msg, nonce, pk2, sk1);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\tecma-nacl average for packing: "+diff.toFixed(3)+" milliseconds");
	
	// js-nacl encryption
	startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		cipher2 = js_nacl.crypto_box(msg, nonce, pk2, sk1);
	}
	diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\tjs-nacl average for packing: "+diff.toFixed(3)+" milliseconds");
	
	assert.ok(compareVectors(cipher1, cipher2), "Resulting ciphers are incompatible.");
	
	// ecma-nacl decryption
	startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		recoveredMsg = box.open(cipher1, nonce, pk1, sk2);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\tecma-nacl average for opening: "+diff.toFixed(3)+" milliseconds");
	assert.ok(compareVectors(msg, recoveredMsg), "Message was incorrectly decrypted.");
	
	// js-nacl decryption
	startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		recoveredMsg = js_nacl.crypto_box_open(cipher1, nonce, pk1, sk2);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\tjs-nacl average for opening: "+diff.toFixed(3)+" milliseconds");
	assert.ok(compareVectors(msg, recoveredMsg), "Message was incorrectly decrypted.");
}

boxEncryption(10, 4);
boxEncryption(10, 40);
console.log();

function secretBoxEncryption(numOfRuns, msgKs) {
	"use strict";
	var k = getRandom(32);
	var nonce = getRandom(24);
	var msg = getRandom(msgKs*1024);
	var cipher1, cipher2, recoveredMsg;

	console.log("Do secret key encryption of "+msgKs+"KB of message.\n" +
			"Calculations are performed "+numOfRuns+" times, to provide an average time.");

	// ecma-nacl encryption
	var startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		cipher1 = sbox.pack(msg, nonce, k);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\tecma-nacl average for packing: "+diff.toFixed(3)+" milliseconds");
	
	// js-nacl encryption
	startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		cipher2 = js_nacl.crypto_secretbox(msg, nonce, k);
	}
	diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\tjs-nacl average for packing: "+diff.toFixed(3)+" milliseconds");
	
	assert.ok(compareVectors(cipher1, cipher2), "Resulting ciphers are incompatible.");
	
	// ecma-nacl decryption
	startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		recoveredMsg = sbox.open(cipher1, nonce, k);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\tecma-nacl average for opening: "+diff.toFixed(3)+" milliseconds");
	assert.ok(compareVectors(msg, recoveredMsg), "Message was incorrectly decrypted.");
	
	// js-nacl decryption
	startTime = process.hrtime();
	for (var i=0; i<numOfRuns; i+=1) {
		recoveredMsg = js_nacl.crypto_secretbox_open(cipher1, nonce, k);
	}
	var diff = process.hrtime(startTime);
	diff = (diff[0]*1e9 + diff[1]) / numOfRuns / 1e6;
	console.log("\tjs-nacl average for opening: "+diff.toFixed(3)+" milliseconds");
	assert.ok(compareVectors(msg, recoveredMsg), "Message was incorrectly decrypted.");
}

secretBoxEncryption(1000, 1);
secretBoxEncryption(3, 1024);
console.log();
