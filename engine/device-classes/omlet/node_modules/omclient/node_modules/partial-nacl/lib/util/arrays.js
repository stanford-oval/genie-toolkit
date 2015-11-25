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
