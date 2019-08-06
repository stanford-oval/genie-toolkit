// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2017-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const runtime = require('./runtime');

const { coin } = require('../random');

// heuristically collected coefficients of the duration of generating each depth
const DEPTH_PROGRESS_MULTIPLIERS = [
    50, 1500, 15000, 40000, 300000, 3000000, 3000000, 3000000, 3000000
];

module.exports = class BottomupGrammar extends runtime.Grammar {
    constructor(options) {
        super(options);

        this._finalized = false;
    }

    _estimateDepthSize(charts, depth) {
        const ruleEstimates = {};
        let estimate = 0;
        for (let nonterminal in this._rules) {
            const minDistance = this._minDistanceFromRoot[nonterminal];
            if (minDistance === undefined || minDistance > this._options.maxDepth - depth)
                continue;
            const rules = this._rules[nonterminal];

            const estimates = [];
            ruleEstimates[nonterminal] = estimates;
            estimates.length = rules.length;
            for (let rulenumber = 0; rulenumber < rules.length; rulenumber++) {
                const [expansion,] = rules[rulenumber];
                let [/*maxdepth*/, /*worstCaseGenSize*/, estimatedGenSize, targetGenSize]
                    = estimateRuleSize(charts, depth, nonterminal, rulenumber, expansion, this._averagePruningFactor, this._options);

                estimatedGenSize = Math.min(Math.round(estimatedGenSize), targetGenSize);
                estimates[rulenumber] = estimatedGenSize;
                estimate += estimatedGenSize;
            }
        }
        return [estimate, ruleEstimates];
    }

    _initializeContexts(contexts, charts, depth) {
        for (let name in this._contexts) {
            charts[depth][name] = [];

            const contextfn = this._contexts[name];
            for (let context of contexts) {
                if (contextfn(context.value))
                    charts[depth][name].push(context);
            }

            if (this._options.debug && charts[depth][name].length > 0)
                console.log(`stats: size(charts[${depth}][${name}]) = ${charts[depth][name].length}`);
        }
    }

    *generate(contexts) {
        this.finalize();
        const charts = [];

        // reset progress counter for this round (only if contextual)
        this._progress = 0;

        // compute the level of progress bar that should be reached at the end of each depth
        // using the heuristic coefficients, renormalized based on the chosen max depth
        const progressAtDepth = [DEPTH_PROGRESS_MULTIPLIERS[0]];
        for (let depth = 1; depth <= this._options.maxDepth; depth++)
            progressAtDepth.push(progressAtDepth[depth-1] + DEPTH_PROGRESS_MULTIPLIERS[depth]);
        for (let depth = 0; depth <= this._options.maxDepth; depth++)
            progressAtDepth[depth] /= progressAtDepth[progressAtDepth.length-1];

        for (let depth = 0; depth <= this._options.maxDepth; depth++) {
            if (this._options.debug)
                console.log(`--- DEPTH ${depth}`);
            charts[depth] = {};
            if (depth === 0) {
                this._initializeContexts(contexts, charts, depth);
            } else {
                for (let name in this._contexts)
                    charts[depth][name] = [];
            }

            for (let nonterminal in this._rules)
                charts[depth][nonterminal] = [];

            // compute estimates of how many things we will produce at this depth
            let [estimatedTotal, estimatedPerRule] = this._estimateDepthSize(charts, depth);
            let actual = 0;

            const targetProgress = progressAtDepth[depth];

            // subdivide the remaining progress among the (estimated) derivations we'll generate at this depth
            let progressIncrement;
            if (estimatedTotal >= 1)
                progressIncrement = (targetProgress - this._progress)/estimatedTotal;
            else
                progressIncrement = 0;

            for (let nonterminal in this._rules) {
                const minDistance = this._minDistanceFromRoot[nonterminal];
                if (minDistance === undefined || minDistance > this._options.maxDepth - depth)
                    continue;
                const isRoot = minDistance === 0;

                for (let rulenumber = 0; rulenumber < this._rules[nonterminal].length; rulenumber++) {
                    const rule = this._rules[nonterminal][rulenumber];

                    let ruleProductivity = 0;
                    for (let derivation of expandRule(charts, depth, nonterminal, rulenumber, rule, this._averagePruningFactor, this._options)) {
                        if (derivation === null)
                            continue;
                        //let key = `$${nonterminal} -> ${derivation}`;
                        /*if (everything.has(key)) {
                            // FIXME we should not generate duplicates in the first place
                            throw new Error('generated duplicate: ' + key);
                            continue;
                        }*/
                        //everything.add(key);
                        if (isRoot)
                            yield [depth, derivation];
                        else
                            charts[depth][nonterminal].push(derivation);

                        this._progress += progressIncrement;
                        actual ++;
                        ruleProductivity++;

                        if (actual >= estimatedTotal || this._progress >= targetProgress)
                            progressIncrement = 0;
                        if (this._progress > targetProgress)
                            this._progress = targetProgress;
                        assert(this._progress >= 0 && this._progress <= 1);
                        if (actual % 5000 === 0)
                            this.emit('progress', this._progress);
                    }

                    // adjust our estimated total size, based on what just happened with this rule
                    const ruleEstimate = estimatedPerRule[nonterminal][rulenumber];
                    assert(ruleEstimate >= 0);

                    // subtract our old estimate, and add the real number of derivations we emitted
                    estimatedTotal -= ruleEstimate;
                    estimatedTotal += ruleProductivity;

                    // adjust the amount of progress we make on each sentence
                    // this ensures that the progress is monotonic, even though it will appear to
                    // move at different speeds

                    assert(estimatedTotal >= actual);
                    if (estimatedTotal === actual || this._progress >= targetProgress)
                        progressIncrement = 0;
                    else
                        progressIncrement = (targetProgress - this._progress) / (estimatedTotal - actual);
                    if (this._progress > targetProgress)
                        this._progress = targetProgress;
                    this.emit('progress', this._progress);
                }
                if (this._options.debug && charts[depth][nonterminal].length > 0)
                    console.log(`stats: size(charts[${depth}][${nonterminal}]) = ${charts[depth][nonterminal].length}`);
            }

            if (this._options.debug)
                console.log();

            this._progress = targetProgress;
        }

        // ensure that progress goes up to 1 at the end (to close the progress bar)

        this._progress = 1;
    }
};

