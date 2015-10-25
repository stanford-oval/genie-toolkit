// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const lang = require('lang');
const adt = require('adt');

const AppGrammar = require('./app_grammar');
const ExecEnvironment = require('./exec_environment');

const EPSILON = 1e-5;

const UnitsToBaseUnit = {
    // percent
    '%': '%',
    // time
    'ms': 'ms', // base unit for time is milliseconds, because +new Date gives milliseconds
    's': 'ms',
    'min': 'ms',
    'h': 'ms',
    'day': 'ms',
    'week': 'ms',
    'mon': 'ms', // business month, aka exactly 30 days
    'year': 'ms', // business year (365 days exactly, no leap years)
    // length
    'm': 'm',
    'km': 'm',
    'mm': 'm',
    'cm': 'm',
    'mi': 'm',
    'in': 'm',
    // speed
    'mps': 'mps', // meters per second, usually written as m/s but m/s is not an identifier
    'kmph': 'mps',
    'mph': 'mps',
    // weight
    'kg': 'kg',
    'g': 'kg',
    'lb': 'kg',
    'oz': 'kg',
    // pressure (for weather or blood)
    'Pa': 'Pa',
    'bar': 'Pa',
    'psi': 'Pa',
    'mmHg': 'Pa',
    'inHg': 'Pa',
    'atm': 'Pa',
    // temperature
    'C': 'C',
    'F': 'C',
    'K': 'C',
};

// default amounts of change for each unit of measure
// FIXME: ideally, this would be channel specific, rather than type specific...
const BaseUnitDefaultChange = {
    '%': 5,
    'ms': 1000, // 1 s
    'm': 1000, // 1 km
    'mps': 0.27777778, // 1 kmph
    'kg': 1,
    // this is where we fail miserably
    // default is for weather, not for blood...
    'Pa': 500, // 0.5 kPa, or 5 mbar
    // same here, default is for weather, not for body temperature...
    'C': 2,
};

const UnitsTransformToBaseUnit = {
    '%': 1,
    'ms': 1,
    's': 1000,
    'min': 60 * 1000,
    'h': 3600 * 1000,
    'day': 86400 * 1000,
    'week': 86400 * 7 * 1000,
    'mon': 86400 * 30 * 1000,
    'year': 86400 * 365 * 1000,
    'm': 1,
    'km': 1000,
    'mm': 1/1000,
    'cm': 1/100,
    'mi': 1609.344,
    'in': 0.0254,
    'mps': 1,
    'kmph': 0.27777778,
    'mph': 0.44704,
    'kg': 1,
    'g': 1/1000,
    'lb': 0.45359237,
    'oz': 0.028349523,
    'Pa': 1,
    'bar': 100000,
    'psi': 6894.7573,
    'mmHg': 133.32239,
    'inHg': 3386.3886,
    'atm': 101325,
    'C': 1,
    'F': function(x) { return (x - 32)/1.8; },
    'K': function(x) { return x - 273.15; }
};

// strictly speaking, Measure and Arrays are not types, they are type constructors
// (kind * -> *)
// typeUnify() has the magic to check types
const Type = adt.data(function() {
    return {
        Any: null, // polymorphic hole
        Boolean: null,
        String: null,
        Number: null,
        Measure: {
            // '' means any unit, creating a polymorphic type
            // any other value is a base unit (m for length, C for temperature)
            unit: adt.only(String)
        },
        Array: {
            elem: adt.only(this)
        },
        Date: null,
        Location: null,
        Object: null,
    };
});

function stringToType(s) {
    switch(s) {
    case 'bool':
        return Type.Boolean;
    case 'string':
    case 'password':
        return Type.String;
    case 'number':
        return Type.Number;
    case 'location':
        return Type.Location;
    case 'date':
        return Type.Date;
    default:
        // anything else is a unit of measure
        return Type.Measure(s);
    }
}

function typeIsObservable(t) {
    return !t.isArray && !t.isObject;
}

function typeIsDiscrete(t) {
    return t.isBoolean || t.isString;
}

function typeUnify(t1, t2) {
    // this will also check that the units match for two measures
    if (t1.equals(t2))
        return t1;
    else if (t1.isAny)
        return t2;
    else if (t2.isAny)
        return t1;
    else if (t1.isMeasure && t1.unit == '' && t2.isMeasure)
        return t2;
    else if (t2.isMeasure && t2.unit == '' && t1.isMeasure)
        return t1;
    else if (t1.isArray && t2.isArray)
        return Type.Array(typeUnify(t1.elem, t2.elem));
    else
        throw new TypeError('Cannot unify ' + t1 + ' and ' + t2);
}

