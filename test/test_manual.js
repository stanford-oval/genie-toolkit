// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
Q.longStackSupport = true;
process.on('unhandledRejection', (up) => { throw up; });

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Utils = require('thingtalk/lib/utils');

const Engine = require('../lib/engine');
const ExecWrapper = require('../lib/apps/exec_wrapper');

function* timerTest(__builtin,env) {
  "use strict";
  let _t_0;
  let _t_1;
  let _t_2;
  let _t_3;
  let _t_4;
  let _t_5;
  let _t_6;
  let _t_7;
  let _t_8;
  let _t_9;
  let _t_10;
  let _t_11;
  let _t_12;
  let _t_13;
  let _t_14;
  try {
    _t_1 = new Date(1524965830645);
    _t_2 = 1000;
    _t_0 = yield env.invokeTimer(_t_1, _t_2);
    {
      let _iter_tmp = yield _t_0.next();
      while (!_iter_tmp.done) {
        _t_3 = _iter_tmp.value;
        try {
          _t_4 = {};
          _t_5 = 2;
          _t_4.count = _t_5;
          _t_6 = 10;
          _t_4.size = _t_6;
          _t_7 = yield env.invokeQuery(0, _t_4);
          _t_8 = _t_7[Symbol.iterator]();
          {
            let _iter_tmp = yield _t_8.next();
            while (!_iter_tmp.done) {
              _t_9 = _iter_tmp.value;
              _t_10 = _t_9[0];
              _t_11 = _t_9[1];
              _t_12 = _t_11.data;
              _t_13 = {};
              _t_13.data = _t_12;
              _t_14 = _t_13.data;
              try {
                yield env.output(String(_t_10), _t_13);
              } catch(_exc_) {
                env.reportError("Failed to invoke action", _exc_);
              }
              _iter_tmp = yield _t_8.next();
            }
          }
        } catch(_exc_) {
          env.reportError("Failed to invoke query", _exc_);
        }
        _iter_tmp = yield _t_0.next();
      }
    }
  } catch(_exc_) {
    env.reportError("Failed to invoke timer", _exc_);
  }
}

function doTest(fn, engine) {
    let env = new ExecWrapper(engine, { icon: 'org.foo' }, {
        functions: [{ selector: new Ast.Selector.Device('org.thingpedia.builtin.test', 'org.thingpedia.builtin.test', null), channel: 'get_data', type: 'query', }],
        states: 0
    }, {
        output(icon, outputType, outputvalue) {
            console.log('output', outputType, outputvalue);
        },
        error(icon, err) {
            console.error(err);
        }
    });

    return Promise.resolve((Utils.generatorToAsync(fn))(ThingTalk.Builtin, env));
}

function main() {
    var platform = require('./test_platform').newInstance();

    var engine;
    Promise.resolve().then(() => {
        engine = new Engine(platform);
        return engine.open();
    }).then(() => {
        return doTest(timerTest, engine);
    }).then(() => {
        return engine.close();
    });
}

main();