const POWERS = [1, 1, 1, 1, 1];
for (let i = 5; i < 20; i++)
    POWERS[i] = 0.5 * POWERS[i-1];
const EXPONENTIAL_PRUNE_SIZE = 50000000;

function computeWorstCaseGenSize(charts, depth, expansion, maxdepth) {
    const anyNonTerm = expansion.some((x) => x instanceof runtime.NonTerminal);
    if (!anyNonTerm)
        return depth === 0 ? 1 : 0;
    if (depth === 0)
        return 0;

    let worstCaseGenSize = 0;
    for (let i = 0; i < expansion.length; i++) {
        let fixeddepth = depth-1;

        /*worstCaseGenSize += (function recursiveHelper(k) {
            if (k === expansion.length)
                return 1;
            if (k === i) {
                if (expansion[k] instanceof NonTerminal)
                    return charts[fixeddepth][expansion[k].symbol].length * recursiveHelper(k+1);
                else
                    return 0;
            }
            if (expansion[k] instanceof NonTerminal) {
                let sum = 0;
                for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++)
                    sum += charts[j][expansion[k].symbol].length * recursiveHelper(k+1);
                return sum;
            } else {
                return recursiveHelper(k+1);
            }
        })(0);*/

        // non-recursive version of the commented code above, tmp takes the role of "recursiveHelper(k+1)"
        let tmp = 1;

        for (let k = expansion.length - 1; k >= 0; k--) {
            if (k === i) {
                if (expansion[k] instanceof runtime.NonTerminal)
                    tmp = charts[fixeddepth][expansion[k].symbol].length * tmp;
                else
                    tmp = 0;
            } else if (expansion[k] instanceof runtime.NonTerminal) {
                let sum = 0;
                for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++)
                    sum += charts[j][expansion[k].symbol].length * tmp;
                tmp = sum;
            }
        }

        worstCaseGenSize += tmp;
    }
    return worstCaseGenSize;
}

