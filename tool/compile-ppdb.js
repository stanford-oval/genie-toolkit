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
const i18n = require('../lib/i18n');

const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');

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
        parser.addArgument('--include-all', {
            required: false,
            nargs: 0,
            action: 'storeTrue',
            defaultValue: false,
            help: `Include phrase-level PPDB, syntactic PPDB, and dubious paraphrases`
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input PPDB files to compile; use - for standard input'
        });
    },

    execute(args) {
        const builder = new BinaryPPDB.Builder();
        const input = readAllLines(args.input_file);
        const langPack = i18n.get(args.locale);

        input.on('data', (line) => {
            line = line.trim();
            let [, word, paraphrase, , , entail] = line.split('|||');
            word = word.trim();
            paraphrase = paraphrase.trim();

            if (!args.include_all && langPack.isValidParaphrasePair(word, paraphrase))
                return;

            entail = entail.trim();
            // ensure the meaning stays the same)
            if (entail !== 'Equivalence')
                return;
            builder.add(word, paraphrase);
        });

        return new Promise((resolve, reject) => {
            input.on('end', () => {
                console.log(`Found ${builder.size} paraphrase pairs`);
                resolve(util.promisify(fs.writeFile)(args.output, builder.serialize()));
            });
            input.on('error', reject);
        });
    }
};
