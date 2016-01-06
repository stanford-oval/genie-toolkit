var async = require('async');

function Task() {
    this._result = undefined;
    this._callbacks = [];
}

Task.prototype.getResult = function() {
    return this._result;
}

Task.prototype._setResult = function(o) {
    if (this._result !== undefined) {
        throw new Exception("Task already complete");
    }

    this._result = o;
    this._complete();
}

Task.prototype.continueWith = function(fn) {
    if (this._result !== undefined) {
        async.nextTick(fn);
    } else {
        this._callbacks.push(fn);
    }
}

Task.prototype._complete = function() {
    var cbs = this._callbacks;
    this._callbacks = undefined;

    cbs.forEach(function(cb) {
        async.nextTick(function() {
            cb(this);
        });
    });
}

function TaskCompletionSource() {
    this.task = new Task();
}

TaskCompletionSource.prototype.trySetResult = function(o) {
    try {
        this.task._setResult(o);
        return true;
    } catch (e) {
        return false;
    }
}

TaskCompletionSource.prototype.setResult = function(o) {
    if (!this.trySetResult(o)) {
        throw new Exception("Invalid state");
    }
}

module.exports = {
    Task: Task,
    TaskCompletionSource: TaskCompletionSource
};