function estimateRuleSize(charts, depth, nonterminal, rulenumber, expansion, averagePruningFactor, options) {
    // first compute how many things we expect to produce in the worst case
    let maxdepth = depth-1;
    let worstCaseGenSize = computeWorstCaseGenSize(charts, depth, expansion, maxdepth);
    if (worstCaseGenSize === 0)
        return [maxdepth, 0, 0, 0, 1];

    // prevent exponential behavior!
    while (worstCaseGenSize >= EXPONENTIAL_PRUNE_SIZE && maxdepth >= 0) {
        maxdepth--;
        worstCaseGenSize = computeWorstCaseGenSize(charts, depth, expansion, maxdepth);
    }
    if (maxdepth < 0 || worstCaseGenSize === 0)
        return [maxdepth, 0, 0, 0, 1];

    const estimatedPruneFactor = averagePruningFactor[nonterminal][rulenumber];
    const estimatedGenSize = worstCaseGenSize * estimatedPruneFactor;
    //const targetGenSize = nonterminal === 'root' ? Infinity : TARGET_GEN_SIZE * POWERS[depth];
    const targetGenSize = options.targetGenSize * POWERS[depth];

    return [maxdepth, worstCaseGenSize, estimatedGenSize, targetGenSize, estimatedPruneFactor];
}

