// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const Stream = require('stream');

class UnionStream extends Stream.Readable {
    constructor(children, transform) {
        super({ objectMode: true });
        this.children = children;
        this._nactive = children.length;

        children.forEach((c, i) => {
            c.on('data', (data) => {
                if (transform) {
                    if (!transform(i, data))
                        return;
                }
                this.push(data)
            });
            c.on('end', () => this._childEnded());
            c.on('error', (e) => this.emit('error', e));
        });
    }

    _read() {}

    _childEnded() {
        this._nactive--;
        if (this._nactive === 0)
            this.push(null);
    }
}
