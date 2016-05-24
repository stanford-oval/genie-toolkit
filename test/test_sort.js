// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const heapdump = require('heapdump');
const Stream = require('stream');

const SortStream = require('../lib/graphdb/sortstream');

const N_VALUES = 512*1024;
const MIN = 0;
const MAX = 128 * N_VALUES;

// copy pasted from stackoverflow
// http://stackoverflow.com/questions/521295/javascript-random-seeds
function seededRandom(s) {
    var m_w  = s;
    var m_z  = 987654321;
    var mask = 0xffffffff;

    return function() {
      m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
      m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;

      var result = ((m_z << 16) + m_w) & mask;
      result /= 4294967296;

      return result + 0.5;
    }
}
var randomGen = seededRandom(42);

class RandomStream extends Stream.Readable {
    constructor() {
        super({ objectMode: true });

        this.n = 0;
    }

    _read() {
        setImmediate(() => {
            if (this.n < N_VALUES) {
                var next = Math.floor(randomGen() * (MAX - MIN)) + MIN;
                this.n ++;
                this.push(next);
            } else {
                this.push(null);
            }
        });
    }
}

function main() {
    var random = new RandomStream();
    //random.on('data', console.log);
    //random.on('end', process.exit);
    //random.on('error', (e) => console.log(e.stack));

    var sorted = new SortStream(random, function(a, b) { return a - b; });

    var n = 1;
    sorted.on('data', (d) => {
        if (n++ == 128*1024)
            heapdump.writeSnapshot();
        console.log(d);
    });
    sorted.on('end', () => {
        console.log('Done');
        process.exit();
    });
    sorted.on('error', (e) => console.log(e.stack));
}

main();
