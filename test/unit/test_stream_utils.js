// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import assert from 'assert';
import * as StreamUtils from '../../lib/utils/stream-utils';

async function readall(readable) {
    return new Promise((resolve, reject) => {
        const buffer = [];
        readable.on('data', (data) => {
            buffer.push(data);
        });
        readable.on('end', () => resolve(buffer));
        readable.on('error', reject);
    });
}

async function testChainStream() {
    // test object mode (simplest)
    const s1 = new StreamUtils.ArrayStream([1, 2, 3, 4], { objectMode: true });
    const s2 = new StreamUtils.ArrayStream([5, 6, 7, 8], { objectMode: true });

    const chain1 = StreamUtils.chain([s1, s2], { objectMode: true });

    assert.deepStrictEqual(await readall(chain1), [1, 2, 3, 4, 5, 6, 7, 8]);

    // test highwatermarks in various ways

    // first the chain is putting pressure (low highWaterMark)
    const s3 = new StreamUtils.ArrayStream(['1234', '56789012', '34']);
    s3.setEncoding('utf8'); // keep it as strings

    const s4 = new StreamUtils.ArrayStream(['1234', '56789012', '34']);
    s4.setEncoding('utf8'); // keep it as strings

    const chain2 = StreamUtils.chain([s3, s4], { highWaterMark: 4 });

    const read1 = await readall(chain2);
    //console.log(read1);
    assert.deepStrictEqual(read1.join(''), '1234567890123412345678901234');

    // now the sources are putting pressure (low highWaterMark)
    const s5 = new StreamUtils.ArrayStream(['1234', '56789012', '34'], { highWaterMark: 4 });
    s5.setEncoding('utf8'); // keep it as strings

    const s6 = new StreamUtils.ArrayStream(['1234', '56789012', '34'], { highWaterMark: 4 });
    s6.setEncoding('utf8'); // keep it as strings

    const chain3 = StreamUtils.chain([s5, s6], {});

    const read2 = await readall(chain3);
    //console.log(read2);
    assert.deepStrictEqual(read2.join(''), '1234567890123412345678901234');

    // test decoding utf8 across stream boundaries

    const s7 = new StreamUtils.ArrayStream([Buffer.from('1234'), Buffer.from([0xc3])]);
    const s8 = new StreamUtils.ArrayStream([Buffer.from([0xa9]), Buffer.from('5678')]);

    const chain4 = StreamUtils.chain([s7, s8], {});
    chain4.setEncoding('utf8');

    const read3 = await readall(chain4);
    //console.log(read3);
    assert.deepStrictEqual(read3.join(''), '1234é5678');

    const s9 = new StreamUtils.ArrayStream([Buffer.from('1234'), Buffer.from([0xc3])]);
    s9.setEncoding('utf8'); // eager decoding
    const s10 = new StreamUtils.ArrayStream([Buffer.from([0xa9]), Buffer.from('5678')]);
    s10.setEncoding('utf8'); // eager decoding

    const chain5 = StreamUtils.chain([s9, s10], {});
    chain5.setEncoding('utf8');

    const read4 = await readall(chain5);
    //console.log(read4);
    assert.deepStrictEqual(read4.join(''), '1234��5678');

    // with separator
    const s5s = new StreamUtils.ArrayStream(['1234', '56789012', '34'], { highWaterMark: 4 });
    s5s.setEncoding('utf8'); // keep it as strings

    const s6s = new StreamUtils.ArrayStream(['1234', '56789012', '34'], { highWaterMark: 4 });
    s6s.setEncoding('utf8'); // keep it as strings

    const chain6 = StreamUtils.chain([s5s, s6s], { separator: '---' });
    const read6 = await readall(chain6);
    //console.log(read2);
    assert.deepStrictEqual(read6.join(''), '12345678901234---12345678901234');

    const s7s = new StreamUtils.ArrayStream(['1234', '56789012', '34'], { highWaterMark: 4 });
    s7s.setEncoding('utf8'); // keep it as strings

    const chain7 = StreamUtils.chain([s7s], { separator: '---' });
    const read7 = await readall(chain7);
    //console.log(read2);
    assert.deepStrictEqual(read7.join(''), '12345678901234');

    const s3s = new StreamUtils.ArrayStream(['1234', '56789012', '34']);
    s3s.setEncoding('utf8'); // keep it as strings

    const s4s = new StreamUtils.ArrayStream(['1234', '56789012', '34']);
    s4s.setEncoding('utf8'); // keep it as strings

    const chain8 = StreamUtils.chain([s3s, s4s], { highWaterMark: 4, separator: '---' });
    const read8 = await readall(chain8);
    //console.log(read2);
    assert.deepStrictEqual(read8.join(''), '12345678901234---12345678901234');
}

async function main() {
    await testChainStream();
}
export default main;
if (!module.parent)
    main();
