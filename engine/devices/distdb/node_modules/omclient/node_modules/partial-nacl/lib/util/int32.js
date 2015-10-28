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