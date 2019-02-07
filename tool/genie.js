#!/usr/bin/node
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

process.on('unhandledRejection', (up) => { throw up; });

const argparse = require('argparse');

const subcommands = {
    'download-snapshot': require('./download-snapshot'),
    'download-dataset': require('./download-dataset'),

    'generate': require('./generate'),
    'sample': require('./sample'),

    'mturk-make-paraphrase-hits': require('./mturk-make-paraphrase-hits'),
    'mturk-make-validation-hits': require('./mturk-make-validation-hits')
};

async function main() {
    const parser = new argparse.ArgumentParser({
        addHelp: true,
        description: "A tool to generate natural language semantic parsers for programming languages."
    });

    const subparsers = parser.addSubparsers({ title: 'Available sub-commands', dest: 'subcommand' });
    for (let subcommand in subcommands)
        subcommands[subcommand].initArgparse(subparsers);

    const args = parser.parseArgs();
    await subcommands[args.subcommand].execute(args);
}
main();
