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

const UnitsToBaseUnit = {
    // percent
    '%': '%',
    // time
    's': 's',
    'min': 's',
    'h': 's',
    'day': 's',
    'week': 's',
    'mon': 's', // business month, aka exactly 30 days
    'year': 's', // business year (365 days exactly, no leap years)
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
    'bar': 'bar',
    'psi': 'psi',
    'mmHg': 'mmHg',
    'inHg': 'inHg',
    'atm': 'atm',
    // temperature
    'C': 'C',
    'F': 'C',
    'K': 'C',
};

const UnitsTransformToBaseUnit = {
    '%': '%',
    's': 1,
    'min': 60,
    'h': 3600,
    'day': 86400,
    'week': 86400 * 7,
    'mon': 86400 * 30,
    'year': 86400 * 365,
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
            elem: this
        },
        Location: null,
        Object: null,
    };
});

function stringToType(s) {
    switch(s) {
    case 'bool':
        return Type.Boolean;
    case 'string':
        return Type.String;
    case 'number':
        return Type.Number;
    case 'location':
        return Type.Location;
    default:
        // anything else is a unit of measure
        return Type.Measure(s);
    }
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

const Comparators = {
    '>': {
        types: [Type.String, Type.Measure(''), Type.Number],
        op: function(a, b) { return a > b; },
    },
    '<': {
        types: [Type.String, Type.Measure(''), Type.Number],
        op: function(a, b) { return a < b; },
    },
    '>=': {
        types: [Type.String, Type.Measure(''), Type.Number],
        op: function(a, b) { return a >= b; },
    },
    '<=': {
        types: [Type.String, Type.Measure(''), Type.Number],
        op: function(a, b) { return a <= b; },
    },
    '=': {
        types: [Type.Any],
        op: function(a, b) { return a === b; },
    },
    ':': {
        types: [Type.Any],
        op: function(a, b) { return a === b; },
    },
    '!=': {
        types: [Type.Any],
        op: function(a, b) { return a !== b; },
    },
    '~=': {
        types: [Type.String],
        op: function(a, b) { return a.indexOf(b) >= 0; },
    },
};

const Builtins = {
    'join': {
        argtypes: [Type.Array, Type.String],
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
    }
};

function compileConstant(value) {
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
}

function compileVarRef(name) {
    // FIXME: figure out the type of this variable
    return [Type.Any, function(env) { return env.readVar(name); }];
}

function compileSettingRef(name) {
    var setting = settings[name];
    if (setting === undefined)
        throw new TypeError('Setting ' + name + ' is not declared');
    var type = setting.type;
    return [type, function(env) { return env.readSetting(type, name); }];
}

function compileMemberRef(objectast, name) {
    var objectexp = compileExpression(objectast);
    typeUnify(objectexp[0], Type.Object);

    var objectop = objectexp[1];
    // FIXME: figure out the type of this member
    return [Type.Any, function(env) {
        var object = objectop(env);
        return env.readObjectProp(object, name);
    }];
}

function compileObjectRef(name) {
    return [Type.Object, function(env) {
        return env.readObject(name);
    }];
}

function compileFunctionCall(name, argsast) {
    var func = Builtins[name];
    if (func === undefined)
        throw new TypeError("Unknown function " + name);
    if (argsast.length !== func.argtypes.length)
        throw new TypeError("Function " + func + " does not accept " +
                            argsast.length + " arguments");
    var argsexp = argsast.map(compileExpression);
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
}

function compileUnaryArithOp(argast, op) {
    var argexp = compileExpression(argast);
    var type = typeMakeArithmetic(argexp[0]);
    var argop = argexp[1];
    return [type, function(env) { return op(argop(env)); }];
}

function compileBinaryArithOp(lhsast, rhsast, op) {
    var lhsexp = compileExpression(lhsast);
    var rhsexp = compileExpression(rhsast);
    var type = typeMakeArithmetic(typeUnify(lhsexp[0], rhsexp[0]));
    var lhsop = lhsexp[1];
    var rhsop = rhsexp[1];
    return [type, function(env) { return op(lhsop(env), rhsop(env)); }];
}

function compileBinaryStringOp(lhsast, rhsast, op) {
    var lhsexp = compileExpression(lhsast);
    var rhsexp = compileExpression(rhsast);
    var lhsop = lhsexp[1];
    var rhsop = rhsexp[1];

    return [Type.String, function(env) {
        return op(objectToString(lhsop(env)),
                  objectToString(rhsop(env)));
    }];
}

function compileExpression(ast) {
    if (ast.isConstant)
        return compileConstant(ast.value);
    else if (ast.isVarRef)
        return compileVarRef(ast.name);
    else if (ast.isSettingRef)
        return compileSettingRef(ast.name);
    else if (ast.isMemberRef)
        return compileMemberRef(ast.object, ast.name);
    else if (ast.isObjectRef)
        return compileObjectRef(ast.name);
    else if (ast.isFunctionCall)
        return compileFunctionCall(ast.name, ast.args);
    else if (ast.isUnaryArithOp)
        return compileUnaryArithOp(ast.arg, ast.op);
    else if (ast.isBinaryArithOp)
        return compileBinaryArithOp(ast.lhs, ast.rhs, ast.op);
    else if (ast.isBinaryStringOp)
        return compileBinaryStringOp(ast.lhs, ast.rhs, ast.op);
}

function compileFilter(ast) {
    var lhs = compileExpression(ast.lhs);
    var rhs = compileExpression(ast.rhs);
    var type = typeUnify(lhs[0], rhs[0]);
    var comp = Comparators[ast.comparator];

    function acceptableType(t) {
        try {
            typeUnify(t, type);
            return true;
        } catch(e) {
            return false;
        }
    }
    if (!comp.types.some(acceptableType))
        throw new TypeError('Comparator ' + ast.comparator +
                            ' does not accept type ' + type);

    var lhsop = lhs[1];
    var rhsop = rhs[1];
    var compop = comp.op;
    return function(env) {
        return compop(lhsop(env), rhsop(env));
    }
}

function compileAssignment(ast) {
    var rhs = compileExpression(ast.rhs);
    var name = ast.name;
    var op = rhs[1];
    return function(env) {
        env.writeValue(name, op(env));
    }
}

function compileHashSelector(ast) {
    return function(device) {
        return device.uniqueId === ast.name;
    }
}

function compileDotSelector(ast) {
    return function(device) {
        return device.hasKind(ast.name) || device.hasTag(ast.name);
    }
}

function compileSimpleSelector(ast) {
    if (ast.isHash)
        return compileHashSelector(ast);
    else if (ast.isDot)
        return compileDotSelector(ast);
}

function compileSelector(ast) {
    if (ast.length === 0)
        return null;

    var simplearray = ast.map(compileSimpleSelector);
    return function(device) {
        return simplearray.every(function(simple) {
            return simple(device);
        });
    }
}

function compileChannelArgs(args) {
    var env = new ExecEnvironment(null, {});

    return args.map(function(ast) {
        // this should be enforced by the grammar
        if (!ast.isConstant && !ast.isSettingRef)
            throw new TypeError("Only constants are allowed as channel arguments");

        var exp = compileExpression(ast);
        return exp[1](env);
    });
}

function continueUpdate(inputs, i, env, cont) {
    if (i+1 < inputs.length)
        inputs[i+1].update(inputs, i+1, env, cont);
    else
        cont();
}

function compileUpdateSome(filters, alias) {
    return function(inputs, i, env, cont) {
        return this.channels.forEach(function(channel) {
            if (channel.event === null)
                return;

            env.setThis(channel.event);
            var ok = filters.every(function(filter) {
                return filter(env);
            });
            env.setThis(null);
            if (ok) {
                if (alias !== null)
                    env.setAlias(alias, channel.event);

                continueUpdate(inputs, i, env, cont);
            }
        });
    };
}

function compileUpdateAll(filters, alias) {
    return function(inputs, i, env, cont) {
        var ok = this.channels.every(function(channel) {
            if (channel.event === null)
                return false;

            env.setThis(channel.event);
            return filters.every(function(filter) {
                return filter(env);
            });
        });
        env.setThis(null);
        if (ok) {
            if (alias !== null) {
                env.setAlias(alias, this.channels.map(function(c) {
                    return c.event;
                }));
            }

            continueUpdate(inputs, i, env, cont);
        }
    }
}

function compileUpdate(quantifier, filters, alias) {
    if (quantifier === 'some')
        return compileUpdateSome(filters, alias);
    else
        return compileUpdateAll(filters, alias);
}

function compileAction(outputs) {
    return function(env) {
        outputs.forEach(function(output) {
            output(env);
        });
    }
}

module.exports = new lang.Class({
    Name: 'AppCompiler',

    _init: function(withActions) {
        this._withActions = withActions;
        this._settings = {};
        this._name = undefined;
        this._description = undefined;
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

    compileAtRules: function(ast) {
        var name = undefined;
        var description = undefined;
        var settings = {};

        var warnings = [];
        function warn(msg) {
            warnings.push(msg);
        }

        function compileSetting(props) {
            var name, description, type;

            props.forEach(function(assignment) {
                switch(assignment.name) {
                case 'name':
                    if (name !== undefined)
                        warn("Duplicate @setting.name declaration");
                    if (!assignment.rhs.isConstant || !assignment.rhs.value.isString)
                        throw new TypeError("Invalid @setting.name");
                    name = assignment.rhs.value.value;
                    return;
                case 'description':
                    if (description !== undefined)
                        warn("Duplicate @setting.description declaration");
                    if (!assignment.rhs.isConstant || !assignment.rhs.value.isString)
                        throw new TypeError("Invalid @setting.description");
                    description = assignment.rhs.value.value;
                    return;
                case 'type':
                    if (type !== undefined)
                        warn("Duplicate @setting.type declaration");
                    if (!assignment.rhs.isVarRef)
                        throw new TypeError("Invalid @setting.type");
                    type = stringToType(assignment.rhs.name);
                    return;
                default:
                    warn("Unknown @setting parameter " + assignment.name);
                }
            });

            if (type === undefined)
                throw new Error("Missing @setting.type");
            return ({ name: name,
                      description: description,
                      type: type });
        }

        ast.forEach(function(rule) {
            if (rule.isName) {
                if (name !== undefined)
                    warn("Duplicate @name declaration");
                name = rule.value;
            } else if (rule.isDescription) {
                if (description !== undefined)
                    warn("Duplication @description declaration");
                description = rule.value;
            } else if (rule.isSetting) {
                if (settings[rule.name] !== undefined)
                    warn("Duplicate @setting declaration for " + rule.name);
                settings[rule.name] = compileSetting(rule.props);
            }
        });

        this._name = name;
        this._description = description;
        this._settings = settings;
    },

    compileInputs: function(ast) {
        return ast.map(function(input) {
            var inputBlock = {
                selector: compileSelector(input.selector),
                channelName: input.channelName,
                channelArgs: compileChannelArgs(input.channelArgs),
                channels: [],
                update: compileUpdate(input.quantifier, input.filters.map(compileFilter), input.alias),
            };

            return inputBlock;
        });
    },

    compileOutputs: function(ast) {
        return ast.map(function(output) {
            var outputBlock = {
                selector: compileSelector(output.selector),
                channelName: output.channelName,
                channelArgs: compileChannelArgs(output.channelArgs),
                channels: [],
                action: compileAction(output.outputs.map(compileAssignment)),
            };

            return outputBlock;
        });
    },
});

