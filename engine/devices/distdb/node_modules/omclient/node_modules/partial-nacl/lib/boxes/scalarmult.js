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