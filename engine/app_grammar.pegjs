// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

{
    var adt = require('adt');

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
    });
    var Selector = adt.data({
        Hash: {
            name: adt.only(String),
        },
        Dot: {
            name: adt.only(String),
        },
    });
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
        }
    });
    var Expression = adt.data(function() {
        return ({
            Constant: {
                value: adt.only(Value)
            },
            VarRef: {
                name: adt.only(String)
            },
            SettingRef: {
                name: adt.only(String)
            },
            MemberRef: {
                object: adt.only(this),
                name: adt.only(String),
            },
            ObjectRef: {
                name: adt.only(String),
            },
            FunctionCall: {
                name: adt.only(String),
                args: adt.only(Array), // array of Expression
            },
            UnaryArithOp: {
                arg: adt.only(this),
                op: adt.only(Function),
            },
            BinaryArithOp: {
                lhs: adt.only(this),
                rhs: adt.only(this),
                op: adt.only(Function)
            },
            BinaryStringOp: {
                lhs: adt.only(this),
                rhs: adt.only(this),
                op: adt.only(Function)
            }
        });
    });

    function take(array, idx) {
        return array.map(function(v) { return v[idx]; });
    }
}

// global grammar

program = _ at_rules: (at_rule _)* inputs: (input_channel _)+ '=>' _ outputs: (output_channel _)+ _ {
    return ({ 'at-rules': take(at_rules, 0), inputs: take(inputs, 0), outputs: take(outputs, 0) });
}

at_rule = at_setting / at_name / at_description
at_setting = '@setting' _ name:ident _ '{' _ props:(output_property _)* '}' { return AtRule.Setting(name, take(props, 0)); }
at_name = '@name' _ name:literal_string _ ';' { return AtRule.Name(name); }
at_description = '@description' _ desc:literal_string _ ';' { return AtRule.Description(desc); }

input_channel = quantifier:(('all' / 'some') _)? channel:channel_descriptor _ alias:('as' _ ident _)? '{' _ filters:(input_property _)* '}' {
    return ({ quantifier: quantifier !== null ? quantifier[0] : 'some',
              alias: alias !== null ? alias[2] : null,
              channelName: channel.pseudo !== null ? channel.pseudo.name : 'source',
              channelArgs: channel.pseudo !== null ? channel.pseudo.args : [],
              selector: channel.selector,
              filters: take(filters, 0) });
}
output_channel = channel:channel_descriptor _ '{' _ outputs: (output_property _)* '}' {
    return ({ selector: channel.selector,
              channelName: channel.pseudo !== null ? channel.pseudo.name : 'sink',
              channelArgs: channel.pseudo !== null ? channel.pseudo.args : [],
              outputs: take(outputs, 0) });
}

channel_param = literal / setting_ref
channel_paramlist = first:channel_param _ rest:(',' _ channel_param _)* {
    return [first].concat(take(rest, 2))
}
channel_spec = ':' name:ident args:('(' channel_paramlist ')')? {
    return { name: name, args: args !== null ? args[1] : [] };
}
channel_descriptor = selector:selector+ pseudo:channel_spec? {
    return ({ selector: selector, pseudo: pseudo }); } /
    pseudo:channel_spec { return ({ selector: [], pseudo: pseudo }); }
selector = hash_selector / dot_selector
hash_selector = '#' name:ident { return Selector.Hash(name); }
dot_selector = '.' name:ident { return Selector.Dot(name); }

input_property = lhs:expression _ comp:comparator _ rhs:expression _ ';' {
    return ({ lhs: lhs, comparator: comp, rhs: rhs });
}
output_property = name:ident _ ( ':' / '=' ) _ rhs:expression _ ';' {
    return ({ name: name, rhs: rhs });
}
comparator "comparator" = '>=' / '<=' / '>' / '<' / '=' / ':' / '!=' / '~='

// expression language

expression =
    '-' _ arg:mult_expression { return Expression.UnaryArithOp(arg, function(x) { return -x; }); } /
    lhs:mult_expression _ '+' _ rhs:expression { return Expression.BinaryArithOp(lhs, rhs, function(x, y) { return x + y; }); } /
    lhs:mult_expression _ '-' _ rhs:expression { return Expression.BinaryArithOp(lhs, rhs, function(x, y) { return x - y; }); } /
    lhs:mult_expression _ rhs:expression { return Expression.BinaryStringOp(lhs, rhs, function(x, y) { return x + y; }); } /
    mult_expression
mult_expression =
    lhs:member_expression _ '*' _ rhs:mult_expression { return Expression.BinaryArithOp(lhs, rhs, function(x, y) { return x * y; }); } /
    lhs:member_expression _ '/' _ rhs:mult_expression { return Expression.BinaryArithOp(lhs, rhs, function(x, y) { return x / y; }); } /
    member_expression
member_expression =
    lhs:primary_expression '.' name:ident { return Expression.MemberRef(lhs, name); } /
    primary_expression
primary_expression = literal / function_call / setting_ref / object_ref /
    name:ident { return Expression.VarRef(name); } /
    '(' _ subexp:expression _ ')' { return subexp; }
function_call = name:ident '(' _ args:parameter_list? _ ')' {
    return Expression.FunctionCall(name, args === null ? [] : args);
}
parameter_list = first:expression _ rest:(',' _ expression _)* {
    return [first].concat(take(rest, 2))
}
setting_ref = '@' name:ident { return Expression.SettingRef(name); }
object_ref = '#' name:ident { return Expression.ObjectRef(name); }
literal "literal" = val:literal_bool { return Expression.Constant(Value.Boolean(val)); } /
    val:literal_string { return Expression.Constant(Value.String(val)); } /
    val:literal_number unit:('%' / ident) { return Expression.Constant(Value.Measure(val, unit)); } /
    val:literal_number { return Expression.Constant(Value.Number(val)); }

// tokens

literal_bool = true_bool { return true; } / false_bool { return false; }
true_bool = 'on' / 'true'
false_bool = 'off' / 'false'

// dqstrchar = double quote string char
// sqstrchar = single quote string char
dqstrchar = [^\\\"] / "\\\"" { return '"'; } / "\\n" { return '\n'; } / "\\'" { return '\''; }
sqstrchar = [^\\\'] / "\\\"" { return '"'; } / "\\n" { return '\n'; } / "\\'" { return '\''; }
literal_string "string" = '"' chars:dqstrchar* '"' { return chars.join(''); }
    / "'" chars:sqstrchar* "'" { return chars.join(''); }
digit "digit" = [0-9]
literal_number "number" = num:$(digit+ ('e' digit+)?) { return parseFloat(num); } /
    num:$(digit+ '.' digit* ('e' digit+)?) { return parseFloat(num); } /
    num:$('.' digit+ ('e' digit+)?) { return parseFloat(num); }

identstart = [A-Za-z]
identchar = [A-Za-z\-0-9_]
ident "ident" = $(identstart identchar*)

_ = (whitespace / comment)*
whitespace "whitespace" = [ \r\n\t\v]
comment "comment" = '/*' ([^*] / '*'[^/])* '*/'

/*
{
    module.exports.AtRule = AtRule;
    module.exports.Selector = Selector;
    module.exports.Value = Value;
    module.exports.Expression = Expression;
}
*/