function typeMakeArithmetic(t1) {
    if (t1.isNumber || t1.isMeasure)
        return t1;
    else if (t1.isAny)
        return Type.Number;
    else
        throw new TypeError('Type ' + t1 + ' is not arithmetic');
}

function objectToString(o) {
    if (Array.isArray(o))
        return o.join(', ');
    else
        return String(o);
}

function equalityTest(a, b) {
    if (a === b)
        return true;
    if (a instanceof Date && b instanceof Date)
        return +a === +b;

    if (Array.isArray(a) && Array.isArray(b) &&
        a.length === b.length) {
        for (var i = 0; i < a.length; i++) {
            if (a[i] !== b[i])
                return false;
        }
        return true;
    }

    return true;
}

function likeTest(a, b) {
    return a.indexOf(b) >= 0;
}

const Comparators = {
    '>': {
        types: [Type.String, Type.Measure(''), Type.Number, Type.Date],
        op: function(a, b) { return a > b; },
    },
    '<': {
        types: [Type.String, Type.Measure(''), Type.Number, Type.Date],
        op: function(a, b) { return a < b; },
    },
    '>=': {
        types: [Type.String, Type.Measure(''), Type.Number, Type.Date],
        op: function(a, b) { return a >= b; },
    },
    '<=': {
        types: [Type.String, Type.Measure(''), Type.Number, Type.Date],
        op: function(a, b) { return a <= b; },
    },
    '=': {
        types: [Type.Any],
        op: equalityTest,
    },
    ':': {
        types: [Type.Any],
        op: equalityTest,
    },
    '!=': {
        types: [Type.Any],
        op: function(a, b) { return !(equalityTest(a,b)); },
    },
    '=~': {
        types: [Type.String],
        op: likeTest,
    },
    'has': {
        types: [Type.Array(Type.Any), Type.Any],
        op: function(a, b) { return a.some(function(x) { return equalityTest(x, b); }); },
    },
    'has~': {
        types: [Type.Array(Type.String), Type.Any],
        op: function(a, b) { return a.some(function(x) { return likeTest(x, b); }); },
    }
};

const Builtins = {
    'join': {
        argtypes: [Type.Array(Type.Any), Type.String],
        rettype: Type.String,
        op: function(array, joiner) {
            if (!Array.isArray(array))
                throw new TypeError('First argument to join must be an Array');
            return array.join(joiner);
        }
    },
    'distance': {
        argtypes: [Type.Location, Type.Location],
        rettype: Type.Measure('m'),
        op: function(a, b) {
            return Math.sqrt((a.x - b.x)*(a.x - b.x) + (a.y - b.y)*(a.y - b.y));
        }
    },
    'string': {
        argtypes: [Type.Any],
        rettype: Type.String,
        op: objectToString,
    }
};


