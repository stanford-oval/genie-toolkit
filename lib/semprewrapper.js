// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const Url = require('url');
const path = require('path');
const child_process = require('child_process');

const JsonDatagramSocket = require('./json_datagram_socket');

// Manage an instance of SEMPRE running in the background, using our API

const ARGS = ['-ea', '-Dmodules=core,overnight',
              '-cp', 'libsempre/*:lib/*',
              'edu.stanford.nlp.sempre.Main',
              '-LanguageAnalyzer', 'corenlp.CoreNLPAnalyzer',
              '-Builder.parser', 'FloatingParser',
              '-FloatingParser.executeAllDerivations', 'true',
              '-Builder.executor', 'NormalFormExecutor',
              '-Grammar.inPaths', '../data/thingtalk.grammar',
              // The overnight paper does not include "rule" features
              // I have them because they help the parser ignore too many
              // derivation that use $StringValue (which is a catch all)
              '-FeatureExtractor.featureDomains', 'denotation', 'rule',
              '-FeatureExtractor.featureComputers', 'overnight.OvernightFeatureComputer',
              '-OvernightFeatureComputer.featureDomains',
              'match', 'ppdb', 'skip-bigram', 'root', 'alignment', 'lexical',
              'root_lexical', 'lf', 'coarsePrune',
              '-OvernightDerivationPruningComputer.applyHardConstraints',
              '-DerivationPruner.pruningComputer', 'overnight.OvernightDerivationPruningComputer',
              '-FloatingParser.maxDepth', '11',
              '-Parser.beamSize', '20',
              '-wordAlignmentPath', '../data/thingtalk.word_alignments.berkeley',
              '-phraseAlignmentPath', '../data/thingtalk.phrase_alignments',
              '-PPDBModel.ppdbModelPath', '../data/thingtalk-ppdb.txt',
              '-Learner.maxTrainIters', '1',
              '-SimpleLexicon.inPaths', '../data/thingtalk.lexicon',
              '-DataSet.inPaths', 'train:../data/thingtalk.examples',
              '-Main.streamapi', 'true'];

module.exports = class SempreWrapper {
    constructor(silent) {
        this._socket = null;
        this._child = null;

        this._pending = [];
        this._silent = silent;
    }

    start() {
        var dirname = path.resolve(path.dirname(module.filename), '../sempre');
        this._child = child_process.spawn('/usr/bin/java', ARGS,
                                          { cwd: dirname,
                                            stdio: ['pipe','pipe', (this._silent ? 'ignore' : 2)],
                                          });

        this._socket = new JsonDatagramSocket(this._child.stdout, this._child.stdin);
        this._socket.on('data', this._onData.bind(this));
    }

    stop() {
        this._child.kill();
        this._child = null;
    }

    _onData(msg) {
        if (msg.status) {
            if (msg.status === 'Ready')
                console.log('SEMPRE is now Ready');
            else
                console.log('SEMPRE reached unexpected status ' + msg.status);
            return;
        }

        if (this._pending.length === 0) {
            if (msg.error) {
                console.error("Received error from SEMPRE: ", msg.error);
                return;
            } else {
                console.error("Received unexpected message from SEMPRE");
                return;
            }
        }

        var next = this._pending.shift();
        if (msg.error)
            next.reject(new Error(msg.error));
        else
            next.resolve(msg.answer);
    }

    sendUtterance(session, utterance) {
        console.log('Sending utterance "' + utterance + '" on session ' + session);

        var msg = { session: session,
                    utterance: utterance };

        var defer = Q.defer();
        this._pending.push(defer);
        this._socket.write(msg);

        return defer.promise;
    }
}
