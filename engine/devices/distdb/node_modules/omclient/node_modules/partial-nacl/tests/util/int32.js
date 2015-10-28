/**
 * Testing lib/int32 module
 */

var mult32 = require('../../lib/util/int32').mult;

var a = 0xfffffff1;
var c = 0xffff1;
var b = 0xfffffff2;

console.log("Check that regular multiplication of two 32 bit long numbers will" +
		"\n\tnot be the same as modulo 32 multiplication.");
console.log(((a*b)&0xffffffff) !== mult32(a,b));

console.log();

console.log("Check that regular multiplication of one 20 and one 32 bit long numbers" +
		"\n\twill be the same as modulo 32 multiplication.");
console.log(((c*b)&0xffffffff) === mult32(c,b));