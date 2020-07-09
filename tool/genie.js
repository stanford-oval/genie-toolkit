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
    'generate-dialogs': require('./generate-dialogs'),
    'dialog-to-contextual': require('./dialog-to-contextual'),

    'sample': require('./sample'),
    'mturk-make-paraphrase-hits': require('./mturk-make-paraphrase-hits'),
    'mturk-make-validation-hits': require('./mturk-make-validation-hits'),
    'mturk-validate': require('./mturk-validate'),
    'mturk-process-eval-data': require('./mturk-process-eval-data'),

    'augment': require('./augment'),
    'requote': require('./requote'),
    'resample': require('./resample'),
    'split-train-eval': require('./split-train-eval'),
    'typecheck': require('./typecheck'),
    'deduplicate': require('./deduplicate'),

    'train': require('./train'),
    'predict': require('./predict'),
    'evaluate-server': require('./evaluate-server'),
    'evaluate-file': require('./evaluate-file'),
    'manual-annotate': require('./manual-annotate'),
    'manual-annotate-dialog': require('./manual-annotate-dialog'),
    'evaluate-dialog': require('./evaluate-dialog'),
    'demo-dialog': require('./demo-dialog'),
    'server': require('./server'),
    'assistant': require('./assistant'),

    'dataset': require('./dataset'),

    'schemaorg-process-schema': require('./autoqa/schemaorg/process-schema'),
    'schemaorg-normalize-data': require('./autoqa/schemaorg/normalize-data'),
    'schemaorg-trim-class': require('./autoqa/schemaorg/trim-class'),

    'sgd-process-schema': require('./autoqa/sgd/process-schema'),
    'sgd-normalize-data': require('./autoqa/sgd/normalize-data'),

    'wikidata-process-schema': require('./autoqa/wikidata/process-schema'),

    'auto-annotate': require('./autoqa/auto-annotate'),
    'make-string-datasets': require('./autoqa/make-string-datasets'),
    'retrieve-wikidata-labels': require('./autoqa/retrieve-wikidata-labels'),
    'canonical-diffchecker': require('./canonical-diffchecker'),

    'auto-annotate-multiwoz': require('./auto-annotate-multiwoz'),
    'convert-thingtalk-to-multidst': require('./convert-thingtalk-to-multidst'),
    'extract-predicted-slots': require('./extract-predicted-slots'),
    'analyze-dialogue-annotations': require('./analyze-dialogue-annotations')
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
