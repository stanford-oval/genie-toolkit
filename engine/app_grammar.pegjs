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

    var Statement = AppCompiler.Statement;
    var ComputeStatement = AppCompiler.ComputeStatement;
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

// stuff to be removed

device_description = _ at_rules: (at_device_rule _)* _ channels:channel_meta_list _ {
    return ({ 'at-rules': take(at_rules, 0), channels: channels });
}
channel_meta_list = channels:(channel_meta _)* {
    return take(channels, 0);
}
channel_meta = tag:tag_selector _ '{' _ props:(output_property _)* '}' {
    return ({ selector: tag,
              props: take(props, 0) });
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
output_property = name:cssident _ ':' _ rhs:expression _ ';' {
    return OutputRule.Assignment(name, rhs);
}

// global grammar

program = _ name:ident _ params:decl_param_list _ '{' _ statements:(statement _)+ '}' _ {
    return ({ name: name, params: params,
              statements: take(statements, 0) });
}
query = input_channel_list

statement = import_stmt / compute_module / table / rule

import_stmt = 'import' __ name:ident alias:(__ 'as' __ ident)? _ ';' {
    return Statement.Import(name, alias !== null ? alias[3] : name);
}
compute_module = 'module' __ name:ident _ params:decl_param_list _ '{' _ statements:(compute_stmt _)+ _ '}' _ {
    return Statement.ComputeModule(name, params, take(statements, 0));
}
table = 'table' __ name:ident _ params:decl_param_list _ ';' {
    return Statement.Table(name, params);
}
compute_stmt = auth_decl / var_decl / event_decl / function_decl
auth_decl = 'auth' __ name:ident __ mode:('rw' / 'r' / 'w')? _ ';' {
    return ComputeStatement.AuthDecl(name, mode !== null ? mode : 'rw');
}
var_decl = 'var' __ name:ident _ type:(':' _ type_ref _)? ';' {
    return ComputeStatement.VarDecl(name, type !== null ? type[2] : null);
}
event_decl = 'event' __ name:ident _ params:decl_param_list _ ';' {
    return ComputeStatement.EventDecl(name, params);
}
function_decl = 'function' __ name:ident _ params:decl_param_list _ '{' code:$(js_code*) '}' {
    return ComputeStatement.FunctionDecl(name, params, code);
}
js_code = '{' js_code* '}' / '(' js_code* ')' / '[' js_code* ']' / literal_string / [^{}\(\)\[\]\"\']

rule = inputs:input_channel_list '=>' _ outputs:output_channel_list _ ';' {
    return Statement.Rule(inputs, outputs);
}

decl_param_list = '(' _ ')' { return []; } /
    '(' _ first:decl_param _ rest:(',' _ decl_param _)* ')' {
        return [first].concat(take(rest, 2));
    }
decl_param = name:ident _ ':' _ type:type_ref {
    return { name: name, type: type };
}

input_channel_list = first:input_channel _ rest:(',' _ input_channel _)* {
    return [first].concat(take(rest, 2));
}
input_channel = alias:(alias_spec _ '=' _)? context:(at_context _ '.' _)? selectors:input_selector _ filters:input_param_list? {
    return ({ alias: alias !== null ? alias[0] : null,
              context: context !== null ? context[0] : 'self',
              selectors: selectors,
              filters: filters !== null ? filters : [] });
}
alias_spec = ident / '(' _ first:ident _ rest:(',' _ ident _)* ')' {
    return [first].concat(take(rest, 2));
}
input_param_list = '(' _ ')' { return []; } / '(' _ first:input_param _ rest:(',' _ input_param _)* ')' {
    return [first].concat(take(rest, 2));
}
input_param = lhs:expression _ comp:comparator _ rhs:expression {
    return InputRule.Threshold(lhs, comp, rhs);
}
comparator "comparator" = '>=' / '<=' / '>' / '<' / '=~' / 'has~' / 'has' / '=' / ':' / '!='

output_channel_list = first:output_channel _ rest:(',' _ output_channel _)* {
    return [first].concat(take(rest, 2));
}
output_channel = context:(at_context _ '.')? selectors:output_selector _ outputs:output_param_list {
    return ({ context: context !== null ? context[0] : 'self',
              selectors: selectors,
              outputs: outputs });
}
output_param_list = '(' _ ')' { return []; } / '(' _ first:output_param _ rest:(',' _ output_param _)* ')' {
    return [first].concat(take(rest, 2));
}
output_param = name:ident _ '=' _ rhs:expression {
    return OutputRule.Assignment(name, rhs);
}

at_context "@-context" = '@self' { return 'self'; } /
    '@phone' { return 'phone'; } /
    '@home' { return 'home'; } /
    '@cloud' { return 'cloud'; } /
    '@global' { return 'global'; }
// this grammar is a bit loose, there are actual restrictions on what
// is a valid selector list that are not captured by this
input_selector = aggregate_selector / selector_list
output_selector = selector_list
selector_list = first:simple_selector _ rest:('.' _ simple_selector _)* {
    return [first].concat(take(rest, 2));
}
outermost_selector = aggregate_selector / simple_selector
simple_selector = tag_selector_list / id_selector / scoped_selector / var_selector
tag_selector_list = tags:(tag_selector _)+ {
    return Selector.Tags(take(tags, 0));
}
tag_selector "hashtag" = '#' name:cssident { return name; }
id_selector = name:literal_string { return Selector.Id(name); }
scoped_selector = scope:ident _ '::' _ name:ident { return Selector.Scoped(scope, name); }
aggr_op = 'max' / 'min' / 'avg' / 'sum' / 'all'
aggregate_selector = op:aggr_op _ '(' _ inner:selector_list _ ',' _ what:ident _ ')' {
    return [Selector.Aggregate(inner, op, what)];
}
var_selector = name:ident { return Selector.VarRef(name); }

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
primary_expression "primary" = literal / context_ref / function_call /
    name:ident { return Expression.VarRef(name); } /
    '(' _ subexp:expression _ ')' { return subexp; }
function_call = name:ident '(' _ args:parameter_list? _ ')' {
    return Expression.FunctionCall(name, args === null ? [] : args);
}
parameter_list = first:expression _ rest:(',' _ expression _)* {
    return [first].concat(take(rest, 2))
}
context_ref = ctx:at_context { return Expression.ContextRef(ctx); }
literal "literal" = val:literal_bool { return Expression.Constant(Value.Boolean(val)); } /
    val:literal_string { return Expression.Constant(Value.String(val)); } /
    val:literal_number unit:('%' / ident) { return Expression.Constant(Value.Measure(val, unit)); } /
    val:literal_number { return Expression.Constant(Value.Number(val)); }
type_ref = $('Measure(' ident? ')') / $('Array(' type_ref ')') / ident

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
identchar = [A-Za-z0-9_\-]
ident "ident" = $(identstart identchar*)

cssidentstart = [A-Za-z]
cssidentchar = [A-Za-z\-0-9_]
cssident "cssident" = $(cssidentstart cssidentchar*)

_ = (whitespace / comment)*
__ = whitespace _
whitespace "whitespace" = [ \r\n\t\v]
comment "comment" = '/*' ([^*] / '*'[^/])* '*/' / '//' [^\n]* '\n'

/*
{
    module.exports.AtRule = AtRule;
    module.exports.Selector = Selector;
    module.exports.Value = Value;
    module.exports.Expression = Expression;
}
*/