function *expandRule(charts, depth, nonterminal, rulenumber, [expansion, combiner], averagePruningFactor, options) {
    const rng = options.rng;

    const anyNonTerm = expansion.some((x) => x instanceof runtime.NonTerminal);

    if (!anyNonTerm) {
        if (depth === 0)
            yield combiner(expansion);
        return;
    }
    if (depth === 0)
        return;

    // for each piece of the expansion, we take turn and use
    // depth-1 of that, depth' < depth-1 of anything before, and
    // depth' <= depth-1 of anything after
    // terminals and placeholders are treated as having only
    // 0 productions
    //
    // this means the order in which we generate is
    // (d-1, 0, 0, ..., 0)
    // (d-1, 0, 0, ..., 1)
    // ...
    // (d-1, 0, 0, ..., d-1)
    // (d-1, 0, 0, ..., 1, 0)
    // ...
    // (d-1, 0, 0, ..., 1, d-1)
    // (d-1, 0, 0, ..., 2, 0)
    // ...
    // (d-1, 0, 0, ..., d-1, d-1)
    // ...
    // (d-1, d-1, d-1, ..., d-1)
    // (0, d-1, 0, ..., 0)
    // (0, d-1, 0, ..., 1)
    // ...
    // (0, d-1, 0, ..., d-1)
    // ...
    // (0, d-1, d-1, ..., d-1)
    // (1, d-1, 0, ..., 0)
    // ...
    // (1, d-1, d-1, ..., d-1)
    // ...
    // (d-2, d-1, 0, ..., 0)
    // ...
    // (d-2, d-1, d-1, ..., d-1)
    // ...
    // (d-2, 0, d-1, 0, ..., 0)
    // ...
    // (d-2, d-2, d-1, d-1, ..., d-1)
    // ...
    // (0, 0, ..., 0, d-1)
    // (0, 0, ..., 1, d-1)
    // ...
    // (0, 0, ..., d-2, d-1)
    // ...
    // (d-2, d-2, ..., d-2, d-1)
    //
    // This is a SUPEREXPONENTIAL algorithm
    // Keep the depth low if you want to live

    //console.log('expand $' + nonterminal + ' -> ' + expansion.join(''));

    // to avoid hitting exponential behavior too often, we tweak the above
    // algorithm to not go above maxdepth for all but one non-terminal,
    // and then cycle through which non-terminal is allowed to grow

    const [maxdepth, worstCaseGenSize, estimatedGenSize, targetGenSize, estimatedPruneFactor] =
        estimateRuleSize(charts, depth, nonterminal, rulenumber, expansion, averagePruningFactor, options);

    if (maxdepth < depth-1 && options.debug)
        console.log(`expand NT[${nonterminal}] -> ${expansion.join(' ')} : reduced max depth to avoid exponential behavior`);

    if (options.debug)
        console.log(`expand NT[${nonterminal}] -> ${expansion.join(' ')} : worst case ${worstCaseGenSize}, expect ${Math.round(estimatedGenSize)} (target ${targetGenSize})`);
    const now = Date.now();

    const basicCoinProbability = Math.min(1, targetGenSize/estimatedGenSize);
    let coinProbability = basicCoinProbability;

    let choices = [];
    //let depths = [];
    let actualGenSize = 0;
    let prunedGenSize = 0;
    for (let i = 0; i < expansion.length; i++) {
        let fixeddepth = depth-1;
        yield* (function *recursiveHelper(k) {
            if (k === expansion.length) {
                //console.log('combine: ' + choices.join(' ++ '));
                //console.log('depths: ' + depths);
                if (!(coinProbability < 1) || coin(coinProbability, rng)) {
                    let v = combiner(choices.map((c) => c instanceof runtime.Choice ? c.choose(rng) : c));
                    if (v !== null) {
                        actualGenSize ++;
                        if (actualGenSize < targetGenSize / 2 &&
                            actualGenSize + prunedGenSize >= 1000 &&
                            actualGenSize / (actualGenSize + prunedGenSize) < 0.001 * estimatedPruneFactor) {
                            // this combiner is pruning so aggressively it's messing up our sampling
                            // disable it
                            coinProbability = 1;
                        }
                        // unless we have generated more than half of our target size, then we bring it back
                        if (actualGenSize >= targetGenSize / 2)
                            coinProbability = basicCoinProbability;

                        yield v;
                    } else {
                        prunedGenSize ++;
                    }
                }
                return;
            }
            if (k === i) {
                if (expansion[k] instanceof runtime.NonTerminal) {
                    for (let candidate of charts[fixeddepth][expansion[k].symbol]) {
                        if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                            continue;
                        choices[k] = candidate;
                        //depths[k] = fixeddepth;
                        yield* recursiveHelper(k+1);
                    }
                }
                return;
            }
            if (expansion[k] instanceof runtime.NonTerminal) {
                for (let j = 0; j <= (k > i ? maxdepth : maxdepth-1); j++) {
                    for (let candidate of charts[j][expansion[k].symbol]) {
                        if (combiner.isReplacePlaceholder && k === 0 && !candidate.hasPlaceholders())
                            continue;
                        choices[k] = candidate;
                        //depths[k] = j;
                        yield* recursiveHelper(k+1);
                    }
                }
            } else {
                choices[k] = expansion[k];
                yield* recursiveHelper(k+1);
            }
        })(0);
    }

    //console.log('expand $' + nonterminal + ' -> ' + expansion.join('') + ' : actual ' + actualGenSize);

    if (actualGenSize + prunedGenSize === 0)
        return;
    const newEstimatedPruneFactor = actualGenSize / (actualGenSize + prunedGenSize);

    const elapsed = Date.now() - now;
    if (options.debug) {
        console.log(`expand NT[${nonterminal}] -> ${expansion.join(' ')} : emitted ${
            actualGenSize} (took ${(elapsed/1000).toFixed(2)} seconds, coin prob ${coinProbability}, pruning factor ${
                (newEstimatedPruneFactor * 100).toFixed(2)}%)`);
    }

    const movingAverageOfPruneFactor = (0.01 * estimatedPruneFactor + newEstimatedPruneFactor) / (1.01);
    averagePruningFactor[nonterminal][rulenumber] = movingAverageOfPruneFactor;
}
