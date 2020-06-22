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
    'sample-constants': require('./sample-constants'),

    'generate': require('./generate'),
    'generate-contextual': require('./generate-contextual'),
    'extract-contexts': require('./extract-contexts'),
    'contextualize': require('./contextualize'),
    'generate-dialogs': require('./generate-dialogs'),
    'dialog-to-contextual': require('./dialog-to-contextual'),

    'sample': require('./sample'),
    'contextual-prepare-turk': require('./contextual-prepare-turk'),
    'mturk-make-paraphrase-hits': require('./mturk-make-paraphrase-hits'),
    'mturk-make-validation-hits': require('./mturk-make-validation-hits'),
    'mturk-validate': require('./mturk-validate'),
    'mturk-process-eval-data': require('./mturk-process-eval-data'),

    'augment': require('./augment'),
    'requote': require('./requote'),
    'resample': require('./resample'),
    'split-train-eval': require('./split-train-eval'),
    'typecheck': require('./typecheck'),

    'train': require('./train'),
    'predict': require('./predict'),
    'evaluate-server': require('./evaluate-server'),
    'evaluate-file': require('./evaluate-file'),
    'manual-annotate': require('./manual-annotate'),
    'manual-annotate-dialog': require('./manual-annotate-dialog'),
    'evaluate-dialog': require('./evaluate-dialog'),
    'demo-dialog': require('./demo-dialog'),
    'server': require('./server'),

    'dataset': require('./dataset'),

    'webqa-process-schemaorg': require('./webqa-process-schemaorg'),
    'webqa-auto-primitive': require('./webqa-auto-primitive'),
    'webqa-normalize-data': require('./webqa-normalize-data'),
    'webqa-make-string-datasets': require('./webqa-make-string-datasets'),
    'webqa-trim-class': require('./webqa-trim-class'),
    'webqa-paraphrase-transfer': require('./webqa-paraphrase-transfer'),
    'webqa-update-canonicals': require('./webqa-update-canonicals'),
    'webqa-retrieve-wikidata-labels': require('./webqa-retrieve-wikidata-labels'),
    'webqa-annotation-diffchecker': require('./webqa-annotation-diffchecker')
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
