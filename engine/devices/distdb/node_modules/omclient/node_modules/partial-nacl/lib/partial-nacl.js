/* Copyright(c) 2013-2014 3NSoft Inc.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This file is an external interface of Ecma-NaCl library.
 */

var sm = require('./boxes/scalarmult'),
box = require('./boxes/box'),
TypedArraysFactory = require('./util/arrays');

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
		generate_pubkey:box.generate_pubkey,
		curve25519: sm.curve25519,
		curve25519_base: sm.curve25519_base,
		TypedArraysFactory: TypedArraysFactory,
		compareVectors: compareVectors,
		wipeArrays: TypedArraysFactory.prototype.wipe
};
Object.freeze(module.exports);
