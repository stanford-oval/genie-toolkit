// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const util = require('util');

const BinaryPPDB = require('../lib/binary_ppdb');

const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');

const BLACKLIST = new Set(['tb', 'channel']);

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('compile-ppdb', {
            addHelp: true,
            description: "Compile one or more PPDB file into a compact binary format."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input PPDB files to compile; use - for standard input'
        });
    },

    execute(args) {
        const builder = new BinaryPPDB.Builder();
        const language = args.locale.split('-')[0];
        const input = readAllLines(args.input_file);

        input.on('data', (line) => {
            line = line.trim();
            let [, word, paraphrase, , , entail] = line.split('|||');
            word = word.trim();
            paraphrase = paraphrase.trim();

            if (language === 'en') {
                if (BLACKLIST.has(word))
                    return;
                // ignore singular/plural relation and verb/gerund
                if (paraphrase === word + 's' || word === paraphrase + 's')
                    return;
                if (paraphrase === word + 'ing' || word === paraphrase + 'ing')
                    return;

                // don't change the mode or tense of the verb
                if (paraphrase.endsWith('ing') !== word.endsWith('ing'))
                    return;
                if (paraphrase.endsWith('ed') !== word.endsWith('ed'))
                    return;
            }

            entail = entail.trim();
            // ensure the meaning stays the same)
            if (entail !== 'Equivalence')
                return;
            builder.add(word, paraphrase);
        });

        return new Promise((resolve, reject) => {
            input.on('end', () => {
                resolve(util.promisify(fs.writeFile)(args.output, builder.serialize()));
            });
            input.on('error', reject);
        });
    }
};
