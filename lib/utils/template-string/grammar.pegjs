// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie.
//
// Copyright 2019-2021 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

{
    const Ast = require('./index');

    function take(array, idx) {
        return array.map(function(v) { return v[idx]; });
    }
}

top_level_template = tpl:template {
    // bubble all the select[flag] operations up to the top, so all flag constraints
    // are applied consistently across all uses of a placeholder

    const map = new Map;
    tpl.visit((node) => {
        if (node instanceof Ast.FlagSelect) {
            const key = node.param + '+' + node.flag;
            const existing = map.get(key);
            if (existing) {
                for (const variant of Object.keys(node.variants))
                    existing.add(variant);
            } else {
                map.set(key, new Set(Object.keys(node.variants)));
            }
        }

        // recurse into children
        return true;
    });

    for (const [key, values] of map) {
        const [param, flag] = key.split('+');

        // all variants have the same value, but will impose different flag constraints on their children
        // when the placeholders are replaced
        const variants = {};
        for (const v of values)
            variants[v] = tpl;
        tpl = new Ast.FlagSelect(param, flag, variants);
    }

    return tpl;
}

template = __ first:template_element __ rest:(template_element __)* __ flags:('[' __ ref_flag_list __ ']')? {
    if (rest.length === 0 && !flags)
        return first;

    let constFlags = {}, refFlags = {};
    if (flags)
        [constFlags, refFlags] = flags[2];
    return new Ast.Concatenation([first].concat(take(rest, 0)), constFlags, refFlags);
} / __ {
    // empty template (empty string)
    return new Ast.Phrase('');
}

template_element = choice / plural_clause / select_key_clause / select_flag_clause / placeholder / phrase

choice = '{' first:template __ rest:('|' __ template __)* '}' {
    if (rest.length === 0)
        return first;
    return new Ast.Choice([first].concat(take(rest, 2)));
}

plural_clause = '${' __ param:qualified_name __ ':' __ keyword:('plural' / 'ordinal') __ ':' variants:plural_variant+ '}' {
    const variantmap = {};
    for (let [type, expansion] of variants) {
        if (type in variantmap) {
            error(`Duplicate plural variant ${type}`);
            return;
        }
        variantmap[type] = expansion;
    }
    return new Ast.Plural(param[0], param.slice(1), keyword === 'plural' ? 'cardinal' : keyword, variantmap);
}

plural_variant = __ type:plural_type __ expansion:choice __ {
    return [type, expansion];
}

plural_type = '=' n:integer_literal { return n; }
    / 'zero' / 'one' / 'two' / 'few' / 'many' / 'other'

select_key_clause = '${' __ param:qualified_name __ ':' __ 'select' __ ':' variants:select_variant+
'}' {
    const variantmap = {};
    for (let [type, expansion] of variants) {
        if (type in variantmap) {
            error(`Duplicate select variant ${type}`);
            return;
        }
        variantmap[type] = expansion;
    }
    return new Ast.ValueSelect(param[0], param.slice(1), variantmap);
}

select_flag_clause = '${' __ param:identifier __ '[' __ flag:identifier __ ']' __ ':' __ 'select' __ ':' variants:select_variant+
'}' {
    const variantmap = {};
    for (let [type, expansion] of variants) {
        if (type in variantmap) {
            error(`Duplicate select variant ${type}`);
            return;
        }
        variantmap[type] = expansion;
    }
    return new Ast.FlagSelect(param, flag, variantmap);
}

select_variant = __ type:(identifier / '=' n:integer_literal { return n; }) __ expansion:choice __ {
    return [type, expansion];
}

placeholder = raw_placeholder / wrapped_placeholder

raw_placeholder = '$' ident:identifier {
    return new Ast.Placeholder(ident);
}

wrapped_placeholder = '${' __ param:identifier __ flag:('[' __ flag_spec __ ']')? __ opt:(':' __ optidentifier __)? '}' {
    // a placeholder with a flag is a syntactic sugar for a select expression that has only one variant
    if (flag) {
        return new Ast.FlagSelect(param, flag[2][0], {
            [flag[2][1]]: new Ast.Placeholder(param, [], opt ? opt[2] : undefined)
        });
    } else {
        return new Ast.Placeholder(param, [], opt ? opt[2] : undefined);
    }
} / '${' __ param:qualified_name opt:(':' __ optidentifier __)? '}' {
    return new Ast.Placeholder(param[0], param.slice(1), opt ? opt[2] : undefined);
}

flag_spec = name:identifier __ '=' __ value:identifier  {
    return [name, value];
}

flag_list  = first:flag_spec __ rest:(',' __ flag_spec __)* {
    const flagmap = {
        [first[0]]: first[1]
    };
    for (let [name, value] of take(rest, 2)) {
        if (name in flagmap) {
            error(`Duplicate flag ${name}`);
            return;
        }
        flagmap[name] = value;
    }
    return flagmap;
}

phrase = first:word __ rest:(word __)* __ flags:('[' __ flag_list __ ']')? {
    return new Ast.Phrase([first].concat(take(rest, 0)).join(' '), flags ? flags[2] : {});
}

ref_flag_spec = ourFlag:identifier __ '=' __ placeholder:(identifier / integer_literal) __ '[' __ theirFlag:identifier __ ']' {
    if (typeof placeholder === 'number' && placeholder < 0)
        error(`Placeholder reference cannot be a negative number`);
    return [ourFlag, placeholder, theirFlag];
}

ref_flag_list  = first:(ref_flag_spec / flag_spec) __ rest:(',' __ (ref_flag_spec / flag_spec) __)* {
    const constflagmap = {};
    const refflagmap = {};
    if (first.length === 2)
        constflagmap[first[0]] = first[1];
    else
        refflagmap[first[0]] = [first[1], first[2]];
    for (let [ourFlag, ...value] of take(rest, 2)) {
        if (ourFlag in constflagmap || ourFlag in refflagmap) {
            error(`Duplicate flag ${ourFlag}`);
            return;
        }
        if (value.length === 1)
            constflagmap[ourFlag] = value[0];
        else
            refflagmap[ourFlag] = value;
    }
    return [constflagmap, refflagmap];
}

word "word" = pieces:wordpiece+ {
    return pieces.join('');
}

wordpiece = [^${}|[\]\\ \r\n\t\v] / '\\' ch:. {
    return ch;
}

//

qualified_name = first:identifier __ rest:('.' __ identifier __)* {
    return [first, ...take(rest, 2)];
}

identifier "identifier" = $(identstart identchar*)

// same as identifier, but allows - as well
optidentifier "identifier" = $(identstart optidentchar*)

identstart = [A-Za-z_]
identchar = [A-Za-z0-9_]
optidentchar = [A-Za-z-]

integer_literal "integer" = neg:'-'? v:$([0-9]) {
    return (neg ? -1 : 1) * parseInt(v, 10);
}

__ "whitespace" = [ \r\n\t\v]*
