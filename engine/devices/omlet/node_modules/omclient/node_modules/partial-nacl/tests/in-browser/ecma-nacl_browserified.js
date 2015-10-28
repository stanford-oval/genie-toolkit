require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/* Copyright(c) 2013-2014 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

var ArraysFactory = require('../util/arrays');
var sm = require('./scalarmult');
var core = require('./core');
var sbox = require('./secret_box');
var SIGMA = require('./stream').SIGMA;

/**
 * Replacement of crypto_box_keypair in crypto_box/curve25519xsalsa20poly1305/ref/keypair.c
 * Public key can be generated for any given secret key, which itself should be randomly generated.
 * @param sk is Uint8Array of 32 bytes of a secret key.
 * @returns Uint8Array with 32 bytes of a public key, that corresponds given secret key. 
 */
function generate_pubkey(sk) {
	"use strict";
	if (sk.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Key array k must be Uint8Array."); }
	if (sk.length !== 32) { throw new Error(
			"Key array sk should have 32 elements (bytes) in it, but it is "+
			sk.length+" elements long."); }
	var pk = new Uint8Array(32);
	sm.curve25519_base(pk,sk);
	return pk;
}

/**
 * n array in crypto_box/curve25519xsalsa20poly1305/ref/before.c
 */
var n_to_calc_dhshared_key = new Uint8Array(16);

/**
 * Analog of crypto_box_beforenm in crypto_box/curve25519xsalsa20poly1305/ref/before.c
 * @param pk is Uint8Array, 32 items long.
 * @param sk is Uint8Array, 32 items long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 * @returns Uint8Array with 32 bytes of stream key for the box, under given public and secret keys.
 */
function calc_dhshared_key(pk, sk, arrFactory) {
	"use strict";
	if (pk.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Public key array pk must be Uint8Array."); }
	if (pk.length !== 32) { throw new Error(
			"Public key array pk should have 32 elements (bytes) in it, but it is "+
			pk.length+" elements long."); }
	if (sk.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Secret key array sk must be Uint8Array."); }
	if (sk.length !== 32) { throw new Error(
			"Secret key array sk should have 32 elements (bytes) in it, but it is "+
			sk.length+" elements long."); }
	if (!arrFactory) {
		arrFactory = new ArraysFactory();
	}
	var s = new Uint8Array(32);
	sm.curve25519(s, sk, pk, arrFactory);
	core.hsalsa20(s, n_to_calc_dhshared_key, s, SIGMA, arrFactory);
	return s;
}

/**
 * Analog of crypto_box in crypto_box/curve25519xsalsa20poly1305/ref/box.c
 * @param m is Uint8Array of message bytes that need to be encrypted by secret key.
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param pk is Uint8Array, 32 bytes long public key of message receiving party.
 * @param sk is Uint8Array, 32 bytes long secret key of message sending party.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 * @return Uint8Array with resulting cipher of incoming message, packaged according to
 * NaCl's xsalsa20+poly1305 secret-box bytes layout, trimmed of initial zeros.
 */
function pack_box(m, n, pk, sk, arrFactory) {
	"use strict";
	var k = calc_dhshared_key(pk, sk, arrFactory);
	return sbox.pack(m, n, k, arrFactory);
}

/**
 * Analog of crypto_box_open in crypto_box/curve25519xsalsa20poly1305/ref/box.c
 * @param c is Uint8Array of cipher bytes that need to be opened.
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param pk is Uint8Array, 32 bytes long public key of message receiving party.
 * @param sk is Uint8Array, 32 bytes long secret key of message sending party.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 * @return Uint8Array with decrypted message bytes.
 * Array is a view of buffer, which has 32 zeros preceding message bytes.
 * @throws Error when cipher bytes fail verification.
 */
function open_box(c, n, pk, sk, arrFactory) {
	"use strict";
	var k = calc_dhshared_key(pk, sk, arrFactory);
	return sbox.open(c, n, k, arrFactory);
}

var stream = {
		pack: sbox.pack,
		open: sbox.open
};
Object.freeze(stream);

/**
 * @param m is Uint8Array of message bytes that need to be encrypted by secret key.
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param pk is Uint8Array, 32 bytes long public key of message receiving party.
 * @param sk is Uint8Array, 32 bytes long secret key of message sending party.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 * @returns Uint8Array, where nonce is packed together with cipher.
 * Length of the returned array is 40 bytes greater than that of a message.
 */
function packWithNonce(m, n, pk, sk, arrFactory) {
	var k = calc_dhshared_key(pk, sk, arrFactory);
	return sbox.formatWN.pack(m, n, k, arrFactory);
}

/**
 * @param c is Uint8Array with nonce and cipher bytes that need to be opened by secret key.
 * @param pk is Uint8Array, 32 bytes long public key of message receiving party.
 * @param sk is Uint8Array, 32 bytes long secret key of message sending party.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 * @return Uint8Array with decrypted message bytes.
 * Array is a view of buffer, which has 32 zeros preceding message bytes.
 */
function openWithNonce(c, pk, sk, arrFactory) {
	var k = calc_dhshared_key(pk, sk, arrFactory);
	return sbox.formatWN.open(c, k, arrFactory);
}

/**
 * 
 * @param pk is Uint8Array, 32 bytes long public key of message receiving party.
 * @param sk is Uint8Array, 32 bytes long secret key of message sending party.
 * @param nextNonce is nonce, which should be used for the very first packing.
 * All further packing will be done with new nonce, as it is automatically evenly advanced.
 * Note that nextNonce will be copied.
 * @return a frozen object with pack & open functions, and destroy
 * It is NaCl's secret box for a calculated DH-shared key, with automatically evenly
 * advancing nonce.
 */
function makeEncryptor(pk, sk, nextNonce) {
	var k = calc_dhshared_key(pk, sk)
	, enc = sbox.formatWN.makeEncryptor(k, nextNonce);
	ArraysFactory.prototype.wipe(k);
	return enc;
}

var formatWN = {
		pack: packWithNonce,
		open: openWithNonce,
		copyNonceFrom: sbox.formatWN.copyNonceFrom,
		makeEncryptor: makeEncryptor
};
Object.freeze(formatWN);

module.exports = {
		generate_pubkey: generate_pubkey,
		calc_dhshared_key: calc_dhshared_key,
		stream: stream,
		pack: pack_box,
		open: open_box,
		formatWN: formatWN,
		NONCE_LENGTH: 24,
		KEY_LENGTH: 32,
		JWK_ALG_NAME: 'NaCl-box-CXSP'
};
Object.freeze(module.exports);

},{"../util/arrays":10,"./core":2,"./scalarmult":4,"./secret_box":5,"./stream":6}],2:[function(require,module,exports){
/* Copyright(c) 2013 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Analog of load_littleendian in crypto_core/salsa20/ref/core.c
 * @param x is Uint8Array, from which 4-byte number is loaded.
 * @param i is a position, at which 4-byte loading starts.
 * @returns number within uint32 limits, loaded in a littleendian manner from a given array.
 */
function load_littleendian(x, i) {
	"use strict";
	return x[i] | (x[i+1] << 8) | (x[i+2] << 16) | (x[i+3] << 24);
}

/**
 * Analog of store_littleendian in crypto_core/salsa20/ref/core.c
 * @param x is Uint8Array, into which 4-byte number is inserted.
 * @param i is a position, at which 4-byte insertion starts.
 * @param u is a number within uint32 limits, to be stored/inserted in a manner, compatible
 * with above loading function.
 */
function store_littleendian(x, i, u) {
	"use strict";
	  x[i] = u; u >>>= 8;
	x[i+1] = u; u >>>= 8;
	x[i+2] = u; u >>>= 8;
	x[i+3] = u;
}

/**
 * Analog of crypto_core in crypto_core/salsa20/ref/core.c
 * It makes nicer, shorter code to have variables of this function sitting in one array,
 * but expanded version runs faster.
 * We also inserted rotate() function from the original source.
 * @param outArr is Uint8Array, 64 bytes long, into which result is placed.
 * @param inArr is Uint8Array, 16 bytes long, of incoming bytes.
 * @param k is Uint8Array, 32 bytes long.
 * @param c is Uint8Array, 16 bytes long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 */
function salsa20(outArr, inArr, k, c, arrFactory) {
	"use strict";

	var x0 = load_littleendian(c, 0)
	,   j0 = x0
	,   x1 = load_littleendian(k, 0)
	,   j1 = x1
	,   x2 = load_littleendian(k, 4)
	,   j2 = x2
	,   x3 = load_littleendian(k, 8)
	,   j3 = x3
	,   x4 = load_littleendian(k, 12)
	,   j4 = x4
	,   x5 = load_littleendian(c, 4)
	,   j5 = x5
	,   x6 = load_littleendian(inArr, 0)
	,   j6 = x6
	,   x7 = load_littleendian(inArr, 4)
	,   j7 = x7
	,   x8 = load_littleendian(inArr, 8)
	,   j8 = x8
	,   x9 = load_littleendian(inArr, 12)
	,   j9 = x9
	,  x10 = load_littleendian(c, 8)
	,  j10 = x10
	,  x11 = load_littleendian(k, 16)
	,  j11 = x11
	,  x12 = load_littleendian(k, 20)
	,  j12 = x12
	,  x13 = load_littleendian(k, 24)
	,  j13 = x13
	,  x14 = load_littleendian(k, 28)
	,  j14 = x14
	,  x15 = load_littleendian(c, 12)
	,  j15 = x15
	, t = 0;
	
	for (var i=20; i>0; i-=2) {
		t = ( x0+x12) & 0xffffffff;
		 x4 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x4+ x0) & 0xffffffff;
		 x8 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x8+ x4) & 0xffffffff;
		x12 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = (x12+ x8) & 0xffffffff;
		 x0 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = ( x5+ x1) & 0xffffffff;
		 x9 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x9+ x5) & 0xffffffff;
		x13 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = (x13+ x9) & 0xffffffff;
		 x1 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x1+x13) & 0xffffffff;
		 x5 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = (x10+ x6) & 0xffffffff;
		x14 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = (x14+x10) & 0xffffffff;
		 x2 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x2+x14) & 0xffffffff;
		 x6 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x6+ x2) & 0xffffffff;
		x10 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = (x15+x11) & 0xffffffff;
		 x3 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x3+x15) & 0xffffffff;
		 x7 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x7+ x3) & 0xffffffff;
		x11 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = (x11+ x7) & 0xffffffff;
		x15 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = ( x0+ x3) & 0xffffffff;
		 x1 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x1+ x0) & 0xffffffff;
		 x2 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x2+ x1) & 0xffffffff;
		 x3 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x3+ x2) & 0xffffffff;
		 x0 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = ( x5+ x4) & 0xffffffff;
		 x6 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x6+ x5) & 0xffffffff;
		 x7 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x7+ x6) & 0xffffffff;
		 x4 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x4+ x7) & 0xffffffff;
		 x5 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = (x10+ x9) & 0xffffffff;
		x11 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = (x11+x10) & 0xffffffff;
		 x8 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x8+x11) & 0xffffffff;
		 x9 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x9+ x8) & 0xffffffff;
		x10 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = (x15+x14) & 0xffffffff;
		x12 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = (x12+x15) & 0xffffffff;
		x13 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = (x13+x12) & 0xffffffff;
		x14 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = (x14+x13) & 0xffffffff;
		x15 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
	}

	x0 = (x0 + j0) & 0xffffffff;
	x1 = (x1 + j1) & 0xffffffff;
	x2 = (x2 + j2) & 0xffffffff;
	x3 = (x3 + j3) & 0xffffffff;
	x4 = (x4 + j4) & 0xffffffff;
	x5 = (x5 + j5) & 0xffffffff;
	x6 = (x6 + j6) & 0xffffffff;
	x7 = (x7 + j7) & 0xffffffff;
	x8 = (x8 + j8) & 0xffffffff;
	x9 = (x9 + j9) & 0xffffffff;
	x10 = (x10+j10) & 0xffffffff;
	x11 = (x11+j11) & 0xffffffff;
	x12 = (x12+j12) & 0xffffffff;
	x13 = (x13+j13) & 0xffffffff;
	x14 = (x14+j14) & 0xffffffff;
	x15 = (x15+j15) & 0xffffffff;

	store_littleendian(outArr, 0,x0);
	store_littleendian(outArr, 4,x1);
	store_littleendian(outArr, 8,x2);
	store_littleendian(outArr, 12,x3);
	store_littleendian(outArr, 16,x4);
	store_littleendian(outArr, 20,x5);
	store_littleendian(outArr, 24,x6);
	store_littleendian(outArr, 28,x7);
	store_littleendian(outArr, 32,x8);
	store_littleendian(outArr, 36,x9);
	store_littleendian(outArr, 40,x10);
	store_littleendian(outArr, 44,x11);
	store_littleendian(outArr, 48,x12);
	store_littleendian(outArr, 52,x13);
	store_littleendian(outArr, 56,x14);
	store_littleendian(outArr, 60,x15);
}


