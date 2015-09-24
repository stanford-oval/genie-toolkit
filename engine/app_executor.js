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

const ExecEnvironment = new lang.Class({
    Name: 'ExecEnvironment',

    _init: function(devicedb, appstate) {
        this._devices = devicedb;
        this._state = appstate;

        this._aliases = {};
        this._this = null;
        this._output = null;
    },

    setAlias: function(alias, value) {
        this._aliases[alias] = value;
    },

    setThis: function(obj) {
        this._this = obj;
    },

    readVar: function(name) {
        if (this._this !== null && this._this[name] !== undefined)
            return this._this[name];
        if (this._output !== null && this._output[name] !== undefined)
            return this._output[name];
        if (this._aliases[name] !== undefined)
            return this._aliases[name];
        throw new TypeError("Unknown variable " + name);
    },

    readSetting: function(type, name) {
        if (this._state[name] !== undefined)
            return this._state[name];
        if (type === Type.Boolean)
            return false;
        if (type === Type.Number)
            return 0;
        if (type === Type.String)
            return '';
        if (type === Type.Location)
            return {x:0, y:0};
    },

    readObjectProp: function(object, name) {
        if (Array.isArray(object)) {
            return object.map(function(o) {
                var v = o[name];
                if (v === undefined)
                    throw new TypeError('Object ' + o + ' has no property ' + name);
                return v;
            });
        } else {
            var v = object[name];
            if (v === undefined)
                throw new TypeError('Object ' + object + ' has no property ' + name);
            return v;
        }
    },

    readObject: function(name) {
        // recognize short forms of thingengine references
        if (name === 'me')
            name = 'thingengine-own-phone';
        else if (name === 'home')
            name = 'thingengine-own-server';

        return this._devices.getDevice(name);
    },

    beginOutput: function() {
        this._output = {};
    },

    writeValue: function(name, value) {
        this._output[name] = value;
    },

    finishOutput: function() {
        var out = this._output;
        this._output = null;
        return out;
    }
});

