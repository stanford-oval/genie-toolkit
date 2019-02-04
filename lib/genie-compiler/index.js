// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

process.on('unhandledRejection', (up) => { throw up; });

const fs = require('fs');
const path = require('path');
const argparse = require('argparse');

const grammar = require('./grammar');

function readall(stream) {
    return new Promise((resolve, reject) => {
        const buffers = [];
        let total = 0;
        stream.on('data', (buf) => {
            buffers.push(buf);
            total += buf.length;
        });
        stream.on('end', () => {
            resolve(Buffer.concat(buffers, total));
        });
        stream.on('error', reject);
        stream.resume();
    });
}

async function main() {
    const parser = new argparse.ArgumentParser({
        addHelp: true,
        description: 'Compile a sentence generator grammar'
    });

    parser.addArgument('input', {
        required: false,
        type: fs.createReadStream,
        default: process.stdin
    });
    parser.addArgument(['-o', '--output'], {
        required: true,
    });

    const args = parser.parseArgs();
    const input = (await readall(args.input)).toString('utf8');

    let parsed;
    try {
        parsed = grammar.parse(input);
    } catch(e) {
        if (e.location) {
            console.error(`Syntax error at line ${e.location.start.line} column ${e.location.start.column}: ${e.message}`);
            process.exit(1);
        } else {
            throw e;
        }
    }

    const runtime = require.resolve('../../lib/sentence-generator/runtime');
    const runtimedir = path.relative(path.dirname(args.output),
                                     path.dirname(runtime));

    const output = fs.createWriteStream(args.output);
    parsed.codegen(output, path.join(runtimedir, 'runtime'));
    output.end();
}
main();
