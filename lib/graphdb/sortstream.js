// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const tmp = require('tmp');
const events = require('events');
const fs = require('fs');
const Stream = require('stream');
const byline = require('byline');

const VAR_TMP = '/var/tmp';

const MAX_SORT_BUFFER = 128*1024; // at most 128K tuples (around few megs) in memory at once

class FileBuffer extends events.EventEmitter {
    constructor(data) {
        super();

        this.data = null;

        this._writeReady = false;
        this._readEof = false;
        this._cleanup = null;
        this._readStream = null;
        this._readCallbacks = [];
        tmp.file({ mode: 0o644, prefix: 'thingengine-sort-buffer-', dir: VAR_TMP }, (err, path, fd, cleanup) => {
            if (err)
                return this.emit('error', err);

            this._filename = path;
            this._cleanup = cleanup;
            this._writeStream = fs.createWriteStream(path, { flags: 'w', fd: fd, defaultEncoding: 'utf8' });
            this._writeStream.write(data.map(JSON.stringify).join('\n'));
            this._writeStream.end();

            this._writeStream.on('error', (e) => this.emit('error', e));
            this._writeStream.once('finish', () => {
                this._writeReady = true;
                this.emit('write-ready');
            });
        });
    }

    _doOpenRead() {
        var fsStream = fs.createReadStream(this._filename, { flags: 'r', defaultEncoding: 'utf8' });
        this._readFSStream = fsStream;
        this._readStream = byline.createStream(fsStream);
        this._readStream.on('error', (e) => this.emit('error', e));
        this._readStream.on('readable', () => this._onReadable());
    }

    openRead() {
        if (this._writeReady)
            this._doOpenRead();
        else
            this.once('write-ready', () => this._doOpenRead());
    }

    close() {
        if (this._readFSStream) {
            this._readFSStream.close();
            this._readFSStream = null;
        }
        if (this._cleanup) {
            this._cleanup();
            this._cleanup = null;
        }
    }

    _readNext() {
        if (this.data !== null)
            return true;

        try {
            this._readFSStream.read(0); // trigger a readable event
            var line = this._readStream.read();
            if (line === null)
                return false;
            this.data = JSON.parse(line);
            return true;
        } catch(e) {
            console.error('Error: ' + e);
            this.emit('error', e);
            return true;
        }
    }

    _waitWrite() {
        if (this._writeReady) {
            return Q();
        } else {
            return Q.Promise((callback, errback) => {
                this.once('write-ready', callback);
            });
        }
    }

    _onReadable() {
        this._readCallbacks.forEach((c) => c());
        this._readCallbacks = [];
    }

    _doWaitRead() {
        if (this._readNext()) {
            return Q();
        } else {
            return new Promise((callback, errback) => {
                if (this._readNext())
                    callback();
                else
                    this._readCallbacks.push(callback);
            });
        }
    }

    waitRead() {
        if (this._readStream)
            return this._doWaitRead();
        else
            return this._waitWrite().then(() => this._doWaitRead());
    }
}

module.exports = class SortStream extends Stream.Readable {
    constructor(child, compare) {
        super({ objectMode: true });
        this.child = child;
        this._compare = compare;
        this._isFileSort = false;
        this._memorySortBuffer = [];
        this._sortFileBuffers = [];
        this._hadError = false;
        this._isReadingBack = false;
        this._isLooping = false;

        child.on('data', (data) => this._childData(data));
        child.on('end', () => this._childEnded());
        child.on('error', (e) => {
            this._hadError = true;
            this.emit('error', e);
        });
        this._childActive = true;
        this.child.pause();
    }

    _doLoopRead() {
        if (this._isLooping)
            return;

        this._isLooping = true;
        function loop() {
            return this._waitAllFilesReadable().then(() => {
                if (this._hadError) {
                    this._closeAllFiles();
                    return;
                }

                var d = this._nextFileSort();
                if (d === null) {
                    this.push(null);
                    this._closeAllFiles();
                    return;
                }

                if (!this.push(d)) {
                    this._isLooping = false;
                    return;
                }

                return loop.call(this);
            });
        }

        loop.call(this).done();
    }

    _read() {
        if (this._hadError)
            return;

        if (this._childActive)
            this.child.resume();
        else if (this._isFileSort)
            this._doLoopRead();
    }

    _childData(data) {
        this._memorySortBuffer.push(data);

        if (this._memorySortBuffer.length > MAX_SORT_BUFFER) {
            console.log('Memory sort buffer exceeded, spilling to file');
            this._isFileSort = true;
            this._memorySortBuffer.sort(this._compare);

            var buf = new FileBuffer(this._memorySortBuffer);
            buf.on('error', (e) => {
                this._hadError = true;
                this.emit('error', e);
            });
            this._sortFileBuffers.push(buf);
            this._memorySortBuffer = [];
        }
    }

    _childEnded() {
        if (this._hadError)
            return this._closeAllFiles();

        this._childActive = false;

        if (this._isFileSort)
            this._flushFileSort();
        else
            this._flushMemorySort();
    }

    _waitAllFilesReadable() {
        return Q.all(this._sortFileBuffers.map((file) => {
            return file.waitRead();
        }));
    }

    _nextFileSort() {
        var top = null;
        var from = null;
        if (this._memorySortBuffer.length > 0) {
            top = this._memorySortBuffer[0];
            from = -1;
        }

        this._sortFileBuffers.forEach((file, i) => {
            if (file.data === null) {
                //console.log(file._filename + ' is eof');
                return;
            }
            if (top === null || this._compare(file.data, top) < 0) {
                top = file.data;
                from = i;
            }
        });

        if (top !== null) {
            if (from < 0)
                this._memorySortBuffer.shift();
            else
                this._sortFileBuffers[from].data = null;
        }
        return top;
    }

    _openFileBuffersForRead() {
        for (var file of this._sortFileBuffers)
            file.openRead();
    }

    _closeAllFiles() {
        for (var file of this._sortFileBuffers)
            file.close();
    }

    _flushFileSort() {
        this._memorySortBuffer.sort(this._compare);
        this._openFileBuffersForRead();

        this._isReadingBack = true;
        this._doLoopRead();
    }

    _flushMemorySort() {
        this._memorySortBuffer.sort(this._compare);
        this._memorySortBuffer.forEach((d) => this.push(d));
        this.push(null);
    }
}
