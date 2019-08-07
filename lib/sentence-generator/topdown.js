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

const assert = require('assert');
const runtime = require('./runtime');

const { coin } = require('../random');

const MAX_ATTEMPTS = 10000;

const POWERS = [1e-3, 1e-2, 1e-1, 1];
for (let i = 5; i < 20; i++)
    POWERS[i] = 1;

module.exports = class TopdownGrammar extends runtime.Grammar {
    constructor(options) {
        super(options);

        this._currentContext = null;

        this._symbolHeight = {};
        this._symbolRuleHeight = {};
    }



    // sample one derivation from nonTerm, with at most depth
    _sampleDerivation(nonTerm, maxDepth) {
        if (maxDepth < 0)
            return null;

        const rules = this._rules[nonTerm];

        let N = 0;
        // count the rules that can be productive with the current maxdepth limit
        for (let i = 0; i < rules.length; i++) {
            let rule = rules[i];
            if (rule.height > maxDepth)
                continue;
            N++;
        }

        // there must always be a rule, because either
        // - the current nonTerm is $root, and we have a selected a minimum value
        // of maxDepth that guarantees the root is productive
        // -or-
        // - the parent is using a rule that it is productive, which means
        // the height of the parent rule is at most maxDepth+1, hence our height
        // it at most maxDepth, hence we must have at least one rule ourselves
        // of height at most maxDepth
        if (N === 0) {
            console.log(nonTerm, maxDepth, rules);
            throw new Error('???');
        }

        // sample one rule from rules
        // we use a loop so we can sample multiple times, until we
        // find one that works, but we always sample w/o replacement

        let skipped = 0;
        for (let i = 0; i < rules.length; i++) {
            let rule = rules[i];
            if (rule.height > maxDepth)
                continue;

            if (!coin(1/(N-skipped))) {
                skipped ++;
                continue;
            }

            let ok = true;

            // try running this rule until we find a combination that
            // passes the semantic function, or at most ${MAX_ATTEMPTS} attempts
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                let children = [];

                for (let part of rule.expansion) {
                    if (part instanceof runtime.NonTerminal) {
                        if (part.isContext) {
                            children.push(this._currentContext);
                        } else {
                            let child = this._sampleDerivation(part.symbol, maxDepth-1);
                            if (child === null) {
                                ok = false;
                                break;
                            }
                            children.push(child);
                        }
                    } else if (part instanceof runtime.Choice) {
                        children.push(part.choose(this._rng));
                    } else {
                        children.push(part);
                    }
                }
                if (!ok) {
                    // maxed out in depth, try a different rule
                    break;
                }

                let newDerivation = rule.combiner(children);
                if (newDerivation !== null)
                    return newDerivation;
            }
        }

        // maxed out in depth, or failed all rules after ${MAX_ATTEMPTS}
        // bail
        return null;
    }

    *generate(contexts) {
        this.finalize();
        let minDepth = this._nonTerminalHeight['$root'];
        console.log('minDepth', minDepth);

        for (let depth = minDepth; depth <= this._options.maxDepth; depth++) {
            const targetGenSize = this._options.targetGenSize * POWERS[depth];

            const baseProgress = depth / (this._options.maxDepth + 2 - minDepth);
            this._progress = baseProgress;
            this.emit('progress', this._progress);
            console.log(depth, this._progress);

            let generated = 0;
            for (let i = 0; i < targetGenSize; i++) {
                const next = this._sampleDerivation('$root', depth);
                if (next !== null)
                    yield [depth, next];
                else
                    break;

                generated ++;
                if (generated % 10 === 0) {
                    this._progress = baseProgress + (i / targetGenSize) / (this._options.maxDepth + 2 - minDepth);
                    this.emit('progress', this._progress);
                    console.log(depth, this._progress);
                }
            }
        }

        // ensure that progress goes up to 1 at the end (to close the progress bar)
        this._progress = 1;
    }
};