module.exports = new lang.Class({
    Name: 'AppExecutor',
    Extends: events.EventEmitter,
    $rpcMethods: ['get name', 'get description', 'get code',
                  'get state', 'get settings', 'get uniqueId',
                  'get currentTier', 'get isRunning', 'get isEnabled'],

    _init: function(engine, code, state) {
        events.EventEmitter.call(this);

        this.engine = engine;
        this.state = state;
        this.code = code;

        // set automatically by the engine
        this.uniqueId = undefined;
        this.currentTier = undefined;
        this.isRunning = false;
        this.isEnabled = false;

        var ast = AppGrammar.parse(code);

        var name = undefined;
        var description = undefined;
        var settings = {};

        var warnings = [];
        function warn(msg) {
            warnings.push(msg);
        }

        function parseSetting(props) {
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

        ast['at-rules'].forEach(function(rule) {
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
                settings[rule.name] = parseSetting(rule.props);
            }
        });

        this.name = name;
        this.description = description;
        this.settings = settings;

        function parseConstant(value) {
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

        function parseVarRef(name) {
            // FIXME: figure out the type of this variable
            return [Type.Any, function(env) { return env.readVar(name); }];
        }

        function parseSettingRef(name) {
            var setting = settings[name];
            if (setting === undefined)
                throw new TypeError('Setting ' + name + ' is not declared');
            var type = setting.type;
            return [type, function(env) { return env.readSetting(type, name); }];
        }

        function parseMemberRef(objectast, name) {
            var objectexp = parseExpression(objectast);
            typeUnify(objectexp[0], Type.Object);

            var objectop = objectexp[1];
            // FIXME: figure out the type of this member
            return [Type.Any, function(env) {
                var object = objectop(env);
                return env.readObjectProp(object, name);
            }];
        }

        function parseObjectRef(name) {
            return [Type.Object, function(env) {
                return env.readObject(name);
            }];
        }

        function parseFunctionCall(name, argsast) {
            var func = Builtins[name];
            if (func === undefined)
                throw new TypeError("Unknown function " + name);
            if (argsast.length !== func.argtypes.length)
                throw new TypeError("Function " + func + " does not accept " +
                                    argsast.length + " arguments");
            var argsexp = argsast.map(parseExpression);
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

        function parseUnaryArithOp(argast, op) {
            var argexp = parseExpression(argast);
            var type = typeMakeArithmetic(argexp[0]);
            var argop = argexp[1];
            return [type, function(env) { return op(argop(env)); }];
        }

        function parseBinaryArithOp(lhsast, rhsast, op) {
            var lhsexp = parseExpression(lhsast);
            var rhsexp = parseExpression(rhsast);
            var type = typeMakeArithmetic(typeUnify(lhsexp[0], rhsexp[0]));
            var lhsop = lhsexp[1];
            var rhsop = rhsexp[1];
            return [type, function(env) { return op(lhsop(env), rhsop(env)); }];
        }

        function parseBinaryStringOp(lhsast, rhsast, op) {
            var lhsexp = parseExpression(lhsast);
            var rhsexp = parseExpression(rhsast);
            var lhsop = lhsexp[1];
            var rhsop = rhsexp[1];

            return [Type.String, function(env) {
                return op(objectToString(lhsop(env)),
                          objectToString(rhsop(env)));
            }];
        }

        function parseExpression(ast) {
            if (ast.isConstant)
                return parseConstant(ast.value);
            else if (ast.isVarRef)
                return parseVarRef(ast.name);
            else if (ast.isSettingRef)
                return parseSettingRef(ast.name);
            else if (ast.isMemberRef)
                return parseMemberRef(ast.object, ast.name);
            else if (ast.isObjectRef)
                return parseObjectRef(ast.name);
            else if (ast.isFunctionCall)
                return parseFunctionCall(ast.name, ast.args);
            else if (ast.isUnaryArithOp)
                return parseUnaryArithOp(ast.arg, ast.op);
            else if (ast.isBinaryArithOp)
                return parseBinaryArithOp(ast.lhs, ast.rhs, ast.op);
            else if (ast.isBinaryStringOp)
                return parseBinaryStringOp(ast.lhs, ast.rhs, ast.op);
        }

        function parseFilter(ast) {
            var lhs = parseExpression(ast.lhs);
            var rhs = parseExpression(ast.rhs);
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

        function parseAssignment(ast) {
            var rhs = parseExpression(ast.rhs);
            var name = ast.name;
            var op = rhs[1];
            return function(env) {
                env.writeValue(name, op(env));
            }
        }

        function parseHashSelector(ast) {
            return function(device) {
                return device.uniqueId === ast.name;
            }
        }

        function parseDotSelector(ast) {
            return function(device) {
                return device.hasKind(ast.name) || device.hasTag(ast.name);
            }
        }

        function parseSimpleSelector(ast) {
            if (ast.isHash)
                return parseHashSelector(ast);
            else if (ast.isDot)
                return parseDotSelector(ast);
        }

        function parseSelector(ast) {
            if (ast.length === 0)
                return null;

            var simplearray = ast.map(parseSimpleSelector);
            return function(device) {
                return simplearray.every(function(simple) {
                    return simple(device);
                });
            }
        }

        function parseChannelArgs(args) {
            var env = new ExecEnvironment(null, state);

            return args.map(function(ast) {
                // this should be enforced by the grammar
                if (!ast.isConstant && !ast.isSettingRef)
                    throw new TypeError("Only constants are allowed as channel arguments");

                var exp = parseExpression(ast);
                return exp[1](env);
            });
        }

        function continueUpdate(inputs, i, env, cont) {
            if (i+1 < inputs.length)
                inputs[i+1].update(inputs, i+1, env, cont);
            else
                cont();
        }

        function parseUpdateSome(filters, alias) {
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

        function parseUpdateAll(filters, alias) {
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

        function parseUpdate(quantifier, filters, alias) {
            if (quantifier === 'some')
                return parseUpdateSome(filters, alias);
            else
                return parseUpdateAll(filters, alias);
        }

        function parseAction(outputs) {
            return function(env) {
                outputs.forEach(function(output) {
                    output(env);
                });
            }
        }

        this.inputs = ast.inputs.map(function(input) {
            var inputBlock = {
                selector: parseSelector(input.selector),
                channelName: input.channelName,
                channelArgs: parseChannelArgs(input.channelArgs),
                channels: [],
                update: parseUpdate(input.quantifier, input.filters.map(parseFilter), input.alias),
            };

            return inputBlock;
        });

        this.outputs = ast.outputs.map(function(output) {
            var outputBlock = {
                selector: parseSelector(output.selector),
                channelName: output.channelName,
                channelArgs: parseChannelArgs(output.channelArgs),
                channels: [],
                action: parseAction(output.outputs.map(parseAssignment)),
            };

            return outputBlock;
        });
    },

    _onData: function() {
        try {
            var env = new ExecEnvironment(this.engine.devices, this.state);

            var inputs = this.inputs;
            var outputs = this.outputs;
            inputs[0].update(inputs, 0, env, function() {
                outputs.forEach(function(output) {
                    env.beginOutput();
                    output.action(env);
                    var out = env.finishOutput();
                    output.channels.forEach(function(channel) {
                        channel.sendEvent(out);
                    });
                });
            });
        } catch(e) {
            console.log('Error during app update: ' + e.message);
            console.log(e.stack);
        }
    },

    _onDeviceAdded: function(device) {
        var dataListener = this._dataListener;

        this.inputs.forEach(function(input) {
            if (input.selector !== null && input.selector(device)) {
                var args = [input.channelName].concat(input.channelArgs);
                var channel = device.getChannel.apply(device, args);
                input.channels.push(channel);
                channel.then(function(ch) {
                    ch.on('data', dataListener);
                    return ch;
                }).done();
            }
        });
        this.outputs.forEach(function(output) {
            if (output.selector !== null && output.selector(device)) {
                var args = [output.channelName].concat(output.channelArgs);
                output.channels.push(device.getChannel.apply(device, args));
            }
        });
    },

    _onDeviceRemoved: function(device) {
        var dataListener = this._dataListener;

        this.inputs.forEach(function(input) {
            input.channels.forEach(function(channel) {
                channel.then(function(ch) {
                    if (ch.uniqueId.indexOf('-' + device.uniqueId) >= 0) {
                        ch.removeListener('data', dataListener);
                        return ch.close().then(function() { return true; });
                    } else {
                        return false;
                    }
                }).then(function(yes) {
                    if (yes) {
                        var i = input.channels.indexOf(channel);
                        if (i >= 0)
                            input.channels.splice(i, 1);
                    }
                }).done();
            });
        });
        this.outputs.forEach(function(output) {
            output.channels.forEach(function(channel) {
                channel.then(function(ch) {
                    if (ch.uniqueId.indexOf('-' + device.uniqueId) >= 0) {
                        return ch.close().then(function() { return true; });
                    } else {
                        return false;
                    }
                }).then(function(yes) {
                    if (yes) {
                        var i = output.channels.indexOf(output);
                        if (i >= 0)
                            output.channels.splice(i, 1);
                    }
                }).done();
            });
        });
    },

    start: function() {
        var devices = this.engine.devices.getAllDevices();
        var channels = this.engine.channels;

        this._dataListener = this._onData.bind(this);
        var dataListener = this._dataListener;
        this._deviceAddedListener = this._onDeviceAdded.bind(this);
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);

        function openChannels(mode, block) {
            var args = [block.channelName].concat(block.channelArgs);

            if (block.selector !== null) {
                block.channels = devices.filter(block.selector).map(function(device) {
                    return device.getChannel.apply(device, args);
                });
            } else {
                // naked channel
                if (block.channelName.substr(0,5) === 'pipe-')
                    block.channels = [channels.getNamedPipe(block.channelName.substr(5), mode)];
                else
                    block.channels = [channels.getChannel.apply(channels, args)];
            }

            // catch any error during open
            Q.all(block.channels).done();
        }

        this.inputs.forEach(openChannels.bind(this, 'r'));
        this.outputs.forEach(openChannels.bind(this, 'w'));
        this.inputs.forEach(function(input) {
            input.channels.forEach(function(channel) {
                Q(channel).then(function(ch) {
                    ch.on('data', dataListener);
                });
            });
        });
        this.engine.devices.on('device-added', this._deviceAddedListener);
        this.engine.devices.on('device-removed', this._deviceRemovedListener);

        return Q();
    },

    stop: function() {
        var dataListener = this._dataListener;
        this.inputs.forEach(function(input) {
            input.channels.forEach(function(channel) {
                Q(channel).then(function(ch) {
                    ch.removeListener('data', dataListener);
                });
            });
        });

        function closeChannels(block) {
            block.channels.forEach(function(channel) {
                Q(channel).then(function(ch) {
                    ch.close().done();
                });
            });
        }

        this.engine.devices.removeListener('device-added', this._deviceAddedListener);
        this.engine.devices.removeListener('device-removed', this._deviceRemovedListener);

        this.inputs.forEach(closeChannels);
        this.outputs.forEach(closeChannels);

        this._dataListener = null;
        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        return Q();
    }
});