module.exports = new lang.Class({
    Name: 'AppCompiler',

    _init: function(withActions) {
        this._withActions = withActions;
        this._settings = {};
        this._name = undefined;
        this._description = undefined;
        this._auth = undefined;
        this._kinds = [];

        this._nextInputBlockId = 0;

        this._warnings = [];
    },

    get name() {
        return this._name;
    },

    get description() {
        return this._description;
    },

    get settings() {
        return this._settings;
    },

    get warnings() {
        return this._warnings;
    },

    get auth() {
        return this._auth;
    },

    get kinds() {
        return this._kinds;
    },

    _warn: function(msg) {
        this._warnings.push(msg);
    },

    compileAtRules: function(ast) {
        var name = undefined;
        var description = undefined;
        var settings = {};
        var auth = undefined;
        var kinds = [];

        function compileSetting(props) {
            var name, description, rawType, type;

            props.forEach(function(assignment) {
                switch(assignment.name) {
                case 'name':
                    if (name !== undefined)
                        this._warn("Duplicate @setting.name declaration");
                    if (!assignment.rhs.isConstant || !assignment.rhs.value.isString)
                        throw new TypeError("Invalid @setting.name");
                    name = assignment.rhs.value.value;
                    return;
                case 'description':
                    if (description !== undefined)
                        this._warn("Duplicate @setting.description declaration");
                    if (!assignment.rhs.isConstant || !assignment.rhs.value.isString)
                        throw new TypeError("Invalid @setting.description");
                    description = assignment.rhs.value.value;
                    return;
                case 'type':
                    if (type !== undefined)
                        this._warn("Duplicate @setting.type declaration");
                    if (!assignment.rhs.isVarRef)
                        throw new TypeError("Invalid @setting.type");
                    rawType = assignment.rhs.name;
                    type = stringToType(assignment.rhs.name);
                    return;
                default:
                    this._warn("Unknown @setting parameter " + assignment.name);
                }
            });

            if (type === undefined)
                throw new Error("Missing @setting.type");
            return ({ name: name,
                      description: description,
                      rawType: rawType,
                      type: type });
        }
        function compileAuth(props) {
            var auth = {};

            props.forEach(function(assignment) {
                if (!assignment.rhs.isConstant && !assignment.rhs.isVarRef)
                    throw new TypeError("Invalid @auth." + assignment.name);

                if (assignment.rhs.isConstant)
                    auth[assignment.name] = assignment.rhs.value.value;
                else if (assignment.rhs.isVarRef)
                    auth[assignment.name] = assignment.rhs.name;
            });

            return auth;
        }

        ast.forEach(function(rule) {
            if (rule.isName) {
                if (name !== undefined)
                    this._warn("Duplicate @name declaration");
                name = rule.value;
            } else if (rule.isDescription) {
                if (description !== undefined)
                    this._warn("Duplication @description declaration");
                description = rule.value;
            } else if (rule.isSetting) {
                if (settings[rule.name] !== undefined)
                    this._warn("Duplicate @setting declaration for " + rule.name);
                settings[rule.name] = compileSetting.call(this, rule.props);
            } else if (rule.isAuth) {
                if (auth !== undefined)
                    this._warng("Duplicate @auth declaration");
                auth = compileAuth.call(this, rule.params);
            } else if (rule.isKind) {
                kinds.push(rule.kind.name);
            }
        }, this);

        this._name = name;
        this._description = description;
        this._settings = settings;
        this._auth = auth;
        this._kinds = kinds;
    },

    compileConstant: function(value) {
        if (value.isMeasure) {
            var baseunit = UnitsToBaseUnit[value.unit];
            if (baseunit === undefined)
                throw new TypeError("Invalid unit " + value.unit);
            var transform = UnitsTransformToBaseUnit[value.unit];
            var type = Type.Measure(baseunit);
            var transformed;
            if (typeof transform == 'function')
                transformed = transform(value.value);
            else
                transformed = value.value * transform;
            return [type, function() { return transformed; }];
        }

        var type;
        if (value.isBoolean)
            type = Type.Boolean;
        else if (value.isString)
            type = Type.String;
        else if (value.isNumber)
            type = Type.Number;

        return [type, function() { return value.value; }];
    },

    compileVarRef: function(name) {
        // FIXME: figure out the type of this variable
        // FIXME: for now, let's hardcode some common names
        var type;
        if (name == 'ts')
            type = Type.Date;
        else if (name == 'location')
            type = Type.Location;
        else if (name == 'weight')
            type = Type.Measure('kg');
        else if (name == 'temperature')
            type = Type.Measure('C');
        else if (name == 'length')
            type = Type.Measure('m');
        else if (name == 'speed')
            type = Type.Measure('mps');
        else if (name == 'pressure')
            type = Type.Measure('Pa');
        else if (name == 'power')
            type = Type.Boolean;
        else if (name == 'url')
            type = Type.String;
        else if (name == 'hashtags' || name == 'urls')
            type = Type.Array(Type.String);
        else if (name == 'status' || name == 'from')
            type = Type.String;
        else
            type = Type.Any;
        return [type, function(env) { return env.readVar(name); }];
    },

    compileSettingRef: function(name) {
        var setting = this._settings[name];
        if (setting === undefined)
            throw new TypeError('Setting ' + name + ' is not declared');
        var type = setting.type;
        return [type, function(env) { return env.readSetting(type, name); }];
    },

    compileMemberRef: function(objectast, name) {
        var objectexp = this.compileExpression(objectast);
        typeUnify(objectexp[0], Type.Object);

        var objectop = objectexp[1];
        // FIXME: figure out the type of this member
        return [Type.Any, function(env) {
            var object = objectop(env);
            return env.readObjectProp(object, name);
        }];
    },

    compileObjectRef: function(name) {
        return [Type.Object, function(env) {
            return env.readObject(name);
        }];
    },

    compileFunctionCall: function(name, argsast) {
        var func = Builtins[name];
        if (func === undefined)
            throw new TypeError("Unknown function " + name);
        if (argsast.length !== func.argtypes.length)
            throw new TypeError("Function " + func + " does not accept " +
                                argsast.length + " arguments");
        var argsexp = argsast.map(this.compileExpression.bind(this));
        argsexp.forEach(function(exp, idx) {
            typeUnify(exp[0], func.argtypes[idx]);
        });
        var funcop = func.op;
        return [func.rettype, function(env) {
            var args = argsexp.map(function(exp) {
                return exp[1](env);
            });
            return funcop.apply(null, args);
        }];
    },

    compileUnaryOp: function(argast, opcode, op) {
        var argexp = this.compileExpression(argast);
        var type = typeMakeArithmetic(argexp[0]);
        var argop = argexp[1];
        return [type, function(env) { return op(argop(env)); }];
    },

    compileBinaryOp: function(lhsast, rhsast, opcode, op) {
        var lhsexp = this.compileExpression(lhsast);
        var rhsexp = this.compileExpression(rhsast);

        // FIXME: make generic
        var unifiedtype = typeUnify(lhsexp[0], rhsexp[0]);
        var type;
        try {
            type = typeMakeArithmetic(unifiedtype);
        } catch(e) {
            if (opcode == '+') {
                try {
                    typeUnify(unifiedtype, Type.String);
                    type = Type.String;

                    var lhsop = lhsexp[1];
                    var rhsop = rhsexp[1];
                    return [type, function(env) { return op(objectToString(lhsop(env)),
                                                            objectToString(rhsop(env))); }];
                } catch(e2) {
                    throw e;
                }
            } else if (opcode == '-') {
                try {
                    typeUnify(unifiedtype, Type.Date);
                    type = Type.Measure('ms');
                } catch(e2) {
                    throw e;
                }
            } else {
                throw e;
            }
        }

        var lhsop = lhsexp[1];
        var rhsop = rhsexp[1];
        return [type, function(env) { return op(+lhsop(env), +rhsop(env)); }];
    },

    compileExpression: function(ast) {
        if (ast.isConstant)
            return this.compileConstant(ast.value);
        else if (ast.isVarRef)
            return this.compileVarRef(ast.name);
        else if (ast.isSettingRef)
            return this.compileSettingRef(ast.name);
        else if (ast.isMemberRef)
            return this.compileMemberRef(ast.object, ast.name);
        else if (ast.isObjectRef)
            return this.compileObjectRef(ast.name);
        else if (ast.isFunctionCall)
            return this.compileFunctionCall(ast.name, ast.args);
        else if (ast.isUnaryOp)
            return this.compileUnaryOp(ast.arg, ast.opcode, ast.op);
        else if (ast.isBinaryOp)
            return this.compileBinaryOp(ast.lhs, ast.rhs, ast.opcode, ast.op);
    },

    compileThreshold: function(ast) {
        var lhs = this.compileExpression(ast.lhs);
        var rhs = this.compileExpression(ast.rhs);
        var comp = Comparators[ast.comparator];

        typeUnify(lhs[0], comp.types[0]);
        typeUnify(rhs[0], comp.types[1]);

        var lhsop = lhs[1];
        var rhsop = rhs[1];
        var compop = comp.op;

        return function(env) {
            return compop(lhsop(env), rhsop(env));
        }
    },

    compileChange: function(ast) {
        var expr = this.compileExpression(ast.expr);
        var amount = ast.amount !== null ? this.compileExpression(ast.amount) : null;

        var exprtype = expr[0];
        var exprop = expr[1];

        if (!typeIsObservable(exprtype))
            throw new Error('Expression of type ' + exprtype + ' cannot be an operand to "change"');

        var compop = null;
        if (typeIsDiscrete(exprtype)) {
            if (amount !== null)
                this._warn("Ignored change amount for discrete type " + exprtype);

            compop = function(env, previousValue, currentValue) {
                console.log('Applying change operator to', previousValue, currentValue);
                return (previousValue !== currentValue);
            }
        } else if (exprtype.isDate) {
            if (amount !== null) {
                var amounttype = typeUnify(amount[1], Type.Measure('ms'));
                var amountop = amount[0];
            } else {
                var amountop = function() {
                    return BaseUnitDefaultChange['ms'];
                };
            }

            compop = function(env, previousValue, currentValue) {
                var amount = amountop(env);
                return +currentValue - +previousValue >= amount;
            }
        } else if (exprtype.isLocation) {
            if (amount !== null) {
                var amounttype = typeUnify(amount[1], Type.Measure('m'));
                var amountop = amount[0];
            } else {
                var amountop = function() {
                    return BaseUnitDefaultChange['m'];
                };
            }

            compop = function(env, previousValue, currentValue) {
                var amount = amountop(env);
                return Builtins.distance(currentValue, previousValue) >= amount;
            }
        } else if (exprtype.isMeasure || exprtype.isNumber) {
            if (amount !== null && amount[1].isMeasure && amount[1].unit == '%') {
                var amountop = amount[0];

                compop = function(env, previousValue, currentValue) {
                    // note there is no abs here, change is positive or negative according to amount
                    var amount = amountop(env) / 100;
                    if (Math.abs(amount) < EPSILON) {
                        console.log('WARNING: Ignoring too small relative increase');
                        return false;
                    }
                    if (amount > 0)
                        return (currentValue - previousValue) / previousValue >= amount;
                    else
                        return (currentValue - previousValue) / previousValue <= amount;
                }
            } else {
                if (amount !== null) {
                    var amounttype = typeUnify(amount[1], exprtype);
                    var amountop = amount[0];

                    compop = function(env, previousValue, currentValue) {
                        // note there is no abs here, change is positive or negative according to amount
                        var amount = amountop(env);
                        if (Math.abs(amount) < EPSILON) {
                            console.log('WARNING: Ignoring too small absolute increase');
                            return false;
                        }

                        if (amount > 0)
                            return (currentValue - previousValue) >= amount;
                        else
                            return (currentValue - previousValue) <= amount;
                    }
                } else {
                    var amount;
                    if (exprtype.isMeasure) {
                        var baseUnit = exprtype.unit;
                        if (baseUnit == '') // FIXME: assume length...
                            baseUnit = 'm';
                        amount = BaseUnitDefaultChange[baseUnit];
                    } else {
                        amount = 1;
                    }

                    compop = function(env, previousValue, currentValue) {
                        return Math.abs(currentValue - previousValue) >= amount;
                    }
                }
            }
        }

        return (function(env) {
            if (!env.hasPrevious)
                return true;

            env.setUseCurrent(false);
            var previousValue = exprop(env);
            env.setUseCurrent(true);
            var currentValue = exprop(env);

            return compop(env, previousValue, currentValue);
        });
    },

    compileFilter: function(ast) {
        if (ast.isThreshold)
            return this.compileThreshold(ast);
        else if (ast.isChange)
            return this.compileChange(ast);
    },

    anyThresholdFilter: function(ast) {
        return ast.some(function(ast) { return ast.isThreshold; });
    },

    anyChangeFilter: function(ast) {
        return ast.some(function(ast) { return ast.isChange; });
    },

    compileAssignment: function(ast) {
        var rhs = this.compileExpression(ast.rhs);
        var name = ast.name;
        var op = rhs[1];
        return function(env) {
            env.writeValue(name, op(env));
        }
    },

    compileIdSelector: function(ast) {
        return function(device) {
            return device.uniqueId === ast.name;
        }
    },

    compileTagSelector: function(ast) {
        return function(device) {
            return device.hasKind(ast.name) || device.hasTag(ast.name);
        }
    },

    compileSimpleSelector: function(ast) {
        if (ast.isId)
            return this.compileIdSelector(ast);
        else if (ast.isTag)
            return this.compileTagSelector(ast);
    },

    compileSelector: function(ast) {
        if (ast.length === 0)
            return null;

        var simplearray = ast.map(this.compileSimpleSelector.bind(this));
        return function(device) {
            return simplearray.every(function(simple) {
                return simple(device);
            });
        }
    },

    compileChannelArgs: function(args) {
        var env = new ExecEnvironment(null, {});

        return args.map(function(ast) {
            // this should be enforced by the grammar
            if (!ast.isConstant && !ast.isSettingRef)
                throw new TypeError("Only constants are allowed as channel arguments");

            var exp = this.compileExpression(ast);
            return exp[1](env);
        }.bind(this));
    },

    compileUpdateSome: function(filters, anyThreshold, anyChange, alias, continueUpdate) {
        var blockId = this._nextInputBlockId;
        this._nextInputBlockId++;

        var thresholdName = 'threshold-' + blockId + '-';

        return function(inputs, i, env, cont) {
            return this.channels.some(function(channel) {
                if (channel.event === null)
                    return false;

                env.setPreviousThis(channel.previousEvent);
                env.setThis(channel.event);
                var ok = filters.every(function(filter) {
                    return filter(env);
                });
                env.setPreviousThis(null);
                env.setThis(null);

                var run = false;
                if (ok) {
                    if (env.getInputBlockEnabled(thresholdName + channel.uniqueId)) {
                        if (alias !== null)
                            env.setAlias(alias, channel.event);

                        run = continueUpdate(inputs, i, env, cont);

                        if (anyThreshold && run)
                            env.setInputBlockEnabled(thresholdName + channel.uniqueId, false);
                    }
                } else {
                    if (anyThreshold)
                        env.setInputBlockEnabled(thresholdName + channel.uniqueId, true);
                }

                return run;
            });
        };
    },

    compileUpdateAll: function(filters, anyThreshold, anyChange, alias, continueUpdate) {
        var blockId = this._nextInputBlockId;
        this._nextInputBlockId++;

        var thresholdName = blockId + '-';

        return function(inputs, i, env, cont) {
            var ok = this.channels.every(function(channel) {
                if (channel.event === null)
                    return false;

                env.setPreviousThis(channel.previousEvent);
                env.setThis(channel.event);
                return filters.every(function(filter) {
                    return filter(env);
                });
                env.setPreviousThis(null);
                env.setThis(null);
            });
            var run = false;
            if (ok) {
                if (env.getInputBlockEnabled(thresholdName + 'all')) {
                    if (alias !== null) {
                        env.setAlias(alias, this.channels.map(function(c) {
                            return c.event;
                        }));
                    }

                    run = continueUpdate(inputs, i, env, cont);

                    if (anyThreshold && run)
                        env.setInputBlockEnabled(thresholdName + channel.uniqueId, false);
                }
            } else {
                if (anyThreshold)
                    env.setInputBlockEnabled(thresholdName + channel.uniqueId, true);
            }

            return run;
        }
    },

    compileUpdate: function(quantifier, filters, anyThreshold, anyChange, alias) {
        function continueUpdate(inputs, i, env, cont) {
            if (i+1 < inputs.length) {
                return inputs[i+1].update(inputs, i+1, env, cont);
            } else {
                cont();
                return true;
            }
        }

        if (quantifier === 'some')
            return this.compileUpdateSome(filters, anyThreshold, anyChange, alias, continueUpdate);
        else
            return this.compileUpdateAll(filters, anyThreshold, anyChange, alias, continueUpdate);
    },

    compileAction: function(outputs) {
        return function(env) {
            outputs.forEach(function(output) {
                output(env);
            });
        }
    },

    compileInputs: function(ast) {
        return ast.map(function(input) {
            var inputBlock = {
                selector: this.compileSelector(input.selector),
                channelName: input.channelName,
                channelArgs: this.compileChannelArgs(input.channelArgs),
                channels: [],
                update: this.compileUpdate(input.quantifier,
                                           input.filters.map(this.compileFilter.bind(this)),
                                           this.anyThresholdFilter(input.filters),
                                           this.anyChangeFilter(input.filters),
                                           input.alias),
            };

            return inputBlock;
        }.bind(this));
    },

    compileOutputs: function(ast) {
        return ast.map(function(output) {
            var outputBlock = {
                selector: this.compileSelector(output.selector),
                channelName: output.channelName,
                channelArgs: this.compileChannelArgs(output.channelArgs),
                channels: [],
                action: this.compileAction(output.outputs.map(this.compileAssignment.bind(this))),
            };

            return outputBlock;
        }.bind(this));
    },

    compileChannelDescriptions: function(ast) {
        return ast.map(function(channel) {
            if (!channel.selector.isTag)
                throw new TypeError('Invalid channel selector');

            var channelBlock = {
                kind: channel.selector.name,
                properties: channel.props.map(this.compileAssignment.bind(this))
            };

            return channelBlock;
        }.bind(this));
    },
});

