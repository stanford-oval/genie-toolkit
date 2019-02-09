// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2017-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: The 224N TAs
//         Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

/**
 * Progbar class copied from keras (https://github.com/fchollet/keras/)
 * and then translated from Python to Javascript
 *
 * Displays a progress bar.
 */
module.exports = class ProgressBar {
    constructor(target, { width = 30, verbose = 1 } = {}) {
        this.width = width;
        this.target = target;
        this.sum_values = {};
        this.unique_values = [];
        this.start = new Date;
        this.total_width = 0;
        this.seen_so_far = 0;
        this.verbose = verbose;

        this._isatty = process.stderr.isTTY;
    }

    update(current, values=[], exact=[]) {
        for (let [k, v] of values) {
            if (!(k in this.sum_values)) {
                this.sum_values[k] = [v * (current - this.seen_so_far), current - this.seen_so_far];
                this.unique_values.push(k);
            } else {
                this.sum_values[k][0] += v * (current - this.seen_so_far);
                this.sum_values[k][1] += (current - this.seen_so_far);
            }
        }
        for (let [k, v] of exact) {
            if (!(k in this.sum_values))
                this.unique_values.push(k);
            this.sum_values[k] = [v, 1];
        }
        this.seen_so_far = current;

        if (!this._isatty)
            return;

        const now = new Date;
        if (this.verbose === 1) {
            const prev_total_width = this.total_width;
            process.stderr.write("\b".repeat(prev_total_width));
            process.stderr.write("\r");

            const current_pct = Math.floor(current / this.target) * 100;
            let bar = `${String(current_pct).padStart(3)}%  [`;
            const prog = current / this.target;
            const prog_width = Math.floor(this.width * prog);
            if (prog_width > 0) {
                bar += '='.repeat(prog_width-1);
                if (current < this.target)
                    bar += '>';
                else
                    bar += '=';
            }
            bar += '.'.repeat(this.width-prog_width);
            bar += ']';
            process.stderr.write(bar);
            this.total_width = bar.length;

            let time_per_unit;
            if (current)
                time_per_unit = (now - this.start) / current;
            else
                time_per_unit = 0;
            const eta = time_per_unit * (this.target - current);
            let info = '';
            if (current < this.target)
                info += ` - ETA: ${Math.round(eta/1000)}s`;
            else
                info += ` - ${Math.round((now - this.start)/1000)}s`;
            for (let k of this.unique_values) {
                if (Array.isArray(this.sum_values[k]))
                    info += ` - ${k}: ${(this.sum_values[k][0] / Math.max(1, this.sum_values[k][1])).toFixed(4)}`;
                else
                    info += ` - ${k}: ${this.sum_values[k]}`;
            }

            this.total_width += info.length;
            if (prev_total_width > this.total_width)
                info += ' '.repeat(prev_total_width - this.total_width);

            process.stderr.write(info);
            if (current >= this.target)
                process.stderr.write("\n");
        }

        if (this.verbose === 2) {
            if (current >= this.target) {
                let info = Math.round((now - this.start)/1000) + 's';
                for (let k of this.unique_values)
                    info += ` - ${k} ${(this.sum_values[k][0] / Math.max(1, this.sum_values[k][1])).toFixed(4)}`;
                process.stderr.write(info + "\n");
            }
        }
    }

    add(n, values=[]) {
        this.update(this.seen_so_far+n, values);
    }
};
