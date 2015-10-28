/**
 * This is a script to make browserified version of ecma-nacl
 */

var browserify = require('browserify')
, fs = require('fs');

var b = browserify();

b.require('./lib/ecma-nacl', { expose: 'ecma-nacl' });
b.bundle().pipe(fs.createWriteStream(__dirname + '/ecma-nacl_browserified.js'));