/**
 * Analog of crypto_core in crypto_core/hsalsa20/ref2/core.c
 * It makes nicer, shorter code to have variables of this function sitting in one array,
 * but expanded version runs faster.
 * We also inserted rotate() function from the original source.
 * @param outArr is Uint8Array, 32 bytes long, into which result is placed.
 * @param inArr is Uint8Array, 16 bytes long, of incoming bytes.
 * @param k is Uint8Array, 32 bytes long.
 * @param c is Uint8Array, 16 bytes long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 */
function hsalsa20(outArr, inArr, k, c, arrFactory) {
	"use strict";

	var x0 = load_littleendian(c, 0)
	,   x1 = load_littleendian(k, 0)
	,   x2 = load_littleendian(k, 4)
	,   x3 = load_littleendian(k, 8)
	,   x4 = load_littleendian(k, 12)
	,   x5 = load_littleendian(c, 4)
	,   x6 = load_littleendian(inArr, 0)
	,   x7 = load_littleendian(inArr, 4)
	,   x8 = load_littleendian(inArr, 8)
	,   x9 = load_littleendian(inArr, 12)
	,  x10 = load_littleendian(c, 8)
	,  x11 = load_littleendian(k, 16)
	,  x12 = load_littleendian(k, 20)
	,  x13 = load_littleendian(k, 24)
	,  x14 = load_littleendian(k, 28)
	,  x15 = load_littleendian(c, 12)
	, t = 0;

	for (var i=20; i>0; i-=2) {
		t = ( x0+x12) & 0xffffffff;
		 x4 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x4+ x0) & 0xffffffff;
		 x8 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x8+ x4) & 0xffffffff;
		x12 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = (x12+ x8) & 0xffffffff;
		 x0 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = ( x5+ x1) & 0xffffffff;
		 x9 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x9+ x5) & 0xffffffff;
		x13 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = (x13+ x9) & 0xffffffff;
		 x1 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x1+x13) & 0xffffffff;
		 x5 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = (x10+ x6) & 0xffffffff;
		x14 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = (x14+x10) & 0xffffffff;
		 x2 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x2+x14) & 0xffffffff;
		 x6 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x6+ x2) & 0xffffffff;
		x10 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = (x15+x11) & 0xffffffff;
		 x3 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x3+x15) & 0xffffffff;
		 x7 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x7+ x3) & 0xffffffff;
		x11 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = (x11+ x7) & 0xffffffff;
		x15 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = ( x0+ x3) & 0xffffffff;
		 x1 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x1+ x0) & 0xffffffff;
		 x2 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x2+ x1) & 0xffffffff;
		 x3 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x3+ x2) & 0xffffffff;
		 x0 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = ( x5+ x4) & 0xffffffff;
		 x6 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = ( x6+ x5) & 0xffffffff;
		 x7 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x7+ x6) & 0xffffffff;
		 x4 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x4+ x7) & 0xffffffff;
		 x5 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = (x10+ x9) & 0xffffffff;
		x11 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = (x11+x10) & 0xffffffff;
		 x8 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = ( x8+x11) & 0xffffffff;
		 x9 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = ( x9+ x8) & 0xffffffff;
		x10 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
		t = (x15+x14) & 0xffffffff;
		x12 ^= ((t << 7) & 0xffffffff) | (t >>> 25);
		t = (x12+x15) & 0xffffffff;
		x13 ^= ((t << 9) & 0xffffffff) | (t >>> 23);
		t = (x13+x12) & 0xffffffff;
		x14 ^= ((t << 13) & 0xffffffff) | (t >>> 19);
		t = (x14+x13) & 0xffffffff;
		x15 ^= ((t << 18) & 0xffffffff) | (t >>> 14);
	}

	store_littleendian(outArr, 0, x0);
	store_littleendian(outArr, 4, x5);
	store_littleendian(outArr, 8, x10);
	store_littleendian(outArr, 12, x15);
	store_littleendian(outArr, 16, x6);
	store_littleendian(outArr, 20, x7);
	store_littleendian(outArr, 24, x8);
	store_littleendian(outArr, 28, x9);
}

