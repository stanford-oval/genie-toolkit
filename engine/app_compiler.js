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
        Object: {
            schema: adt.any,
        },
        Module: null,
        Group: null,
    };
});

function stringToType(s) {
    if (s.startsWith('Measure('))
        return Type.Measure(s.substring(8, s.length-1));
    if (s.startsWith('Array('))
        return Type.Array(stringToType(s.substring(6, s.length-1)));

    switch(s) {
    case 'Any':
        return Type.Any;
    case 'Boolean':
        return Type.Boolean;
    case 'String':
    case 'Password':
        return Type.String;
    case 'Number':
        return Type.Number;
    case 'Location':
        return Type.Location;
    case 'Date':
        return Type.Date;
    case 'Object':
        return Type.Object;
    case 'Module':
        return Type.Module;
    case 'Group':
        return Type.Group;
    default:
        throw new TypeError("Invalid type " + s);
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
    else if (t1.isObject && t2.isObject && t1.schema === null)
        return t2;
    else if (t1.isObject && t2.isObject && t2.schema === null)
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
        reverse: '>',
    },
    '<': {
        types: [Type.String, Type.Measure(''), Type.Number, Type.Date],
        op: function(a, b) { return a < b; },
        reverse: '<',
    },
    '>=': {
        types: [Type.String, Type.Measure(''), Type.Number, Type.Date],
        op: function(a, b) { return a >= b; },
        reverse: '<=',
    },
    '<=': {
        types: [Type.String, Type.Measure(''), Type.Number, Type.Date],
        op: function(a, b) { return a <= b; },
        reverse: '>=',
    },
    '=': {
        types: [Type.Any],
        op: equalityTest,
        reverse: '=',
    },
    '!=': {
        types: [Type.Any],
        op: function(a, b) { return !(equalityTest(a,b)); },
        reverse: '=',
    },
    '=~': {
        types: [Type.String],
        op: likeTest,
        reverse: null,
    },
    'has': {
        types: [Type.Array(Type.Any), Type.Any],
        op: function(a, b) { return a.some(function(x) { return equalityTest(x, b); }); },
        reverse: null,
    },
    'has~': {
        types: [Type.Array(Type.String), Type.Any],
        op: function(a, b) { return a.some(function(x) { return likeTest(x, b); }); },
        reverse: null,
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

        this._imports = {};
        this._modules = {};
        this._rules = [];
        this._params = {};

        this._scope = {};
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

    get programName() {
        return this._programName;
    },

    get params() {
        return this._params;
    },

    get rules() {
        return this._rules;
    },

    get modules() {
        return this._modules;
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
                kinds.push(rule.kind);
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

    fallbackVarName: function(name) {
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
        return type;
    },

    compileVarRef: function(name, localscope, selfschema) {
        var type = null;
        if (selfschema !== null) {
            if (name in selfschema)
                type = selfschema[name];
        } else {
            if (name in localscope)
                type = localscope[name];
            else
                type = this.fallbackVarName(name);
        }
        if (type === null) {
            if (!(name in localscope))
                throw new TypeError('Invalid variable reference ' + name);
            type = localscope[name];
        }

        return [type, function(env) {
            return env.readVar(type, name);
        }];
    },

    compileMemberRef: function(objectast, name, localscope, selfschema) {
        var objectexp = this.compileExpression(objectast, localscope, selfschema);
        var objecttype = typeUnify(objectexp[0], Type.Object(null));

        var type;
        if (objecttype.schema !== null) {
            if (!(name in objecttype.schema))
                throw new TypeError('Object has no field ' + name);
            type = objecttype.schema[type];
        } else {
            type = this.fallbackVarName(name);
        }
        var objectop = objectexp[1];

        return [type, function(env) {
            var object = objectop(env);
            return env.readObjectProp(object, name);
        }];
    },

    compileFunctionCall: function(name, argsast, localscope, selfschema) {
        var func = Builtins[name];
        if (func === undefined)
            throw new TypeError("Unknown function " + name);
        if (argsast.length !== func.argtypes.length)
            throw new TypeError("Function " + func + " does not accept " +
                                argsast.length + " arguments");
        var argsexp = argsast.map(function(arg) {
            return this.compileExpression(arg, localscope, selfschema);
        }, this);
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

    compileUnaryOp: function(argast, opcode, op, localscope, selfschema) {
        var argexp = this.compileExpression(argast, localscope, selfschema);
        var type = typeMakeArithmetic(argexp[0]);
        var argop = argexp[1];
        return [type, function(env) { return op(argop(env)); }];
    },

    compileBinaryOp: function(lhsast, rhsast, opcode, op, localscope, selfschema) {
        var lhsexp = this.compileExpression(lhsast, localscope, selfschema);
        var rhsexp = this.compileExpression(rhsast, localscope, selfschema);

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

    compileExpression: function(ast, localscope, selfschema) {
        if (ast.isConstant)
            return this.compileConstant(ast.value, localscope, selfschema);
        else if (ast.isVarRef)
            return this.compileVarRef(ast.name, localscope, selfschema);
        else if (ast.isMemberRef)
            return this.compileMemberRef(ast.object, ast.name, localscope, selfschema);
        else if (ast.isFunctionCall)
            return this.compileFunctionCall(ast.name, ast.args, localscope, selfschema);
        else if (ast.isUnaryOp)
            return this.compileUnaryOp(ast.arg, ast.opcode, ast.op, localscope, selfschema);
        else if (ast.isBinaryOp)
            return this.compileBinaryOp(ast.lhs, ast.rhs, ast.opcode, ast.op, localscope, selfschema);
    },

    compileFilter: function(ast, localscope, selfschema) {
        var lhs = this.compileExpression(ast.lhs, localscope, selfschema);
        var rhs = this.compileExpression(ast.rhs, localscope, selfschema);
        var comp = Comparators[ast.comparator];

        for (var i = 0; i < comp.types.length; i++) {
            try {
                typeUnify(lhs[0], comp.types[i]);
                typeUnify(rhs[0], comp.types[i]);
                break;
            } catch(e) { }
        }
        if (i === comp.types.length)
            throw new TypeError('Invalid types for comparator ' + comp);

        var lhsop = lhs[1];
        var rhsop = rhs[1];
        var compop = comp.op;

        return function(env) {
            return compop(lhsop(env), rhsop(env));
        }
    },

    compileAssignment: function(ast, localscope, selfschema) {
        var rhs = this.compileExpression(ast.rhs, localscope, selfschema);
        var name = ast.name;
        var op = rhs[1];
        return function(env) {
            env.writeValue(name, op(env));
        }
    },

    constantFoldExpression: function(ast, state) {
        var env = new ExecEnvironment(null, {});

        try {
            var exp = this.compileExpression(ast, {}, null);
            var value = exp[1](env);
            var type = exp[0];
            var boxed;
            if (type.isBoolean)
                boxed = Value.Boolean(value);
            else if (type.isString)
                boxed = Value.String(value);
            else if (type.isNumber)
                boxed = Value.Number(value);
            else if (type.isMeasure)
                boxed = Value.Measure(value, type.unit);
            else if (type.isArray)
                boxed = Value.Array(value);
            else if (type.isDate)
                boxed = Value.Date(value);
            else if (type.isLocation)
                boxed = Value.Location(value.x, value.y);
            else if (type.isObject)
                boxed = Value.Object(value);

            return Expression.Constant(boxed);
        } catch(e) {
            return null;
        }
    },

    simplifyFilter: function(ast, state) {
        var lhsval = this.constantFoldExpression(ast.lhs, state);
        if (lhsval !== null) {
            var rhsval = this.constantFoldExpression(ast.rhs, state);
            if (rhsval !== null) {
                return InputRule.Threshold(lhsval, ast.comparator, rhsval);
            } else if (ast.rhs.isVarRef) {
                var reverse = Comparators[ast.comparator].reverse;
                if (reverse !== null)
                    return InputRule.Threshold(ast.rhs, reverse, lhsval);
                else
                    return null;
            } else {
                return null;
            }
        } else if (ast.lhs.isVarRef) {
            var rhsval = this.constantFoldExpression(ast.rhs, state);
            if (rhsval !== null)
                return InputRule.Threshold(ast.lhs, ast.comparator, rhsval);
            else
                return null;
        } else {
            return null;
        }
    },

    compileUpdate: function(filters, alias) {
        function continueUpdate(inputs, i, env, cont) {
            if (i+1 < inputs.length) {
                return inputs[i+1].update(inputs, i+1, env, cont);
            } else {
                cont();
                return true;
            }
        }

        return function(inputs, i, env, cont) {
            return this.channels.some(function(channel) {
                if (channel.event === null)
                    return false;

                function processOneTuple(current, matchId) {
                    env.setThis(current);
                    var ok = filters.every(function(filter) {
                        return filter(env);
                    });
                    env.setThis(null);

                    if (!ok)
                        return false;

                    if (alias !== null) {
                        var scope = {};
                        if (Array.isArray(alias)) {
                            alias.forEach(function(name) {
                                scope[name] = current[name];
                            });
                        } else {
                            scope[alias] = current;
                        }
                        env.mergeScope(scope);
                    }

                    return continueUpdate(inputs, i, env, cont);
                }

                if (Array.isArray(channel.event)) {
                    var retval = false;
                    // don't use .some() here, we want to run side-effects
                    channel.event.forEach(function(event) {
                        var run = processOneTuple(event, event._key);
                        retval = run || retval;
                    });
                    return retval;
                } else {
                    return processOneTuple(channel.event);
                }
            });
        };
    },

    compileAction: function(outputs) {
        return function(env) {
            outputs.forEach(function(output) {
                output(env);
            });
        }
    },

    compileSelectors: function(selectors, mode) {
        var i = 0;

        // a selector is composed of an optional context (not handled here)
        // an optional group reference
        //   one or more devices
        //   -or-
        //   a compute module reference
        // an optional channel name (defaults to source/sink)

        var group = undefined;
        var devices = undefined;
        var computeModule = undefined;
        var channelName = undefined;
        var schema = undefined;

        while (devices === undefined && computeModule === undefined && i < selectors.length) {
            var first = selectors[i];

            if (first.isVarRef) {
                if (first.name in this._scope) {
                    var result = this._scope[first.name];
                    if (result.isModule) {
                        if (group === undefined)
                            group = null;
                        devices = null;
                        computeModule = { scope: null, name: first.name };
                        i++;
                    } else if (result.isGroup && group === undefined) {
                        group = first.name;
                        i++;
                    } else {
                        // FIXME: a better error message for a group nested in a group...
                        throw new TypeError('Name ' + first.name + ' cannot be used as scoped reference');
                    }
                } else {
                    if (group === undefined)
                        group = null;
                    computeModule = null;
                    devices = [Selector.Kind(first.name)];
                    i++;
                }
            } else if (first.isScoped) {
                if (!(first.scope in this._imports) &&
                    first.scope !== 'Builtin')
                    throw new TypeError('Invalid external module reference to ' + first.scope);
                var scope;
                if (first.scope === 'Builtin')
                    scope = 'Builtin';
                else
                    scope = this._imports[first.scope];
                if (!(first.name in scope))
                    throw new TypeError('Invalid external module reference to ' + first.scope + '::' + first.name);
                if (group === undefined)
                    group = null;
                devices = null;
                computeModule = { scope: scope, name: first.name };
                i++;
            } else if (first.isTags || first.isId) {
                if (group === undefined)
                    group = null;
                computeModule = null;
                devices = [first];
                i++;
            }
        }
        if (group === undefined)
            throw new TypeError();
        if (devices === undefined && computeModule === undefined) {
            return {
                group: group,
                devices: null,
                computeModule: null,
                channelName: defaultChannel
            };
        }
        if (devices === undefined || computeModule === undefined)
            throw new TypeError();

        if (devices !== null) {
            for ( ; i < selectors.length - 1; i++) {
                var first = selectors[i];

                if (first.isTags || first.isId)
                    devices.push(first);
                else
                    throw new TypeError('Variable reference not allowed in device scope');
            }
        }

        if (i < selectors.length) {
            var first = selectors[i];

            if (first.isVarRef) {
                channelName = first.name;
            } else if (first.isTags || first.isId) {
                if (devices !== null)
                    devices.push(first);
                else
                    throw new TypeError('Device reference not allowed in compute module scope');
            } else {
                throw new TypeError('Scoped reference not allowed in device or compute module scope');
            }
        }

        if (channelName === undefined) {
            if (computeModule !== null) {
                if (mode === 'r')
                    channelName = 'in';
                else
                    channelName = 'out';
            } else {
                if (mode === 'r')
                    channelName = 'source';
                else
                    channelName = 'sink';
            }
        }

        if (computeModule !== null) {
            var imported = computeModule.scope;
            if (imported === null)
                imported = this._modules;
            var module = imported[computeModule.name];
            if (mode === 'r') {
                if (!(channelName in module.events))
                    throw new TypeError("Invalid event reference " + channelName);
                schema = module.events[channelName];
            } else {
                if (!(channelName in module.functions))
                    throw new TypeError("Invalid function reference " + channelName);
                schema = module.functions[channelName].params;
            }
        } else {
            schema = null;
        }

        return { group: group,
                 devices: devices,
                 computeModule: computeModule,
                 channelName: channelName,
                 schema: schema };
    },

    compileAlias: function(ast, schema, localscope) {
        if (ast === null)
            return null;
        if (Array.isArray(ast)) {
            ast.forEach(function(name) {
                if (schema === null) {
                    localscope[name] = Type.Any;
                } else {
                    if (!(name in schema))
                        throw new TypeError('Name ' + name + ' does not appear in schema');
                    localscope[name] = schema[name];
                }
            });
        } else {
            localscope[ast] = Type.Object(schema);
        }
        return ast;
    },

    compileInputs: function(localscope, ast) {
        return ast.map(function(input) {
            var selector = this.compileSelectors(input.selectors, 'r');
            selector.context = input.context;
            var alias = this.compileAlias(input.alias, selector.schema, localscope);

            var filters = input.filters.map(function(filter) {
                return this.compileFilter(filter, localscope, selector.schema);
            },this);

            var inputBlock = {
                selectors: selector,
                channels: [],
                update: this.compileUpdate(filters, alias),
                filters: input.filters.map(this.simplifyFilter.bind(this)).filter(function(f) { return f !== null; })
            };

            return inputBlock;
        }.bind(this));
    },

    compileOutputs: function(localscope, ast) {
        return ast.map(function(output) {
            var selector = this.compileSelectors(output.selectors, 'w');
            selector.context = output.context;

            var assignments = output.outputs.map(function(output) {
                return this.compileAssignment(output, localscope, selector.schema);
            }, this);

            var outputBlock = {
                selectors: selector,
                channels: [],
                action: this.compileAction(assignments)
            };

            return outputBlock;
        }, this);
    },

    compileModule: function(ast) {
        var module = { auth: {}, params: {}, state: {}, events: {}, functions: {} };
        var scope = {};

        ast.params.forEach(function(p) {
            if (p.name in module.params)
                throw new TypeError("Duplicate param " + p.name);
            module.params[p.name] = stringToType(p.type);
            scope[p.name] = module.params[p.name];
        });
        ast.statements.forEach(function(stmt) {
            if (stmt.isAuthDecl) {
                if (!stmt.name in this._scope ||
                    !this._scope[stmt.name].isGroup)
                    throw new TypeError("Auth directive for " + stmt.name + " does not name a group");
                if (stmt.name in auth)
                    throw new TypeError("Duplicate auth directive for " + stmt.name);
                auth[stmt.name] = stmt.mode;
                return;
            }

            if (stmt.name in scope || stmt.name in this._scope)
                throw new TypeError("Declaration " + stmt.name + " shadows existing name");
            if (stmt.isVarDecl) {
                module.state[stmt.name] = stringToType(stmt.type);
                scope[stmt.name] = module.state[stmt.name];
            } else if (stmt.isEventDecl) {
                var event = {};
                stmt.params.forEach(function(p) {
                    if (p.name in event)
                        throw new TypeError("Duplicate param " + p.name);
                    event[p.name] = stringToType(p.type);
                });
                module.events[stmt.name] = event;
                scope[stmt.name] = event;
            } else if (stmt.isFunctionDecl) {
                var params = {};
                stmt.params.forEach(function(p) {
                    if (p.name in params)
                        throw new TypeError("Duplicate param " + p.name);
                    params[p.name] = stringToType(p.type);
                });

                module.functions[stmt.name] = { params: params, code: stmt.code };
                scope[stmt.name] = module.functions[stmt.name];
            } else {
                throw new TypeError();
            }
        }, this);

        // if no auth directives are present
        // by policy we allow read/write access to compute modules
        // that are instantiated within one and exactly one group
        var explicitauths = Object.keys(module.auth);
        if (explicitauths.length === 0) {
            var paramnames = Object.keys(this._params);
            var groupnames = paramnames.filter(function(name) {
                return this._params[name].isGroup;
            }, this);
            if (groupnames.length === 1) {
                module.auth[groupnames[0]] = 'rw';
            }
        }

        return module;
    },

    lookupImport: function(name) {
        if (name === 'Aggregation')
            return { name: 'Aggregation' }; // FINISHME
        else if (name === 'Builtin')
            return { name: 'Builtin' };
        else
            throw new TypeError("Unknown import " + name);
    },

    compileProgram: function(ast) {
        this._programName = ast.name;
        ast.params.forEach(function(ast) {
            this._params[ast.name] = stringToType(ast.type);
            this._scope[ast.name] = this._params[ast.name];
        }, this);

        ast.statements.forEach(function(stmt) {
            if (stmt.isImport) {
                if (stmt.alias in this._imports)
                    throw new TypeError('Duplicate import declaration for ' + stmt.alias);
                this._imports[stmt.alias] = this.lookupImport(stmt.name);
            } else if (stmt.isComputeModule) {
                if (stmt.name in this._modules)
                    throw new TypeError('Duplicate declaration for module ' + stmt.name);
                if (stmt.name in this._scope)
                    throw new TypeError('Module declaration ' + stmt.name + ' aliases name in scope');
                this._modules[stmt.name] = this.compileModule(stmt);
                this._scope[stmt.name] = Type.Module;
            } else if (stmt.isRule) {
                var localscope = {};
                this._rules.push({
                    inputs: this.compileInputs(localscope, stmt.inputs),
                    outputs: this.compileOutputs(localscope, stmt.outputs)
                });
            }
        }, this);
    },

    compileChannelDescriptions: function(ast) {
        return ast.map(function(channel) {
            var localscope = {};
            for (var name in this._settings)
                localscope[name] = this._settings[name].type;

            var assignments = channel.props.map(function(output) {
                return this.compileAssignment(output, localscope, null);
            }, this);

            var channelBlock = {
                kind: channel.selector,
                properties: assignments,
            };

            return channelBlock;
        }.bind(this));
    },
});

var Selector = adt.data({
    VarRef: {
        name: adt.only(String),
    },
    Scoped: {
        scope: adt.only(String),
        name: adt.only(String),
    },
    Tags: {
        tags: adt.only(Array),
    },
    Id: {
        name: adt.only(String),
    },
    Kind: {
        name: adt.only(String)
    },
    Any: null,
});
module.exports.Selector = Selector;
var AtRule = adt.data({
    Setting: {
        name: adt.only(String),
        props: adt.only(Array),
    },
    Name: {
        value: adt.only(String),
    },
    Description: {
        value: adt.only(String),
    },
    Auth: {
        params: adt.only(Array),
    },
    Kind: {
        kind: adt.only(String),
    },
});
module.exports.AtRule = AtRule;
var Value = adt.data({
    Boolean: {
        value: adt.only(Boolean),
    },
    String: {
        value: adt.only(String)
    },
    Measure: {
        value: adt.only(Number),
        unit: adt.only(String)
    },
    Number: {
        value: adt.only(Number)
    },
    Location: {
        x: adt.only(Number),
        y: adt.only(Number),
    },
    Date: {
        value: adt.only(Date)
    },
    Object: {
        value: adt.only(Object)
    },
    Array: {
        value: adt.only(Array)
    },
});
module.exports.Value = Value;
var Expression = adt.data(function() {
    return ({
        Constant: {
            value: adt.only(Value)
        },
        VarRef: {
            name: adt.only(String)
        },
        ContextRef: {
            name: adt.only(String)
        },
        MemberRef: {
            object: adt.only(this),
            name: adt.only(String),
        },
        FunctionCall: {
            name: adt.only(String),
            args: adt.only(Array), // array of Expression
        },
        UnaryOp: {
            arg: adt.only(this),
            opcode: adt.only(String),
            op: adt.only(Function),
        },
        BinaryOp: {
            lhs: adt.only(this),
            rhs: adt.only(this),
            opcode: adt.only(String),
            op: adt.only(Function)
        }
    });
});
module.exports.Expression = Expression;
var InputRule = adt.data({
    Threshold: {
        lhs: adt.only(Expression),
        comparator: adt.only(String),
        rhs: adt.only(Expression)
    },
});
module.exports.InputRule = InputRule;
var OutputRule = adt.data({
    Assignment: {
        name: adt.only(String),
        rhs: adt.only(Expression)
    }
});
module.exports.OutputRule = OutputRule;
var Statement = adt.data({
    Import: {
        name: adt.only(String),
        alias: adt.only(String),
    },
    ComputeModule: {
        name: adt.only(String),
        params: adt.only(Array),
        statements: adt.only(Array), // array of ComputeStatement
    },
    Rule: {
        inputs: adt.only(Array),
        outputs: adt.only(Array),
    }
});
module.exports.Statement = Statement;
var ComputeStatement = adt.data({
    AuthDecl: {
        name: adt.only(String),
        mode: adt.only(String)
    },
    VarDecl: {
        name: adt.only(String),
        type: function(v) { if (v === null) return v;
                            else return adt.only(String).apply(this, arguments); },
    },
    EventDecl: {
        name: adt.only(String),
        params: adt.only(Array),
    },
    FunctionDecl: {
        name: adt.only(String),
        params: adt.only(Array),
        code: adt.only(String)
    }
});
module.exports.ComputeStatement = ComputeStatement;
