// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const prefs = require('./util/prefs');

const STEP_SIZE = 0.1;

class Model {
    constructor(store, name, extractor, initial) {
        this.name = name;

        this.extractor = extractor;
        this._store = store;
        this.params = store.get(name);
        var needSet = false;
        if (this.params === undefined) {
            needSet = true;
            this.params = initial;
        }
        if (this.params === undefined)
            this.params = {};
        if (needSet)
            store.set(name, this.params);
    }

    update(gradient) {
        for (var name in gradient)
            this.params[name] = (this.params[name] || 0) + STEP_SIZE * gradient[name];
        this._store.changed();
    }
}

function dotProduct(a, b) {
    var score = 0;
    for (var name in b)
        score += (a[name] || 0) * (b[name] || 0);
    return score;
}

function expNormalize(array) {
    var max = -Infinity;
    for (var el of array)
        max = Math.max(el, max);
    if (max === -Infinity)
        return false;
    var sum = 0;
    for (var i = 0; i < array.length; i++) {
        array[i] = Math.exp(array[i] - max);
        sum += array[i];
    }
    if (sum <= 0)
        return false;
    for (var i = 0; i < array.length; i++)
        array[i] = array[i] / sum;
    return true;
}

class SoftmaxModel extends Model {
    score(example) {
        var features = this.extractor(example);
        return dotProduct(features, this.params);
    }

    scoreAll(examples) {
        var scores = new Array(examples.length);
        var sum = 0;

        examples.forEach(function(ex, i) {
            scores[i] = this.score(ex);
            sum += Math.exp(scores[i]);
        }, this);
        var mapped = examples.map(function(ex, i) {
            return {
                ex: ex,
                score: scores[i],
                prob: Math.exp(scores[i])/sum
            };
        });
        mapped.sort(function(a, b) {
            return b.score - a.score;
        });
        return mapped;
    }

    learn(examples, label) {
        var scores = new Array(examples.length);
        var trueScores = new Array(examples.length);
        var features = new Array(examples.length);

        examples.forEach(function(ex, i) {
            features[i] = this.extractor(ex);
            var score = dotProduct(features[i], this.params);
            scores[i] = score;
            if (ex === label)
                trueScores[i] = score;
            else
                trueScores[i] = -Infinity;
        }, this);
        if (!expNormalize(scores))
            return;
        if (!expNormalize(trueScores))
            return;

        var gradient = {};
        examples.forEach(function(ex, i) {
            var diff = trueScores[i] - scores[i];
            for (var name in features[i])
                gradient[name] = (gradient[name] || 0) + features[i][name] * diff;
        }, this);

        this.update(gradient);
    }
}

class DummyStore {
    constructor() {
        this._obj = {};
    }

    get(name) {
        return this._obj[name];
    }

    set(name, value) {
        this._obj[name] = value;
    }

    changed() {
    }
}

module.exports = class MachineLearner {
    constructor(platform, realML) {
        this._platform = platform;
        this._store = null;
        this._realML = realML;
    }

    start() {
        return Q();
    }

    stop() {
        if (this._store)
            return this._store.flush();
        else
            return Q();
    }

    _ensureStore() {
        if (this._store)
            return;

        if (this._realML) {
            // flush at most every 10s, because we don't care if we lose some learning
            // case of a crash, and this gets causes a lot of writing if flushed to disk
            this._store = new prefs.FilePreferences(this._platform.getWritableDir() + '/ml.db', 10000);
        } else {
            this._store = new DummyStore();
        }
    }

    getModel(name, type, featureExtractor, initialParams) {
        console.log('Creating ML model ' + name + ' (' + type + ')');
        this._ensureStore();

        switch(type) {
        case 'softmax':
            return new SoftmaxModel(this._store, name, featureExtractor, initialParams);
        default:
            throw new Error('Unsupported ML model type ' + type);
        }
    }
}
