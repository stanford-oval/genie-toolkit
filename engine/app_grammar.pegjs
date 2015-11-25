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
    var Value = AppCompiler.Value;
    var Attribute = AppCompiler.Attribute;
    var Expression = AppCompiler.Expression;
    var InputSpec = AppCompiler.InputSpec;
    var OutputSpec = AppCompiler.OutputSpec;
    var KeywordParam = AppCompiler.KeywordParam;
    var Keyword = AppCompiler.Keyword;

    function take(array, idx) {
        return array.map(function(v) { return v[idx]; });
    }
}

// global grammar

program = _ name:keyword _ params:decl_param_list _ '{' _ statements:(statement _)+ '}' _ {
    return ({ name: name, params: params,
              statements: take(statements, 0) });
}
decl_param_list = '(' _ ')' { return []; } /
    '(' _ first:decl_param _ rest:(',' _ decl_param _)* ')' {
        return [first].concat(take(rest, 2));
    }
decl_param = name:ident _ ':' _ type:type_ref {
    return { name: name, type: type };
}

statement = keyword_decl / compute_module / rule

compute_module = 'module' __ name:ident _ params:decl_param_list _ '{' _ statements:(compute_stmt _)+ _ '}' _ {
    return Statement.ComputeModule(name, params, take(statements, 0));
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

keyword_tuple_decl = access:('var' / 'extern') __ name:keyword _ ':' _ params:type_list _ ';' {
    return Statement.VarDecl(name, params, false, access === 'extern');
}
keyword_array_decl = access:('var' / 'extern') __ name:keyword _ ':' _ 'Array' __ params:type_list _ ';' {
    return Statement.VarDecl(name, params, true, access === 'extern');
}
keyword_decl = keyword_tuple_decl / keyword_array_decl;
type_list = '(' _ first:type_ref _ rest:(',' _ type_ref _)* ')' {
    return [first].concat(take(rest, 2));
}

rule = inputs:input_list _ '=>' _ output:(channel_output_spec / keyword_output) _ ';' {
    return Statement.Rule(inputs, output);
}
input_list = first:(channel_input_spec / nontrigger_input_spec) _ rest:(',' _ nontrigger_input_spec _)* {
    return [first].concat(take(rest, 2));
}
nontrigger_input_spec = keyword_input / member_binding / left_binding / right_binding / condition

channel_input_spec = trigger:(builtin_spec / trigger_spec) _ params:input_param_list {
    return InputSpec.Trigger(trigger[0], trigger[1], params);
}
keyword_input = negative_keyword / positive_keyword
negative_keyword = '!' _ keyword:positive_keyword {
    return InputSpec.Keyword(keyword.keyword, keyword.owner, keyword.params, true);
}
positive_keyword = keyword:keyword _ owner:ownership? _ params:input_param_list {
    return InputSpec.Keyword(keyword, owner, params, false);
}
member_binding = name:ident _ 'in' __ 'F' _ {
    return InputSpec.MemberBinding(name);
}
left_binding = name:ident _ '=' _ expr:expression {
    return InputSpec.Binding(name, expr);
}
right_binding = expr:expression _ '=' _ name:ident {
    return InputSpec.Binding(name, expr);
}
condition = expr:expression {
    return InputSpec.Condition(expr);
}

channel_output_spec = action:(builtin_spec / action_spec) params:output_param_list {
    return OutputSpec.Action(action[0], action[1], params);
}
keyword_output = keyword:keyword _ owner:ownership? _ params:output_param_list {
    return OutputSpec.Keyword(keyword, owner, params);
}

input_param_list = '(' _ first:keyword_param _ rest:(',' _ keyword_param _)* ')' {
    return [first].concat(take(rest, 2));
}
keyword_param = '_' { return KeywordParam.Null; } /
    val:literal { return KeywordParam.Constant(val); } /
    name:ident { return KeywordParam.Binder(name); }

output_param_list = '(' _ first:expression _ rest:(',' _ expression _)* ')' {
    return [first].concat(take(rest, 2));
}

keyword = name:ident feed_spec {
    return Keyword(name, true);
} / name:ident {
    return Keyword(name, false);
}
ownership = '[' _ owner:ident _ ']' { return owner; }

trigger_spec = selector:device_selector _ name:('.' _ ident)? {
    return [selector, name !== null ? name[2] : 'source'];
}
action_spec = selector:device_selector _ name:('.' _ ident)? {
    return [selector, name !== null ? name[2] : 'sink'];
}
builtin_spec = '@$' name:ident {
    return [Selector.Builtin(name), null];
}
device_selector = '@' name:ident { return Selector.GlobalName(name); } /
    '@(' _ values:attribute_list _ ')' { return Selector.Attributes(values); } /
attribute_list = first:attribute _ rest:(',' _ attribute _)* {
    return [first].concat(take(rest, 2));
}
attribute = name:ident _ '=' _ value:literal {
    return Attribute(name, value);
}

// expression language

expression =
    lhs:and_expression _ '||' _ rhs:expression { return Expression.BinaryOp(lhs, rhs, '||'); } /
    and_expression
and_expression =
    lhs:comp_expression _ '&&' _ rhs:and_expression { return Expression.BinaryOp(lhs, rhs, '&&'); } /
    comp_expression
comp_expression =
    lhs:add_expression _ comp:comparator _ rhs:comp_expression { return Expression.BinaryOp(lhs, rhs, comp); } /
    add_expression
add_expression =
    lhs:mult_expression _ '+' _ rhs:expression { return Expression.BinaryOp(lhs, rhs, '+'); } /
    lhs:mult_expression _ '-' _ rhs:expression { return Expression.BinaryOp(lhs, rhs, '-'); } /
    mult_expression
mult_expression =
    lhs:unary_expression _ '*' _ rhs:mult_expression { return Expression.BinaryOp(lhs, rhs, '*'); } /
    lhs:unary_expression _ '/' _ rhs:mult_expression { return Expression.BinaryOp(lhs, rhs, '/'); } /
    unary_expression
unary_expression =
    '!' _ arg:member_expression { return Expression.UnaryOp(arg, '!'); } /
    '-' _ arg:member_expression { return Expression.UnaryOp(arg, '-'); } /
    member_expression
member_expression =
    lhs:primary_expression '.' name:ident { return Expression.MemberRef(lhs, name); } /
    primary_expression
primary_expression = literal_expression / function_call /
    name:ident feed_spec { return Expression.FeedKeywordRef(name); } /
    name:ident { return Expression.VarRef(name); } /
    '(' _ subexp:expression _ ')' { return subexp; }
function_call = '$' name:ident '(' _ args:expr_param_list? _ ')' {
    return Expression.FunctionCall(name, args === null ? [] : args);
}
expr_param_list = first:expression _ rest:(',' _ expression _)* {
    return [first].concat(take(rest, 2))
}
literal_expression = val:literal {
    return Expression.Constant(val);
}
literal "literal" = val:literal_bool { return Value.Boolean(val); } /
    val:literal_string { return Value.String(val); } /
    val:literal_number '%' { return Value.Number(val / 100); } /
    val:literal_number unit:ident { return Value.Measure(val, unit); } /
    val:literal_number { return Value.Number(val); }
type_ref = $('Measure(' ident? ')') / $('Array(' type_ref ')') / ident

// tokens

comparator "comparator" = '>=' / '<=' / '>' / '<' / '=~' / 'has~' / 'has' / '=' / ':' / '!='

literal_bool = true_bool { return true; } / false_bool { return false; }
true_bool = 'on' / 'true'
false_bool = 'off' / 'false'

feed_spec = '-F'

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
identchar = [A-Za-z0-9_]
ident "ident" = $(identstart identchar*)

cssidentstart = [A-Za-z]
cssidentchar = [A-Za-z\-0-9_]
cssident "cssident" = $(cssidentstart cssidentchar*)

_ = (whitespace / comment)*
__ = whitespace _
whitespace "whitespace" = [ \r\n\t\v]
comment "comment" = '/*' ([^*] / '*'[^/])* '*/' / '//' [^\n]* '\n'
