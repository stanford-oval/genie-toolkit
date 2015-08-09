// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

// Android platform

const Q = require('q');
const fs = require('fs');

var filesDir = null;

module.exports = {
    init: function() {
        return Q.nfcall(JXMobile.GetDocumentsPath).then(function(dir) {
            filesDir = dir;
            fs.mkdirSync(filesDir + '/tmp');
        });
    },

    getRoot: function() {
        return process.cwd();
    },

    getWritableDir: function() {
        return filesDir;
    },

    getTmpDir: function() {
        return filesDir + '/tmp';
    }
};
