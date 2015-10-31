// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

{
    var adt = require('adt');
    var AppCompiler = require('./app_compiler');

    var Selector = AppCompiler.Selector;
    var AtRule = AppCompiler.AtRule;
    var Value = AppCompiler.Value;
    var Expression = AppCompiler.Expression;
    var InputRule = AppCompiler.InputRule;
    var OutputRule = AppCompiler.OutputRule;

    function take(array, idx) {
        return array.map(function(v) { return v[idx]; });
    }
}

// global grammar

program = _ at_rules: (at_app_rule _)* inputs:input_channel_list '=>' _ outputs:output_channel_list _ {
    return ({ 'at-rules': take(at_rules, 0), inputs: inputs, outputs: outputs });
}
query =  _ inputs: (input_channel _)+ {
    return take(inputs, 0);
}
device_description = _ at_rules: (at_device_rule _)* _ channels:channel_meta_list _ {
    return ({ 'at-rules': take(at_rules, 0), channels: channels });
}

at_app_rule = at_setting / at_name / at_description
at_device_rule = at_setting / at_name / at_description / at_auth / at_kind
at_setting = '@setting' _ name:ident _ '{' _ props:(output_property _)* '}' { return AtRule.Setting(name, take(props, 0)); }
at_name = '@name' _ name:literal_string _ ';' { return AtRule.Name(name); }
at_description = '@description' _ desc:literal_string _ ';' { return AtRule.Description(desc); }
at_auth = '@auth' _ '{' _ props:(output_property _)* '}' { return AtRule.Auth(take(props, 0)); }
at_kind = '@kind' _ kind:tag_selector _ ';' {
    return AtRule.Kind(kind);
}

input_channel_list = first:input_channel _ rest:(',' _ input_channel _)* {
    return [first].concat(take(rest, 2));
}
input_channel = quantifier:(('all' / 'some') __)? selector:selector_list _ '{' _ filters:(input_property _)* '}' _ alias:('as' __ ident _)? {
    return ({ quantifier: quantifier !== null ? quantifier[0] : 'some',
              alias: alias !== null ? alias[2] : null,
              selectors: selector,
              filters: take(filters, 0) });
}
output_channel_list = first:output_channel _ rest:(',' _ output_channel _)* {
    return [first].concat(take(rest, 2));
}
output_channel = selector:selector_list _ '{' _ outputs: (output_property _)* '}' {
    return ({ selectors: selector,
              outputs: take(outputs, 0) });
}
channel_meta_list = channels:(channel_meta _)* {
    return take(channels, 0);
}
channel_meta = tag:tag_selector _ '{' _ props:(output_property _)* '}' {
    return ({ selector: tag,
              props: take(props, 0) });
}

selector_list = first:simple_selector _ rest:('->' _ simple_selector _)* {
    return [first].concat(take(rest, 2));
}
simple_selector = selector:at_selector { return [selector]; } /
    selector:(selector _)+ { return take(selector, 0); }
at_selector = '@pipe' _ id:id_selector { return Selector.AtPipe(id.name); } /
    '@me' { return Selector.AtContext('me'); } /
    '@phone' { return Selector.AtContext('phone'); } /
    '@home' { return Selector.AtContext('home'); } /
    '@cloud' { return Selector.AtContext('cloud'); } /
    '@global' { return Selector.AtContext('global'); } /
    '@' name:ident { return Selector.AtSetting(name); }
selector = id_selector / tag_selector
id_selector = '.' name:ident { return Selector.Id(name); }
tag_selector = '#' name:ident { return Selector.Tag(name); }

input_property = rule:(change_expression / input_filter) _ ';' {
    return rule;
}
input_filter = lhs:expression _ comp:comparator _ rhs:expression {
    return InputRule.Threshold(lhs, comp, rhs);
}
change_expression = 'change' __ lhs:expression _ by:('by' __ amount:expression)? {
    return InputRule.Change(lhs, by !== null ? by[2] : null);
}
output_property = name:ident _ ( ':' / '=' ) _ rhs:expression _ ';' {
    return OutputRule.Assignment(name, rhs);
}
comparator "comparator" = '>=' / '<=' / '>' / '<' / '=~' / 'has~' / 'has' / '=' / ':' / '!='

// expression language

expression =
    '-' _ arg:mult_expression { return Expression.UnaryOp(arg, '-', function(x) { return -x; }); } /
    lhs:mult_expression _ '+' _ rhs:expression { return Expression.BinaryOp(lhs, rhs, '+', function(x, y) { return x + y; }); } /
    lhs:mult_expression _ '-' _ rhs:expression { return Expression.BinaryOp(lhs, rhs, '-', function(x, y) { return x - y; }); } /
    mult_expression
mult_expression =
    lhs:member_expression _ '*' _ rhs:mult_expression { return Expression.BinaryOp(lhs, rhs, '*', function(x, y) { return x * y; }); } /
    lhs:member_expression _ '/' _ rhs:mult_expression { return Expression.BinaryOp(lhs, rhs, '/', function(x, y) { return x / y; }); } /
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
__ = whitespace _
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