module.exports = {
		salsa20: salsa20,
		hsalsa20: hsalsa20
};
},{}],3:[function(require,module,exports){
/* Copyright(c) 2013 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

var mult32 = require('../util/int32').mult;
var verify = require('../util/verify');

/**
 * Analog of add in crypto_onetimeauth/poly1305/ref/auth.c
 * @param h is array of 17 uint32's.
 * @param c is array of 17 uint32's.
 */
function add(h, c) {
	"use strict";
	var u = 0;
	for (var j= 0; j<17; j+=1) {
		u += h[j] + c[j];
		u &= 0xffffffff;
		h[j] = u & 255;
		u >>>= 8;
	}
}

/**
 * Analog of squeeze in crypto_onetimeauth/poly1305/ref/auth.c
 * @param h is array of 17 uint32's.
 */
function squeeze(h) {
	"use strict";
	var u = 0;
	for (var j=0; j<16; j+=1) {
		u += h[j];
		u &= 0xffffffff;
		h[j] = u & 255;
		u >>>= 8;
	}
	u += h[16];
	u &= 0xffffffff;
	h[16] = u & 3;
	u = 5 * (u >>> 2);	// multiplication by 5 is safe here
	u &= 0xffffffff;
	for (j=0; j<16; j+=1) {
		u += h[j];
		u &= 0xffffffff;
		h[j] = u & 255;
		u >>>= 8;
	}
	u += h[16];
	u &= 0xffffffff;
	h[16] = u;
}

/**
 * minusp array in crypto_onetimeauth/poly1305/ref/auth.c
 */
var minusp = new Uint32Array(17);
minusp.set([ 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 252 ]);

/**
 * Analog of freeze in crypto_onetimeauth/poly1305/ref/auth.c
 * @param h is array of 17 uint32's.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 */
function freeze(h, arrFactory) {
	"use strict";
	var horig = arrFactory.getUint32Array(17);
	horig.set(h);
	add(h, minusp);
	var negative = -(h[16] >> 7);
	negative &= 0xffffffff;
	for (var j=0; j<17; j+=1) {
		h[j] ^= negative & (horig[j] ^ h[j]);
	}
	arrFactory.recycle(horig);
}

/**
 * Analog of mulmod in crypto_onetimeauth/poly1305/ref/auth.c
 * @param h is array of 17 uint32's.
 * @param r is array of 17 uint32's.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 */
function mulmod(h, r, arrFactory) {
	"use strict";
	var hr = arrFactory.getUint32Array(17)
	, u = 0;
	for (var i=0; i<17; i+=1) {
		u = 0;
		for (var j=0; j<=i; j+=1) {
			u += mult32(h[j], r[i - j]);
			u &= 0xffffffff;
		}
		for (var j=i+1; j<17; j+=1) {
			u += 320 * mult32(h[j], r[i + 17 - j]);	// regular multiplication by 320 is safe here
			u &= 0xffffffff;
		}
		hr[i] = u;
	}
	h.set(hr);
	squeeze(h);
	arrFactory.recycle(hr);
}

/**
 * Analog of crypto_onetimeauth in crypto_onetimeauth/poly1305/ref/auth.c
 * @param outArr is Uint8Array, 16 bytes long, into which result is placed.
 * @param inArr is Uint8Array, with incoming bytes, whatever the length there is.
 * @param k is Uint8Array, 32 bytes long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 */
function crypto_onetimeauth(outArr, inArr, k, arrFactory) {
	"use strict";
	var r = arrFactory.getUint32Array(17)
	, h = arrFactory.getUint32Array(17)
	, c = arrFactory.getUint32Array(17)
	, inlen = inArr.length
	, inArrInd = 0;

	r[0] = k[0];
	r[1] = k[1];
	r[2] = k[2];
	r[3] = k[3] & 15;
	r[4] = k[4] & 252;
	r[5] = k[5];
	r[6] = k[6];
	r[7] = k[7] & 15;
	r[8] = k[8] & 252;
	r[9] = k[9];
	r[10] = k[10];
	r[11] = k[11] & 15;
	r[12] = k[12] & 252;
	r[13] = k[13];
	r[14] = k[14];
	r[15] = k[15] & 15;
	r[16] = 0;
	
	for (var j=0; j<17; j+=1) { h[j] = 0; }

	var j = 0;
	while (inlen > 0) {
		for (j=0; j<17; j+=1) {
			c[j] = 0;
		}
		for (j=0; (j < 16) && (j < inlen); j+=1) {
			c[j] = inArr[inArrInd+j];
		}
		c[j] = 1;
		inArrInd += j; inlen -= j;
		add(h, c);
		mulmod(h, r, arrFactory);
	}

	freeze(h, arrFactory);

	for (var j=0; j<16; j+=1) {
		c[j] = k[j + 16];
	}
	c[16] = 0;
	add(h, c);
	for (var j=0; j<16; j+=1) {
		outArr[j] = h[j];
	}
}


/**
 * Analog of crypto_onetimeauth in crypto_onetimeauth/poly1305/ref/verify.c
 * @param h is Uint8Array, 16 bytes long.
 * @param inArr is Uint8Array, with incoming bytes, whatever the length there is.
 * @param k is Uint8Array, 32 bytes long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 */
function crypto_onetimeauth_verify(h, inArr, k, arrFactory) {
	"use strict";
	var correct = arrFactory.getUint8Array(16);
	crypto_onetimeauth(correct, inArr, k, arrFactory);
	var areSame = verify.v16(h, correct);
	arrFactory.recycle(correct);
	return areSame;
}

module.exports = {
		poly1305: crypto_onetimeauth,
		poly1305_verify: crypto_onetimeauth_verify
};
},{"../util/int32":11,"../util/verify":13}],4:[function(require,module,exports){
/* Copyright(c) 2013 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

var ArraysFactory = require('../util/arrays');
var mult32 = require('../util/int32').mult;

/**
 * Analog of add in crypto_scalarmult/curve25519/ref/smult.c
 * @param out is Uint32Array, 32 items long.
 * @param a is Uint32Array, 32 items long.
 * @param b is Uint32Array, 32 items long.
 */
function add(out, a, b){
	"use strict";
	var u = 0;
	for (var j=0; j<31; j+=1) {
		u += a[j] + b[j];
		u &= 0xffffffff;
		out[j] = u & 255;
		u >>>= 8;
	}
	u += a[31] + b[31];
	u &= 0xffffffff;
	out[31] = u;
}

/**
 * Analog of sub in crypto_scalarmult/curve25519/ref/smult.c
 * @param out is Uint32Array, 32 items long.
 * @param a is Uint32Array, 32 items long.
 * @param b is Uint32Array, 32 items long.
 */
function sub(out, a, b) {
	"use strict";
	var u = 218;
	for (var j=0; j<31; j+=1) {
		u += a[j] + 65280 - b[j];
		u &= 0xffffffff;
		out[j] = u & 255;
		u >>>= 8;
	}
	u += a[31] - b[31];
	u &= 0xffffffff;
	out[31] = u;
}

/**
 * Analog of squeeze in crypto_scalarmult/curve25519/ref/smult.c
 * @param a is Uint32Array, 32 items long.
 */
function squeeze(a) {
	"use strict";
	var u = 0;
	for (var j=0; j<31; j+=1) {
		u += a[j];
		u &= 0xffffffff;
		a[j] = u & 255;
		u >>>= 8;
	}
	u += a[31];
	u &= 0xffffffff;
	a[31] = u & 127;
	u = 19 * (u >>> 7);	// multiplication by 19 is safe here
	u &= 0xffffffff;
	for (var j=0; j<31; j+=1) {
		u += a[j];
		u &= 0xffffffff;
		a[j] = u & 255;
		u >>>= 8;
	}
	u += a[31];
	u &= 0xffffffff;
	a[31] = u;
}

/**
 * minusp array in crypto_scalarmult/curve25519/ref/smult.c
 */
var minusp = new Uint32Array(32);
minusp.set([ 19, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 128 ]);

/**
 * Analog of freeze in crypto_scalarmult/curve25519/ref/smult.c
 * @param a is Uint32Array, 32 items long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 */
function freeze(a, arrFactory) {
	"use strict";
	var aorig = arrFactory.getUint32Array(32);
	aorig.set(a);
	add(a,a,minusp);
	var negative = -((a[31] >>> 7) & 1);
	negative &= 0xffffffff;
	for (var j=0; j<32; j+=1) {
		a[j] ^= negative & (aorig[j] ^ a[j]);
	}
	arrFactory.recycle(aorig);
}

/**
 * Analog of mult in crypto_scalarmult/curve25519/ref/smult.c
 * @param out is Uint32Array, 32 items long.
 * @param a is Uint32Array, 32 items long.
 * @param b is Uint32Array, 32 items long.
 */
function mult(out, a, b) {
	"use strict";
	var u = 0;
	for (var i=0; i<32; i+=1) {
		u = 0;
		for (var j=0; j<=i; j+=1) {
			u += mult32(a[j], b[i - j]);
			u &= 0xffffffff;
		}
		for (var j=i+1; j<32; j+=1) {
			u += 38 * mult32(a[j], b[i + 32 - j]);	// multiplication by 38 is safe here
			u &= 0xffffffff;
		}
		out[i] = u;
	}
	squeeze(out);
}

/**
 * Analog of mult121665 in crypto_scalarmult/curve25519/ref/smult.c
 * @param out is Uint32Array, 32 items long.
 * @param a is Uint32Array, 32 items long.
 */
function mult121665(out, a) {
	"use strict";
	var u = 0;
	for (var j=0; j<31; j+=1) {
		u += 121665 * a[j];	// safe multiplication, as 17+32=49 bits
		u &= 0xffffffff;
		out[j] = u & 255;
		u >>>= 8;
	}
	u += 121665 * a[31];	// safe multiplication, as 17+32=49 bits
	u &= 0xffffffff;
	out[31] = u & 127;
	u = 19 * (u >>> 7);	// multiplication by 19 is safe here
	u &= 0xffffffff;
	for (var j=0; j<31; j+=1) {
		u += out[j];
		u &= 0xffffffff;
		out[j] = u & 255;
		u >>>= 8;
	}
	u += out[j];
	u &= 0xffffffff;
	out[j] = u;
}

/**
 * Analog of square in crypto_scalarmult/curve25519/ref/smult.c
 * @param out is Uint32Array, 32 items long.
 * @param a is Uint32Array, 32 items long.
 */
function square(out, a) {
	"use strict";
	var u = 0;
	for (var i=0; i<32; i+=1) {
		u = 0;
		for (var j=0; j<(i-j); j+=1) {
			u += mult32(a[j], a[i - j]);
			u &= 0xffffffff;
		}
		for (var j=(i+1); j<(i+32-j); j+=1) {
			u += 38 * mult32(a[j], a[i + 32 - j]);	// multiplication by 38 is safe here
			u &= 0xffffffff;
		}
		u *= 2;
		u &= 0xffffffff;
		if ((i & 1) === 0) {	// this assures i even, so Math.floor() is not needed below 
			u += mult32(a[i/2], a[i/2]);
			u &= 0xffffffff;
			u += 38 * mult32(a[i/2 + 16], a[i/2 + 16]);	// multiplication by 38 is safe here
			u &= 0xffffffff;
		}
		out[i] = u;
	}
	squeeze(out);
}

/**
 * Analog of select in crypto_scalarmult/curve25519/ref/smult.c
 * @param p is Uint32Array, 64 items long.
 * @param q is Uint32Array, 64 items long.
 * @param r is Uint32Array, 64 items long.
 * @param s is Uint32Array, 64 items long.
 * @param b is a number within Uint32 limits.
 */
function select(p, q, r, s, b) {
	"use strict";
	b &= 0xffffffff;
	var t = 0
	, bminus1 = b - 1;
	bminus1 &= 0xffffffff;
	for (var j=0; j<64; j+=1) {
		t = bminus1 & (r[j] ^ s[j]);
		p[j] = s[j] ^ t;
		q[j] = r[j] ^ t;
	}
}

/**
 * Analog of mainloop in crypto_scalarmult/curve25519/ref/smult.c
 * @param work is Uint32Array, 64 items long.
 * @param e is Uint8Array, 32 items long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 */
function mainloop(work, e, arrFactory) {
	"use strict";
	
	var xzm1 = arrFactory.getUint32Array(64)
	, xzm = arrFactory.getUint32Array(64)
	, xzmb = arrFactory.getUint32Array(64)
	, xzm1b = arrFactory.getUint32Array(64)
	, xznb = arrFactory.getUint32Array(64)
	, xzn1b = arrFactory.getUint32Array(64)
	, a0 = arrFactory.getUint32Array(64)
	, a1 = arrFactory.getUint32Array(64)
	, b0 = arrFactory.getUint32Array(64)
	, b1 = arrFactory.getUint32Array(64)
	, c1 = arrFactory.getUint32Array(64)
	, r = arrFactory.getUint32Array(32)
	, s = arrFactory.getUint32Array(32)
	, t = arrFactory.getUint32Array(32)
	, u = arrFactory.getUint32Array(32)
	, b = 0;

	for (var j=0; j<32; j+=1) { xzm1[j] = work[j]; }
	xzm1[32] = 1;
	for (var j=33; j<64; j+=1) { xzm1[j] = 0; }

	xzm[0] = 1;
	for (var j=1; j<64; j+=1) { xzm[j] = 0; }
	  
	// views of last 32 elements of original arrays
	var xzmb_32 = xzmb.subarray(32, 64)
	, xzm1b_32 = xzm1b.subarray(32, 64)
	, a0_32 = a0.subarray(32, 64)
	, a1_32 = a1.subarray(32, 64)
	, b0_32 = b0.subarray(32, 64)
	, b1_32 = b1.subarray(32, 64)
	, c1_32 = c1.subarray(32, 64)
	, xznb_32 = xznb.subarray(32, 64)
	, xzn1b_32 = xzn1b.subarray(32, 64);

	for (var pos=254; pos>=0; pos-=1) {
		b = e[Math.floor(pos/8)] >>> (pos & 7);
		b &= 1;
		select(xzmb,xzm1b,xzm,xzm1,b);
		add(a0,xzmb,xzmb_32);
		sub(a0_32,xzmb,xzmb_32);
		add(a1,xzm1b,xzm1b_32);
		sub(a1_32,xzm1b,xzm1b_32);
		square(b0,a0);
		square(b0_32,a0_32);
		mult(b1,a1,a0_32);
		mult(b1_32,a1_32,a0);
		add(c1,b1,b1_32);
		sub(c1_32,b1,b1_32);
		square(r,c1_32);
		sub(s,b0,b0_32);
		mult121665(t,s);
		add(u,t,b0);
		mult(xznb,b0,b0_32);
		mult(xznb_32,s,u);
		square(xzn1b,c1);
		mult(xzn1b_32,r,work);
		select(xzm,xzm1,xznb,xzn1b,b);
	}

	work.set(xzm);
	
	arrFactory.recycle(
			xzm1, xzm, xzmb, xzm1b, xznb, xzn1b, a0, a1, b0, b1, c1, r, s, t, u);
}

/**
 * Analog of recip in crypto_scalarmult/curve25519/ref/smult.c
 * @param out is Uint32Array, 32 items long.
 * @param z is Uint32Array, 32 items long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 */
function recip(out, z, arrFactory) {
	"use strict";
	
	var z2 = arrFactory.getUint32Array(32)
	, z9 = arrFactory.getUint32Array(32)
	, z11 = arrFactory.getUint32Array(32)
	, z2_5_0 = arrFactory.getUint32Array(32)
	, z2_10_0 = arrFactory.getUint32Array(32)
	, z2_20_0 = arrFactory.getUint32Array(32)
	, z2_50_0 = arrFactory.getUint32Array(32)
	, z2_100_0 = arrFactory.getUint32Array(32)
	, t0 = arrFactory.getUint32Array(32)
	, t1 = arrFactory.getUint32Array(32);

	/* 2 */ square(z2,z);
	/* 4 */ square(t1,z2);
	/* 8 */ square(t0,t1);
	/* 9 */ mult(z9,t0,z);
	/* 11 */ mult(z11,z9,z2);
	/* 22 */ square(t0,z11);
	/* 2^5 - 2^0 = 31 */ mult(z2_5_0,t0,z9);

	/* 2^6 - 2^1 */ square(t0,z2_5_0);
	/* 2^7 - 2^2 */ square(t1,t0);
	/* 2^8 - 2^3 */ square(t0,t1);
	/* 2^9 - 2^4 */ square(t1,t0);
	/* 2^10 - 2^5 */ square(t0,t1);
	/* 2^10 - 2^0 */ mult(z2_10_0,t0,z2_5_0);

	/* 2^11 - 2^1 */ square(t0,z2_10_0);
	/* 2^12 - 2^2 */ square(t1,t0);
	/* 2^20 - 2^10 */ for (var i=2; i<10; i+=2) { square(t0,t1); square(t1,t0); }
	/* 2^20 - 2^0 */ mult(z2_20_0,t1,z2_10_0);

	/* 2^21 - 2^1 */ square(t0,z2_20_0);
	/* 2^22 - 2^2 */ square(t1,t0);
	/* 2^40 - 2^20 */ for (var i=2; i<20; i+=2) { square(t0,t1); square(t1,t0); }
	/* 2^40 - 2^0 */ mult(t0,t1,z2_20_0);

	/* 2^41 - 2^1 */ square(t1,t0);
	/* 2^42 - 2^2 */ square(t0,t1);
	/* 2^50 - 2^10 */ for (var i=2; i<10; i+=2) { square(t1,t0); square(t0,t1); }
	/* 2^50 - 2^0 */ mult(z2_50_0,t0,z2_10_0);

	/* 2^51 - 2^1 */ square(t0,z2_50_0);
	/* 2^52 - 2^2 */ square(t1,t0);
	/* 2^100 - 2^50 */ for (var i=2; i<50; i+=2) { square(t0,t1); square(t1,t0); }
	/* 2^100 - 2^0 */ mult(z2_100_0,t1,z2_50_0);

	/* 2^101 - 2^1 */ square(t1,z2_100_0);
	/* 2^102 - 2^2 */ square(t0,t1);
	/* 2^200 - 2^100 */ for (var i=2; i<100; i+=2) { square(t1,t0); square(t0,t1); }
	/* 2^200 - 2^0 */ mult(t1,t0,z2_100_0);

	/* 2^201 - 2^1 */ square(t0,t1);
	/* 2^202 - 2^2 */ square(t1,t0);
	/* 2^250 - 2^50 */ for (var i=2; i<50; i+=2) { square(t0,t1); square(t1,t0); }
	/* 2^250 - 2^0 */ mult(t0,t1,z2_50_0);

	/* 2^251 - 2^1 */ square(t1,t0);
	/* 2^252 - 2^2 */ square(t0,t1);
	/* 2^253 - 2^3 */ square(t1,t0);
	/* 2^254 - 2^4 */ square(t0,t1);
	/* 2^255 - 2^5 */ square(t1,t0);
	/* 2^255 - 21 */ mult(out,t1,z11);
	
	arrFactory.recycle(
			z2, z9, z11, z2_5_0, z2_10_0, z2_20_0, z2_50_0, z2_100_0, t0, t1);
}

/**
 * Analog of crypto_scalarmult in crypto_scalarmult/curve25519/ref/smult.c
 * @param q is Uint8Array, 32 items long.
 * @param n is Uint8Array, 32 items long.
 * @param p is Uint8Array, 32 items long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 */
function crypto_scalarmult(q, n, p, arrFactory) {
	"use strict";
	
	if (!arrFactory) { arrFactory = new ArraysFactory(); }
	var work = arrFactory.getUint32Array(96)
	, e = arrFactory.getUint32Array(32);

	e.set(n);
	e[0] &= 248;
	e[31] &= 127;
	e[31] |= 64;
	
	// partial views of work array
	var work_32 = work.subarray(32, 64)
	, work_64 = work.subarray(64, 96);

	work.set(p);	// sets first 32 elements, as p.length===32
	
	mainloop(work,e,arrFactory);
	recip(work_32,work_32,arrFactory);
	mult(work_64,work,work_32);
	freeze(work_64,arrFactory);
	q.set(work_64);
	
	arrFactory.recycle(work, e);
}

/**
 * base array in crypto_scalarmult/curve25519/ref/base.c
 */
var base = new Uint8Array(32);
base[0] = 9;

/**
 * Analog of crypto_scalarmult_base in crypto_scalarmult/curve25519/ref/base.c
 * @param q is Uint8Array, 32 items long.
 * @param n is Uint8Array, 32 items long.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 */
function crypto_scalarmult_base(q, n, arrFactory) {
	"use strict";
	crypto_scalarmult(q, n, base, arrFactory);
}

module.exports = {
		curve25519: crypto_scalarmult,
		curve25519_base: crypto_scalarmult_base
};
},{"../util/arrays":10,"../util/int32":11}],5:[function(require,module,exports){
/* Copyright(c) 2013-2014 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

var stream = require('./stream')
, stream_xsalsa20_xor = stream.xsalsa20_xor
, stream_xsalsa20 = stream.xsalsa20
, onetimeauth = require('./onetimeauth')
, onetimeauth_poly1305 = onetimeauth.poly1305
, onetimeauth_poly1305_verify = onetimeauth.poly1305_verify
, ArraysFactory = require('../util/arrays')
, nonceMod = require('../util/nonce');

function checkPackArgs(m, n, k) {
	"use strict";
	if (m.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Message array m must be Uint8Array."); }
	if (m.length === 0) { throw new Error("Message array should have at least one byte."); }
	if (n.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Nonce array n must be Uint8Array."); }
	if (n.length !== 24) { throw new Error(
			"Nonce array n should have 24 elements (bytes) in it, but it is "+
			n.length+" elements long."); }
	if (k.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Key array k must be Uint8Array."); }
	if (k.length !== 32) { throw new Error(
			"Key array k should have 32 elements (bytes) in it, but it is "+
			k.length+" elements long."); }
}

/**
 * Analog of crypto_secretbox in crypto_secretbox/xsalsa20poly1305/ref/box.c
 * with an addition that given message should not be padded with zeros, and all
 * padding happen automagically without copying message array.
 * @param c is Uint8Array for resulting cipher, with length being 32 bytes longer than message.
 * Resulting cipher of incoming message, packaged according to NaCl's xsalsa20+poly1305 secret-box
 * bytes layout, with 16 leading zeros.
 * @param m is Uint8Array of message bytes that need to be encrypted by secret key.
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param k is Uint8Array, 32 bytes long secret key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 */
function xsalsa20poly1305_pad_and_pack(c, m, n, k, arrFactory) {
	"use strict";
	
	if (c.length < 32+m.length) { throw new Error("Given array c is too short for output."); }
	if (!arrFactory) { arrFactory = new ArraysFactory(); }
	
	stream_xsalsa20_xor(c,m,32,n,k,arrFactory);

	var dataPartOfC = c.subarray(32)
	, polyOut = c.subarray(16,32)
	, polyKey = c.subarray(0,32);
	
	onetimeauth_poly1305(polyOut, dataPartOfC, polyKey, arrFactory);
	
	// clear poly key part, which is not overwritten by poly output
	for (var i=0; i<16; i+=1) {
		c[i] = 0;
	}
	
}

/**
 * @param m is Uint8Array of message bytes that need to be encrypted by secret key.
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param k is Uint8Array, 32 bytes long secret key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 * @return Uint8Array with resulting cipher of incoming message, packaged according to
 * NaCl's xsalsa20+poly1305 secret-box bytes layout, trimmed of initial zeros, by having
 * a view on array, starting with non-zero part.
 */
function pack(m, n, k, arrFactory) {
	"use strict";
	checkPackArgs(m, n, k);
	var c = new Uint8Array(m.length+32);
	xsalsa20poly1305_pad_and_pack(c, m, n, k, arrFactory);
	c = c.subarray(16);
	return c;
}

/**
 * Analog of crypto_secretbox_open in crypto_secretbox/xsalsa20poly1305/ref/box.c
 * with an addition that given cipher should not be padded with zeros, and all
 * padding happen automagically without copying cipher array.
 * @param c is Uint8Array of cipher bytes that need to be opened by secret key.
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param k is Uint8Array, 32 bytes long secret key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 * @return Uint8Array with opened message.
 * Array is a view of buffer, which has 32 zeros preceding message bytes.
 */
function xsalsa20poly1305_pad_open_trim(c, n, k, arrFactory) {
	"use strict";
	
	if (c.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Cipher array c must be Uint8Array."); }
	if (c.length < 17) { throw new Error(
			"Cipher array c should have at least 17 elements (bytes) in it, but is only "+
			c.length+" elements long."); }
	if (n.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Nonce array n must be Uint8Array."); }
	if (n.length !== 24) { throw new Error(
			"Nonce array n should have 24 elements (bytes) in it, but it is "+
			n.length+" elements long."); }
	if (k.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Key array k must be Uint8Array."); }
	if (k.length !== 32) { throw new Error(
			"Key array k should have 32 elements (bytes) in it, but it is "+
			k.length+" elements long."); }
	if (!arrFactory) { arrFactory = new ArraysFactory(); }
	
	var m = new Uint8Array(c.length+16);
	
	var subkey = arrFactory.getUint8Array(32);
	stream_xsalsa20(subkey,n,k,arrFactory);
	
	var polyPartOfC = c.subarray(0,16);
	var msgPartOfC = c.subarray(16);
	
	if (!onetimeauth_poly1305_verify(polyPartOfC,msgPartOfC,subkey,arrFactory)) {
		throw new Error("Cipher bytes fail verification.");
	}

	stream_xsalsa20_xor(m,c,16,n,k,arrFactory);

	// first 32 bytes of the opened thing should be cleared
	for (var i=0; i<32; i++) { m[i] = 0; }

	// clear and recycle subkey array
	arrFactory.wipe(subkey);
	arrFactory.recycle(subkey);

	m = m.subarray(32);
	
	return m;
}

/**
 * @param m is Uint8Array of message bytes that need to be encrypted by secret key.
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param k is Uint8Array, 32 bytes long secret key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 * @returns Uint8Array, where nonce is packed together with cipher.
 * Length of the returned array is 40 bytes greater than that of a message.
 */
function packWithNonce(m, n, k, arrFactory) {
	"use strict";
	var c = new Uint8Array(40+m.length);
	packWithNonceInto(c, m, n, k, arrFactory);
	return c;
}

/**
 * @param c is Uint8Array for packing nonce together with cipher.
 * Its length should be 40 bytes longer than that of a message.
 * @param m is Uint8Array of message bytes that need to be encrypted by secret key.
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param k is Uint8Array, 32 bytes long secret key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 */
function packWithNonceInto(c, m, n, k, arrFactory) {
	"use strict";
	checkPackArgs(m, n, k);
	if (c.length < 40+m.length) { throw new Error(
			"Array c, for packing nonce and cipher, is too short."); }
	xsalsa20poly1305_pad_and_pack(
			c.subarray(8),
			m, n, k, arrFactory);
	c.set(n);	// sets first 24 bytes (length of n) to nonce value
}

/**
 * @param c is Uint8Array with nonce and cipher bytes that need to be opened by secret key.
 * @param k is Uint8Array, 32 bytes long secret key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 * @return Uint8Array with opened message.
 * Array is a view of buffer, which has 32 zeros preceding message bytes.
 */
function openArrWithNonce(c, k, arrFactory) {
	"use strict";
	if (c.length < 41) { throw new Error("Array c with nonce and cipher should have at "+
			"least 41 elements (bytes) in it, but is only "+c.length+" elements long."); }
	var n = c.subarray(0, 24);
	c = c.subarray(24);
	return xsalsa20poly1305_pad_open_trim(c, n, k, arrFactory);
}

/**
 * @param c is Uint8Array with nonce and cipher bytes
 * @returns Uint8Array, which is a copy of 24-byte nonce from a given array c
 */
function copyNonceFrom(c) {
	"use strict";
	if (c.length < 41) { throw new Error("Array c with nonce and cipher should have at "+
			"least 41 elements (bytes) in it, but is only "+c.length+" elements long."); }
	return new Uint8Array(c.subarray(0, 24));
}

/**
 * 
 * @param key for new encryptor.
 * Note that key will be copied, thus, if given array shall never be used anywhere, it should
 * be wiped after this call.
 * @param nextNonce is nonce, which should be used for the very first packing.
 * All further packing will be done with new nonce, as it is automatically evenly advanced.
 * Note that nextNonce will be copied.
 * @return a frozen object with pack & open functions, and destroy
 * It is NaCl's secret box for a given key, with automatically evenly advancing nonce.
 */
function makeEncryptor(key, nextNonce) {
	"use strict";
	if (nextNonce.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Nonce array nextNonce must be Uint8Array."); }
	if (nextNonce.length !== 24) { throw new Error(
			"Nonce array nextNonce should have 24 elements (bytes) in it, but it is "+
			nextNonce.length+" elements long."); }
	if (key.BYTES_PER_ELEMENT !== 1) { throw new TypeError("Key array key must be Uint8Array."); }
	if (key.length !== 32) { throw new Error(
			"Key array key should have 32 elements (bytes) in it, but it is "+
			key.length+" elements long."); }
	
	// set variable in the closure
	var arrFactory = new TypedArraysFactory()
	, pack, open, destroy;
	key = new Uint8Array(key);
	nextNonce = new Uint8Array(nextNonce);

	pack = function(m) {
		try {
			if (!key) { throw new Error("This encryptor cannot be used, " +
			"as it had already been destroyed."); }
			var c = formatWN.pack(m, nextNonce, key, arrFactory);
			nonceMod.advanceEvenly(nextNonce);
			return c;
		} finally {
			arrFactory.wipeRecycled();
		}
	};
	open = function(c) {
		try {
			if (!key) { throw new Error("This encryptor cannot be used, " +
					"as it had already been destroyed."); }
			return formatWN.open(c, key, arrFactory);
		} finally {
			arrFactory.wipeRecycled();
		}
	};
	destroy = function() {
		if (!key) { return; }
		TypedArraysFactory.prototype.wipe(key, nextNonce);
		key = null;
		nextNonce = null;
		arrFactory = null;
	};
	
	// arrange and freeze resulting object
	var encryptor = {
		pack: pack,
		open: open,
		destroy: destroy
	};
	Object.freeze(encryptor);
	
	return encryptor;
}

var formatWN = {
	pack: packWithNonce,
	packInto: packWithNonceInto,
	open: openArrWithNonce,
	copyNonceFrom: copyNonceFrom,
	makeEncryptor: makeEncryptor
};
Object.freeze(formatWN);

module.exports = {
		pack: pack,
		open: xsalsa20poly1305_pad_open_trim,
		formatWN: formatWN,
		NONCE_LENGTH: 24,
		KEY_LENGTH: 32,
		POLY_LENGTH: 16,
		JWK_ALG_NAME: 'NaCl-sbox-XSP'
};
Object.freeze(module.exports);

},{"../util/arrays":10,"../util/nonce":12,"./onetimeauth":3,"./stream":6}],6:[function(require,module,exports){
/* Copyright(c) 2013 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

var ArraysFactory = require('../util/arrays');
var core = require('./core');

/**
 * sigma array in crypto_stream/salsa20/ref/stream.c
 */
var sigma = new Uint8Array(16);
(function () {
	"use strict";
	var str = "expand 32-byte k";
	for (var i=0; i<16; i+=1) {
		sigma[i] = str.charCodeAt(i);
	}
})();

/**
 * Analog of crypto_stream in crypto_stream/salsa20/ref/stream.c
 * @param c is Uint8Array of some length, for outgoing bytes (cipher).
 * @param n is Uint8Array, 8 bytes long nonce.
 * @param k is Uint8Array, 32 bytes long key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 */
function stream_salsa20(c, n, k, arrFactory) {
	"use strict";
	
	if (!arrFactory) { arrFactory = new ArraysFactory(); }
	var inArr = arrFactory.getUint8Array(16)
	, u = 0;

	if (c.length === 0) { return; }

	inArr.set(n);
	for (var i=8; i<16; i+=1) { inArr[i] = 0; }

	var cstart = 0
	, clen = c.length
	, outArr;
	while (clen >= 64) {
		outArr = new Uint8Array(c, cstart, 64);
		
		core.salsa20(outArr,inArr,k,sigma,arrFactory);
		
		u = 1;
		for (var i=8; i<16; i+=1) {
			u += inArr[i];
			u &= 0xffffffff;
			inArr[i] = u;
			u >>>= 8;
		}

		clen -= 64;
		cstart += 64;
	}

	if (clen > 0) {
		var block = arrFactory.getUint8Array(64);
		core.salsa20(block,inArr,k,sigma,arrFactory);
		for (i = 0;i < clen;++i) {
			c[i] = block[i];
		}
		arrFactory.recycle(block);
	}
	
	arrFactory.recycle(inArr);
}

/**
 * Analog of crypto_stream_xor in crypto_stream/salsa20/ref/xor.c
 * with an addition of pad parameter for incoming array, which creates the pad on the fly,
 * without wasteful copying of potentially big xor-ed incoming array.
 * @param c is Uint8Array of outgoing bytes with resulting cipher, of the same length as
 * incoming array m, plus the pad.
 * @param m is Uint8Array of incoming bytes, that are xor-ed into cryptographic stream.
 * @param mPadLen is number of zeros that should be in front of message array, always between 0 and 63.
 * @param n is Uint8Array, 8 bytes long nonce.
 * @param k is Uint8Array, 32 bytes long key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 */
function stream_salsa20_xor(c, m, mPadLen, n, k, arrFactory) {
	"use strict";
	
	if (!arrFactory) { arrFactory = new ArraysFactory(); }
	var inArr = arrFactory.getUint8Array(16)
	, block = arrFactory.getUint8Array(64)
	, u = 0;

	if (m.length === 0) { return; }

	inArr.set(n);
	for (var i=8; i<16; i+=1) { inArr[i] = 0; }

	var mWithPadLen = m.length+mPadLen;
	
	if (mWithPadLen < 64) {
		core.salsa20(block,inArr,k,sigma,arrFactory);
		for (var i=0; i<mPadLen; i+=1) {
			c[i] = block[i];
		}
		for (var i=mPadLen; i<mWithPadLen; i+=1) {
			c[i] = m[i-mPadLen] ^ block[i];
		}
		return;
	}
	
	var cp = 0
	, mp = 0;
	{ // first loop with pad
		core.salsa20(block,inArr,k,sigma,arrFactory);
		for (var i=0; i<mPadLen; i+=1) {
			c[i] = block[i];
		}
		for (var i=mPadLen; i<64; i+=1) {
			c[i] = m[i-mPadLen] ^ block[i];
		}
		
		u = 1;
		for (var i=8; i<16; i+=1) {
			u += inArr[i];
			u &= 0xffffffff;
			inArr[i] = u;
			u >>>= 8;
		}

		mWithPadLen -= 64;
		mp = 64 - mPadLen;
		cp = 64;
	}

	while (mWithPadLen >= 64) {
		core.salsa20(block,inArr,k,sigma,arrFactory);
		for (var i=0; i<64; i+=1) {
			c[cp+i] = m[mp+i] ^ block[i];
		}
		
		u = 1;
		for (var i=8; i<16; i+=1) {
			u += inArr[i];
			u &= 0xffffffff;
			inArr[i] = u;
			u >>>= 8;
		}

		mWithPadLen -= 64;
		mp += 64;
		cp += 64;
	}

	if (mWithPadLen > 0) {
		core.salsa20(block,inArr,k,sigma,arrFactory);
		for (var i=0; i<mWithPadLen; i+=1) {
			c[cp+i] = m[mp+i] ^ block[i];
		}
	}
	
	arrFactory.recycle(inArr, block);
}

/**
 * Analog of crypto_stream in crypto_stream/xsalsa20/ref/stream.c
 * @param c is Uint8Array of some length, for outgoing bytes (cipher).
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param k is Uint8Array, 32 bytes long key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 */
function stream_xsalsa20(c, n, k, arrFactory) {
	"use strict";
	
	if (!arrFactory) {
		arrFactory = new ArraysFactory();
	}

	var subkey = arrFactory.getUint8Array(32)
	, n_16 = n.subarray(16, 24);
	
	core.hsalsa20(subkey,n,k,sigma,arrFactory);
	stream_salsa20(c,n_16,subkey,arrFactory);
	
	arrFactory.recycle(subkey);
}

/**
 * Analog of crypto_stream_xor in crypto_stream/xsalsa20/ref/xor.c
 * @param c is Uint8Array of outgoing bytes with resulting cipher, of the same length as
 * incoming array m.
 * @param m is Uint8Array of incoming bytes, of some plain text message.
 * @param mPadLen is number of zeros that should be in front of message array, always between 0 and 63.
 * @param n is Uint8Array, 24 bytes long nonce.
 * @param k is Uint8Array, 32 bytes long key.
 * @param arrFactory is TypedArraysFactory, used to allocated/find an array for use.
 * It may be undefined, in which case an internally created one is used.
 */
function stream_xsalsa20_xor(c, m, mPadLen, n, k, arrFactory) {
	"use strict";
	
	if (!arrFactory) { arrFactory = new ArraysFactory(); }
	var subkey = arrFactory.getUint8Array(32)
	, n_16 = n.subarray(16, 24);
	
	core.hsalsa20(subkey,n,k,sigma,arrFactory);
	stream_salsa20_xor(c,m,mPadLen,n_16,subkey,arrFactory);
	
	arrFactory.recycle(subkey);
}

module.exports = {
		xsalsa20: stream_xsalsa20,
		xsalsa20_xor: stream_xsalsa20_xor,
		SIGMA: sigma
};
},{"../util/arrays":10,"./core":2}],"ecma-nacl":[function(require,module,exports){
module.exports=require('5PDy5J');
},{}],"5PDy5J":[function(require,module,exports){
/* Copyright(c) 2013-2014 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This file is an external interface of Ecma-NaCl library.
 */

var secret_box = require('./boxes/secret_box')
, box = require('./boxes/box')
, TypedArraysFactory = require('./util/arrays')
, verify = require('./util/verify').verify
, nonceMod = require('./util/nonce')
, fileXSP = require('./file/xsp');

/**
 * @param x typed array
 * @param y typed array
 * @returns true, if arrays have the same length and their elements are equal;
 * and false, otherwise.
 */
function compareVectors(x, y) {
	"use strict";
	if (x.length !== y.length) { return false; }
	return verify(x, y, x.length);
}

module.exports = {
		secret_box: secret_box,
		box: box,
		fileXSP: fileXSP,
		TypedArraysFactory: TypedArraysFactory,
		compareVectors: compareVectors,
		wipeArrays: TypedArraysFactory.prototype.wipe,
		advanceNonceOddly: nonceMod.advanceOddly,
		advanceNonceEvenly: nonceMod.advanceEvenly,
};
Object.freeze(module.exports);

},{"./boxes/box":1,"./boxes/secret_box":5,"./file/xsp":9,"./util/arrays":10,"./util/nonce":12,"./util/verify":13}],9:[function(require,module,exports){
/* Copyright(c) 2013 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

var sbox = require('../boxes/secret_box')
, TypedArraysFactory = require('../util/arrays')
, areBytesSame = require('../util/verify').verify;

/**
 * Minimum and maximum limits for segment size guaranty, that when
 * segment size is loaded with function provided here into 4 bytes, first
 * two zero bytes shall always be different from starting string, allowing
 * for distinguishing the first segment from all others.
 */
var MIN_SEGMENT_SIZE = 0xff
, MAX_SEGMENT_SIZE = 0xffffff
, START_STRING = "xsp"
/**
 * Segment non-message header contains:
 *  - 4 bytes with total segment length
 *  - 40 bytes of with-nonce pack (24 nonce bytes, followed by 16 poly bytes)
 */
, SEGMENT_HEADER_LEN = 44
/**
 * File header contains:
 *  - bytes with a start string (3 for 'xsp' string)
 *  - 72 bytes of file key encrypted into with-nonce form (40+32=72)
 *  - 4 bytes with a normal total segment size (the actual segment
 *    size can be smaller, but not bigger than this value) 
 */
, FILE_HEADER_LEN = START_STRING.length + 72 + 4
/**
 * First segment contains:
 *  - file header bytes
 *  - segment header bytes
 */
, FIRST_SEGMENT_HEADERS_LEN = SEGMENT_HEADER_LEN + FILE_HEADER_LEN
, FILE_START = new Uint8Array(START_STRING.length);
for (var i=0; i<START_STRING.length; i+=1) {
	FILE_START[i] = START_STRING.charCodeAt(i);
}

/**
 * @param x is Uint8Array, to which a given uint32 number should be stored.
 * @param i is position, at which storing of 4 bytes should start.
 * @param u is a number within uint32 limits, which should be stored in a given
 * byte array.
 */
function storeUint32(x, i, u) {
	"use strict";
	x[i+3] = u; u >>>= 8;
	x[i+2] = u; u >>>= 8;
	x[i+1] = u; u >>>= 8;
	x[i] = u;
}

/**
 * @param x is Uint8Array, where number is stored.
 * @param i is position, at which number's bytes start.
 * @returns number within uint32 limits, loaded from a given array.
 */
function loadUint32(x, i) {
	"use strict";
	return (x[i] << 24) | (x[i+1] << 16) | (x[i+2] << 8) | x[i+3];
}

/**
 * This throws up if given segment size is not ok.
 * @param segSize
 */
function validateSegSize(segSize) {
	"use strict";
	if (('number' !== typeof segSize) || ((segSize % 1) !== 0) ||
			(segSize < MIN_SEGMENT_SIZE) || (segSize > MAX_SEGMENT_SIZE)) {
		throw new TypeError("Given segment length parameter must be an " +
				"integer between "+MIN_SEGMENT_SIZE+" and "+MAX_SEGMENT_SIZE);
	}
}

/**
 * This function writes file header at the start of the given byte array.
 * @param seg is Uint8Array for segment bytes
 * @param fileKeyEnvelope
 * @param maxSegSize
 */
function writeFileHeader(seg, fileKeyEnvelope, maxSegSize) {
	"use strict";
	// write file starting string
	seg.set(FILE_START);
	// write key envelope
	seg.set(fileKeyEnvelope, FILE_START.length);
	// write max segment length
	storeUint32(seg, FILE_HEADER_LEN-4, maxSegSize);
}

/**
 * @param data is Uint8Array with bytes that need to be packed into xsp file.
 * @param fileKeyEnvelope is Uint8Array for the first segment, and is null,
 * for all others.
 * @param maxSegSize
 * @param fileKey
 * @param nonce
 * @param arrFactory
 * @return an object with the following fields:
 *  a) seg is an Uint8Array xsp file segment's bytes;
 *  b) dataLen is a number of data bytes that were packed into this segment.
 */
function packSegment(data, fileKeyEnvelope, maxSegSize,
		fileKey, nonce, arrFactory) {
	"use strict";
	if (!fileKey) { throw new Error(
			"This encryptor cannot be used, as file key has been wiped."); }
	if (data.length <= 0) { throw new Error("There are no bytes to encode."); }
	var headerLen = (fileKeyEnvelope ?
			FIRST_SEGMENT_HEADERS_LEN : SEGMENT_HEADER_LEN)
	, dataLen = Math.min(maxSegSize - headerLen, data.length)
	// make a segment array
	, seg = new Uint8Array(headerLen + dataLen)
	, outArr;
	// shorten data to those bytes that will be encrypted into the segment
	data = ((dataLen < data.length) ? data.subarray(0, dataLen) : data);
	if (fileKeyEnvelope) {
		writeFileHeader(seg, fileKeyEnvelope, maxSegSize);
		outArr = seg.subarray(FILE_HEADER_LEN);
	} else {
		outArr = seg;
	}
	// write this segment length
	storeUint32(outArr, 0, seg.length);
	outArr = outArr.subarray(4);
	// pack data itself
	sbox.formatWN.packInto(outArr, data, nonce, fileKey, arrFactory);
	return { seg: seg, dataLen: dataLen };
};

/**
 * @param seg is an Uint8Array with segments bytes, or with a long enough
 * part of it to contain header(s).
 * @return an object with the following fields:
 *  a) isFirstSeg is a boolean flag, telling if given segment is the first
 *  segment of a xsp file;
 *  b) segSize is an integer, telling this segmwnt's length;
 *  c) fileKeyEnvelope, present only if isFirstSeg===true, is an Uint8Array
 *     containing encrypted key of this file in a with-nonce format;
 *  d) commonSegSize, present only if isFirstSeg===true, is an integer, telling
 *     a maximum, or common segment size, used in this file. 
 */
function readHeaders(seg) {
	"use strict";
	var isFirstSegment = areBytesSame(seg, FILE_START, FILE_START.length)
	, info = {
		isFirstSeg: isFirstSegment
	};
	if (isFirstSegment) {
		if (seg.length < FIRST_SEGMENT_HEADERS_LEN) {
			throw new Error("Given seg array is "+seg.length+" bytes long, "+
					"which is too short to be the first segment header."); }
		info.fileKeyEnvelope = new Uint8Array(seg.subarray(
				FILE_START.length, FILE_HEADER_LEN-4));
		info.commonSegSize = loadUint32(seg, FILE_HEADER_LEN-4);
	} else {
		if (seg.length < SEGMENT_HEADER_LEN) {
			throw new Error("Given seg array is "+seg.length+" bytes long, "+
					"which is too short to be a segment header."); }
	}
	info.segSize = loadUint32(seg, (isFirstSegment ? FILE_HEADER_LEN : 0));
	if (!isFirstSegment && (info.segSize > MAX_SEGMENT_SIZE)) {
		throw new Error("Given seg array is misalligned with segment's bytes.");
	}
	return info;
}

/**
 * This decrypts data from a segment of xsp file.
 * @param seg is Uint8Array with xsp segment
 * @param fileKey
 * @param arrFactory
 * @return an object with the following fields:
 *  a) data is Uint8Array with bytes decrypted from a given segment
 *  b) segLen is a number of bytes read from a given segment
 */
function openSegment(seg, fileKey, arrFactory) {
	"use strict";
	if (!fileKey) { throw new Error(
			"This encryptor cannot be used, as file key has been wiped."); }
	var segInfo = readHeaders(seg);
	if (seg.length < segInfo.segSize) { throw new Error("Given seg array "+
			"is shorter than extracted size of this segment."); }
	// shorten seg to those bytes that will be opened as a with-nonce piece
	var offset = 4 + (segInfo.isFirstSeg ? FILE_HEADER_LEN : 0);
	seg = seg.subarray(offset, segInfo.segSize);
	var data = sbox.formatWN.open(seg, fileKey, arrFactory);
	return { data: data, segLen: segInfo.segSize };
};

/**
 * @param fileKeyEnvelope
 * @param segSize
 * @param fileKey
 * @param arrFactory
 * @return encryptor object with the following methods:
 *  a) packFirstSegment(data, nonce) encrypts given data, with given nonce,
 *     into the first xsp file segment.
 *     This method returns an object with segment bytes, and a field, telling
 *     how many of data bytes have been packed into the segment.
 *  b) packSegment(data, nonce) encrypts given data, with given nonce,
 *     into a xsp file segment, which is not the first segment in a file.
 *     This method returns an object with segment bytes, and a field, telling
 *     how many of data bytes have been packed into the segment.
 *  c) openSegment(seg) decrypts data bytes from a given segment.
 *     This method returns an object with data bytes, and a field, telling
 *     how many bytes have been read from a given segment array.
 *  d) destroy() wipes the file key, known to this encryptor.
 *     Encryptor becomes non-usable after this call.
 */
function makeEncryptor(fileKeyEnvelope, segSize, fileKey, arrFactory) {
	"use strict";
	var encr = {
			packFirstSegment: function(data, nonce) {
				try {
					return packSegment(data, fileKeyEnvelope,
							segSize, fileKey, nonce, arrFactory);
				} finally {
					arrFactory.wipeRecycled();
				}
			},
			packSegment: function(data, nonce) {
				try {
					return packSegment(data, null,
							segSize, fileKey, nonce, arrFactory);
				} finally {
					arrFactory.wipeRecycled();
				}
			},
			openSegment: function(seg) {
				try {
					return openSegment(seg, fileKey, arrFactory);
				} finally {
					arrFactory.wipeRecycled();
				}
			},
			commonSegSize: function() {
				return segSize;
			},
			destroy: function() {
				if (!fileKey) { return; }
				TypedArraysFactory.prototype.wipe(fileKey);
				fileKey = null;
				arrFactory = null;
			}
	};
	Object.freeze(encr);
	return encr;
}

/**
 * @param segSize is a common segment length.
 * Segments can be shorter than this, e.g. last, or changed segments, but
 * segments are never longer than this size.
 * Note that data length within the segment is always a little shorter than
 * segment's length, as crypto parameters and, in first segment, file
 * parameters are preceding encrypted data bytes.
 * @param fileKey is Uint8Array with a key, that is used to encrypt data in every segment of this
 * file.
 * This file key itself is written into the first segment of the file in encrypted form.
 * @param nonce is Uint8Array, 24 bytes long, with nonce, used for encryption of file key.
 * @param key is Uint8Array, 32 bytes long, with key, used for encryption of file key.
 * @param arrFactory is an optional TypedArraysFactory, used to allocated/find
 * an array for use. If it is undefined, an internally created one is used.
 * @return encryptor object with the following methods:
 *  a) packFirstSegment(data, nonce) encrypts given data, with given nonce,
 *     into the first xsp file segment.
 *     This method returns an object with segment bytes, and a field, telling
 *     how many of data bytes have been packed into the segment.
 *  b) packSegment(data, nonce) encrypts given data, with given nonce,
 *     into a xsp file segment, which is not the first segment in a file.
 *     This method returns an object with segment bytes, and a field, telling
 *     how many of data bytes have been packed into the segment.
 *  c) openSegment(seg) decrypts data bytes from a given segment.
 *     This method returns an object with data bytes, and a field, telling
 *     how many bytes have been read from a given segment array.
 *  d) destroy() wipes the file key, known to this encryptor.
 *     Encryptor becomes non-usable after this call.
 */
function makeNewFileEncryptor(segSize, fileKey, nonce, key, arrFactory) {
	"use strict";
	if (fileKey.length !== 32) { throw new Error("Given fileKey array is "+
			fileKey.length+" bytes long, instead of 32"); }
	validateSegSize(segSize);
	var fileKeyEnvelope = new Uint8Array(72);
	fileKey = new Uint8Array(fileKey);
	if (!arrFactory) { arrFactory = new TypedArraysFactory(); }
	try {
		sbox.formatWN.packInto(fileKeyEnvelope, fileKey, nonce, key, arrFactory);
	} finally {
		arrFactory.wipeRecycled();
	}
	return makeEncryptor(fileKeyEnvelope, segSize, fileKey, arrFactory);
}

/**
 * @param firstSegHeader is an array containing first segment's header,
 * which includes a file header.
 * @param key is Uint8Array, 32 bytes long, with key, used for encryption of file key.
 * @param arrFactory is an optional TypedArraysFactory, used to allocated/find
 * an array for use. If it is undefined, an internally created one is used.
 * @return encryptor object with the following methods:
 *  a) packFirstSegment(data, nonce) encrypts given data, with given nonce,
 *     into the first xsp file segment.
 *     This method returns an object with segment bytes, and a field, telling
 *     how many of data bytes have been packed into the segment.
 *  b) packSegment(data, nonce) encrypts given data, with given nonce,
 *     into a xsp file segment, which is not the first segment in a file.
 *     This method returns an object with segment bytes, and a field, telling
 *     how many of data bytes have been packed into the segment.
 *  c) openSegment(seg) decrypts data bytes from a given segment.
 *     This method returns an object with data bytes, and a field, telling
 *     how many bytes have been read from a given segment array.
 *  d) destroy() wipes the file key, known to this encryptor.
 *     Encryptor becomes non-usable after this call.
 */
function makeExistingFileEncryptor(firstSegHeader, key, arrFactory) {
	"use strict";
	var segInfo = readHeaders(firstSegHeader);
	if (!segInfo.isFirstSeg) { throw new Error("Given firstSegHeader array "+
			"does not contain file header, from the first file segment."); }
	if (!arrFactory) { arrFactory = new TypedArraysFactory(); }
	try {
		var fileKey = sbox.formatWN.open(
				segInfo.fileKeyEnvelope, key, arrFactory);
	} finally {
		arrFactory.wipeRecycled();
	}
	return makeEncryptor(segInfo.fileKeyEnvelope, segInfo.commonSegSize,
			fileKey, arrFactory);
}

var xspModule = {
		SEGMENT_HEADER_LEN: SEGMENT_HEADER_LEN,
		FILE_HEADER_LEN: FILE_HEADER_LEN,
		FIRST_SEGMENT_HEADERS_LEN: FIRST_SEGMENT_HEADERS_LEN,
		readHeaders: readHeaders,
		makeNewFileEncryptor: makeNewFileEncryptor,
		makeExistingFileEncryptor: makeExistingFileEncryptor
};

Object.freeze(xspModule);

module.exports = xspModule;

},{"../boxes/secret_box":5,"../util/arrays":10,"../util/verify":13}],10:[function(require,module,exports){
/* Copyright(c) 2013 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This module provide an object pool for typed arrays used in the library.
 * When we turn off reusing, by always making new arrays, time for boxes goes up
 * dramatically (due to arrays needed in stream?).
 */

/**
 * Pool of arrays a particular type, with a particular length.
 * @param numOfElemsInObj
 * @param constructorFunc
 * @returns
 */
function NumericArrPool(numOfElemsInObj, constructorFunc) {
	"use strict";
	this.constructor = constructorFunc;
	this.numOfElemsInObj = numOfElemsInObj;
	this.pool = new Array(16);
	this.poolIndex = -1;
	Object.seal(this);
}

/**
 * This either creates new, or gets a spare array from the pool.
 * Newly created array is not put into pool, because it is given to someone for use.
 * If someone forgets to return it, there shall be no leaking references.
 * @returns TypedArray, created by set constructor, with set number of elements in it.
 * Note that array may and shall have arbitrary data in it, thus, any initialization
 * must be performed explicitly.
 */
NumericArrPool.prototype.get = function() {
	"use strict";
	var arr;
	if (this.poolIndex < 0) {
		arr = new this.constructor(this.numOfElemsInObj);
	} else {
		arr = this.pool[this.poolIndex];
		this.pool[this.poolIndex] = null;
		this.poolIndex -= 1;
	}
	return arr;
};

/**
 * This puts array into the pool, but it does not touch a content of array.
 * @param arr
 */
NumericArrPool.prototype.recycle = function(arr) {
	"use strict";
	this.poolIndex += 1;
	this.pool[this.poolIndex] = arr;
};

function TypedArraysFactory() {
	"use strict";
	this.uint8s = { constructor: Uint8Array };
	this.uint32s = { constructor: Uint32Array };
	Object.freeze(this);
}

function clearPool(p) {
	"use strict";
	for (var fieldName in p) {
		if (fieldName !== "constructor") {
			delete p[fieldName];
		}
	}
}

/**
 * This drops all arrays from pools, letting GC to pick them up,
 * even if reference to this factory is hanging somewhere.
 */
TypedArraysFactory.prototype.clear = function() {
	"use strict";
	clearPool(this.uint8s);
	clearPool(this.uint32s);
};

function get(typedPools, len) {
	"use strict";
	var pool = typedPools[len];
	if (!pool) {
		pool = new NumericArrPool(len, typedPools.constructor);
		typedPools[len] = pool;
	}
	return pool.get();
}

function recycle(typedPools, arr) {
	"use strict";
	var pool = typedPools[arr.length];
	if (!pool) {
		pool = new NumericArrPool(arr.length, typedPools.constructor);
		typedPools[arr.length] = pool;
	}
	pool.recycle(arr);
}

/**
 * This either creates new, or gets a spare array from the pool.
 * Newly created array is not put into pool, because it is given to someone for use.
 * If someone forgets to return it, there shall be no leaking references.
 * @param len is number of elements in desired array.
 * @returns Uint8Array, with given number of elements in it,
 * all set to zero (either by construction, or by auto cleanup of recycled arrays).
 */
TypedArraysFactory.prototype.getUint8Array = function(len) {
	"use strict";
	return get(this.uint8s, len);
};

/**
 * This either creates new, or gets a spare array from the pool.
 * Newly created array is not put into pool, because it is given to someone for use.
 * If someone forgets to return it, there shall be no leaking references.
 * @param len is number of elements in desired array.
 * @returns Uint32Array, with given number of elements in it,
 * all set to zero (either by construction, or by auto cleanup of recycled arrays).
 */
TypedArraysFactory.prototype.getUint32Array = function(len) {
	"use strict";
	return get(this.uint32s, len);
};

/**
 * This puts given arrays into the pool, and zeros all of elements.
 * Use this function for those arrays that shall be reused, due to having common
 * to your application size, and, correspondingly, do not use it on odd size
 * arrays.
 * This function takes any number of unsigned arrays, that need to be recycled.
 * When you need to just wipe an array, or wipe a particular view of an array,
 * use wipe() method.
 */
TypedArraysFactory.prototype.recycle = function() {
	"use strict";
	var arr;
	for (var i=0; i<arguments.length; i+=1) {
		arr = arguments[i];
		if (!arr) continue;
		if ((arr.byteOffset !== 0) ||
				(arr.length*arr.BYTES_PER_ELEMENT !== arr.buffer.byteLength)) {
			throw new TypeError(
					"Given, as argument #"+(i+1)+" is a view of an array, and these are not " +
					"supposed to be recycled.");
		}
		if (arr.BYTES_PER_ELEMENT === 1) {
			recycle(this.uint8s, arr);
		} else if (arr.BYTES_PER_ELEMENT === 4) {
			recycle(this.uint32s, arr);
		} else {
			throw new TypedError(
					"This works with typed arrays that have 1 or 4 bytes per element, "+
					"while given at position "+i+" array claims to have "+arr.BYTES_PER_ELEMENT);
		}
	}
};

/**
 * This zeros all elements of given arrays, or given array views.
 * Use this function on things that needs secure cleanup, but should not be
 * recycled due to their odd and/or huge size, as it makes pooling inefficient.
 */
TypedArraysFactory.prototype.wipe = function() {
	"use strict";
	var arr;
	for (var i=0; i<arguments.length; i+=1) {
		arr = arguments[i];
		if (!arr) continue;
		for (var j=0; j<arr.length; j+=1) { arr[j] = 0; }
	}
};

function wipePool(p) {
	"use strict";
	var poolArr, uintArr;
	for (var fieldName in p) {
		if (fieldName === "constructor") { continue; }
		poolArr = p[fieldName].pool;
		for (var i=0; i<= poolArr.length; i+=1) {
			uintArr = poolArr[i];
			if (!uintArr) { continue; }
			for (var j=0; j<uintArr.length; j+=1) {
				uintArr[j] = 0;
			}
		}
	}
}

/**
 * This wipes (sets to zeros) all arrays that are located in pools
 */
TypedArraysFactory.prototype.wipeRecycled = function() {
	"use strict";
	wipePool(this.uint8s);
	wipePool(this.uint32s);
};

Object.freeze(TypedArraysFactory);
Object.freeze(TypedArraysFactory.prototype);

module.exports = TypedArraysFactory;

},{}],11:[function(require,module,exports){
/* Copyright(c) 2013 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This module provides multiplication, modulo 32 bits, of uint32s.
 * All number operations in javascript are done in float64.
 * Therefore, there are fifty something bits for exact multiplication, and if those
 * overflow, lower bits are dropped, like in everyday calculation, while it is higher
 * bits are dropped in modulo operations.
 * This allows addition and subtraction of uint32's, performing occasional & with 0xffffffff.
 * But, for example, multiplication of two numbers with 30 bits gives more bits,
 * which will be truncated from the wrong, for our purposes, side.
 * And here we provide proper modulo 32 bits multiplication.
 */

/**
 * @param a is number, assumed to be within uint32 limits.
 * @param b is number, assumed to be within uint32 limits.
 * @returns number, which is a result of multiplication modulo 32 bits.
 */
function mult(a,b) {
	"use strict";
	var r = a*(b >>> 16);
	r &= 0xffffffff;
	r *= 0x10000;
	r &= 0xffffffff;
	r += a*(b & 0xffff);
	r &= 0xffffffff;
	return r;
}

/**
 * @param a is number, forced to uint32 limits.
 * @param b is number, forced to uint32 limits.
 * @returns number, which is a result of multiplication modulo 32 bits.
 */
function multChecked(a,b) {
	"use strict";
	a &= 0xffffffff;
	b &= 0xffffffff;
	var r = a*(b >>> 16);
	r &= 0xffffffff;
	r *= 0x10000;
	r &= 0xffffffff;
	r += a*(b & 0xffff);
	r &= 0xffffffff;
	return r;
}

module.exports = {
		mult: mult,
		multChecked: multChecked
};
},{}],12:[function(require,module,exports){
/* Copyright(c) 2013 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * 
 * @param n is Uint8Array, 24 bytes long nonce that will be changed in-place.
 * @param delta is a number, by which 8-byte numbers, constituting given
 * 24-bytes nonce, are advanced.
 */
function advanceNonce(n, delta) {
	"use strict";
	if (n.BYTES_PER_ELEMENT !== 1) { throw new TypeError(
			"Nonce array n must be Uint8Array."); }
	if (n.length !== 24) { throw new Error(
			"Nonce array n should have 24 elements (bytes) in it, but it is "+
			n.length+" elements long."); }
	var t;
	for (var i=0; i<3; i+=1) {
		t = delta;
		for (var j=0; j<8; j+=1) {
			t += n[j+i*8];
			n[j+i*8] = t & 0xff;
			t >>>= 8;
			if (t === 0) { break; }
		}
	}
}

function advanceNonceOddly(n) {
	"use strict";
	advanceNonce(n, 1);
}

function advanceNonceEvenly(n) {
	"use strict";
	advanceNonce(n, 2);
}

var nonceModule = {
		advanceOddly: advanceNonceOddly,
		advanceEvenly: advanceNonceEvenly
};

Object.freeze(nonceModule);

module.exports = nonceModule;

},{}],13:[function(require,module,exports){
/* Copyright(c) 2013 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * @param x is typed array
 * @param y is typed array, of the same length as x
 * @param n is number of element to compare, starting from each arrays head.
 * @returns true when n first elements of arrays were found to correspond in each array,
 *          and false otherwise.
 *          Notice, that C's crypto_verify 16 and 32 return 0 (falsy value), for same elements,
 *          and -1 (truethy value), for different elements.
 */
function verify(x, y, len) {
	"use strict";
	if ('number' !== typeof len) { throw new Error("Function is not given proper length argument"); }
	var differentbits = 0;
	for (var i=0; i<len; i+=1) {
		differentbits |= x[i] ^ y[i];
	}
	return (differentbits === 0);
}

/**
 * @param x is typed array
 * @param y is typed array, of the same length as x
 * @returns true when 16 first elements of arrays were found to correspond in each array,
 *          and false otherwise.
 *          Notice, that C's crypto_verify 16 and 32 return 0 (falsy value), for same elements,
 *          and -1 (truethy value), for different elements.
 */
function verify16(x, y) {
	"use strict";
	return verify(x, y, 16);
}

/**
 * @param x is typed array
 * @param y is typed array, of the same length as x
 * @returns true when 32 first elements of arrays were found to correspond in each array,
 *          and false otherwise.
 *          Notice, that C's crypto_verify 16 and 32 return 0 (falsy value), for same elements,
 *          and -1 (truethy value), for different elements.
 */
function verify32(x, y) {
	"use strict";
	return verify(x, y, 32);
}

module.exports = {
		verify: verify,
		v16: verify16,
		v32: verify32
};
},{}]},{},[])
;