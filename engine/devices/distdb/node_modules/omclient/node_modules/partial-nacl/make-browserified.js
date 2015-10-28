/**
 * This is a script to make browserified version of ecma-nacl
 */

var browserify = require('browserify')
, fs = require('fs');

var b = browserify();

b.require('./lib/partial-nacl', { expose: 'partial-nacl' });
b.bundle().pipe(fs.createWriteStream(__dirname + '/partial-nacl_browserified.js'));
