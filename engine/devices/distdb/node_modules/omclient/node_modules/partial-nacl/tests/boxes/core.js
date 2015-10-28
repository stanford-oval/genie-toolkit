/**
 * Testing module lib/boxes/core.js
 */

var core = require('../../lib/boxes/core');
var arrFactory = new (require('../../lib/util/arrays'))();
var verify = require('../../lib/util/verify');
var assert = require('assert');

function compare(v,expectation) {
	assert.strictEqual(v.length, expectation.length);
	assert.ok(verify.verify(v, expectation, v.length));
}

/**
 * Analog of tests/core1.c, expected result printed in tests/core1.out;
 * and analog of tests/core2.c, expected result printed in tests/core2.out
 */
(function() {
	"use strict";
	console.log("Testing of 'core.hsalsa20', analog to tests/core1.c");
	
	var shared = arrFactory.getUint8Array(32);
	shared.set([ 0x4a,0x5d,0x9d,0x5b,0xa4,0xce,0x2d,0xe1,
	             0x72,0x8e,0x3b,0xf4,0x80,0x35,0x0f,0x25,
	             0xe0,0x7e,0x21,0xc9,0x47,0xd1,0x9e,0x33,
	             0x76,0xf0,0x9b,0x3c,0x1e,0x16,0x17,0x42 ]);
	
	var zero = arrFactory.getUint8Array(16);	// original has 32 bytes, but 16 are used by crypto_core_hsalsa20
	
	var c = arrFactory.getUint8Array(16);
	c.set([ 0x65,0x78,0x70,0x61,0x6e,0x64,0x20,0x33,
	        0x32,0x2d,0x62,0x79,0x74,0x65,0x20,0x6b ]);
	
	var firstkey = new Uint8Array(32);
	
	core.hsalsa20(firstkey,zero,shared,c,arrFactory);	// writes result into firstkey
	
	// taken from tests/core1.out
	compare(firstkey, [ 0x1b,0x27,0x55,0x64,0x73,0xe9,0x85,0xd4,
	                    0x62,0xcd,0x51,0x19,0x7a,0x9a,0x46,0xc7,
	                    0x60,0x09,0x54,0x9e,0xac,0x64,0x74,0xf2,
	                    0x06,0xc4,0xee,0x08,0x44,0xf6,0x83,0x89 ]);
	console.log("PASS.\n");

	console.log("Testing of 'core.hsalsa20', analog to tests/core2.c");
	
	var  nonceprefix = arrFactory.getUint8Array(16);
	nonceprefix.set([ 0x69,0x69,0x6e,0xe9,0x55,0xb6,0x2b,0x73,
	                  0xcd,0x62,0xbd,0xa8,0x75,0xfc,0x73,0xd6 ]);
	
	var secondkey = arrFactory.getUint8Array(32);
	
	core.hsalsa20(secondkey,nonceprefix,firstkey,c,arrFactory);
	
	// taken from tests/core2.out
	compare(secondkey, [ 0xdc,0x90,0x8d,0xda,0x0b,0x93,0x44,0xa9,
	                     0x53,0x62,0x9b,0x73,0x38,0x20,0x77,0x88,
	                     0x80,0xf3,0xce,0xb4,0x21,0xbb,0x61,0xb9,
	                     0x1c,0xbd,0x4c,0x3e,0x66,0x25,0x6c,0xe4 ]);
	console.log("PASS.\n");
	
	arrFactory.recycle(firstkey, nonceprefix, c, zero, secondkey, shared);
	arrFactory.wipeRecycled();
})();

/**
 * Analog of tests/core4.c, expected result printed in tests/core4.out
 */
(function() {
	"use strict";
	console.log("Testing of 'core.salsa20', analog to tests/core4.c");
	
	var k = arrFactory.getUint8Array(32);
	k.set([   1,  2,  3,  4,  5,  6,  7,  8,
	          9, 10, 11, 12, 13, 14, 15, 16,
	        201,202,203,204,205,206,207,208,
	        209,210,211,212,213,214,215,216 ]);
	
	var inArr = arrFactory.getUint8Array(16);
	inArr.set([ 101,102,103,104,105,106,107,108,
	            109,110,111,112,113,114,115,116 ]);
	
	var c = arrFactory.getUint8Array(16);
	c.set([ 101,120,112, 97,110,100, 32, 51,
	         50, 45, 98,121,116,101, 32,107 ]);
	
	var outArr = arrFactory.getUint8Array(64);
	
	core.salsa20(outArr,inArr,k,c,arrFactory);
	
	// taken from tests/core4.out
	compare(outArr, [  69, 37, 68, 39, 41, 15,107,193,
	                  255,139,122,  6,170,233,217, 98,
	                   89,144,182,106, 21, 51,200, 65,
	                  239, 49,222, 34,215,114, 40,126,
	                  104,197,  7,225,197,153, 31,  2,
	                  102, 78, 76,176, 84,245,246,184,
	                  177,160,133,130,  6, 72,149,119,
	                  192,195,132,236,234,103,246, 74 ]);
	console.log("PASS.\n");
	
	arrFactory.recycle(k, inArr, c, outArr);
	arrFactory.wipeRecycled();
})();

/**
 * Analog of tests/core5.c, expected result printed in tests/core5.out
 */
(function() {
	"use strict";
	console.log("Testing of 'core.hsalsa20', analog to tests/core5.c");
	
	var k = arrFactory.getUint8Array(32);
	k.set([ 0xee,0x30,0x4f,0xca,0x27,0x00,0x8d,0x8c,
	        0x12,0x6f,0x90,0x02,0x79,0x01,0xd8,0x0f,
	        0x7f,0x1d,0x8b,0x8d,0xc9,0x36,0xcf,0x3b,
	        0x9f,0x81,0x96,0x92,0x82,0x7e,0x57,0x77 ]);
	
	var inArr = arrFactory.getUint8Array(16);
	inArr.set([ 0x81,0x91,0x8e,0xf2,0xa5,0xe0,0xda,0x9b,
	            0x3e,0x90,0x60,0x52,0x1e,0x4b,0xb3,0x52 ]);
	
	var c = arrFactory.getUint8Array(16);
	c.set([ 101,120,112, 97,110,100, 32, 51,
	         50, 45, 98,121,116,101, 32,107 ]);
	
	var outArr = arrFactory.getUint8Array(32);
	
	core.hsalsa20(outArr,inArr,k,c,arrFactory);
	
	// taken from tests/core5.out
	compare(outArr, [ 0xbc,0x1b,0x30,0xfc,0x07,0x2c,0xc1,0x40,
	                  0x75,0xe4,0xba,0xa7,0x31,0xb5,0xa8,0x45,
	                  0xea,0x9b,0x11,0xe9,0xa5,0x19,0x1f,0x94,
	                  0xe1,0x8c,0xba,0x8f,0xd8,0x21,0xa7,0xcd ]);
	console.log("PASS.\n");
	
	arrFactory.recycle(outArr, inArr, k, c);
	arrFactory.wipeRecycled();
})();

arrFactory.clear();