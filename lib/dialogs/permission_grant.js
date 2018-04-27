// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

// HACK
const Utils = require('thingtalk/lib/utils');

const ValueCategory = require('../semantic').ValueCategory;

const { slotFillCustom } = require('./slot_filling');

function getIdentityName(dlg, identity) {
    var split = identity.split(':');

    if (split[0] === 'omlet')
        return dlg._("Omlet User @%s").format(split[1]);

    let contactApi = dlg.manager.platform.getCapability('contacts');
    if (contactApi !== null) {
        return contactApi.lookupPrincipal(identity).then((contact) => {
            if (contact)
                return contact.displayName;
            else
                return split[1];
        });
    } else {
        return split[1];
    }
}

function* checkPermissionRule(dlg, principal, program, permissionRule) {
    let description = Describe.describePermissionRule(dlg.manager.gettext, permissionRule);
    dlg.reply(dlg._("Ok, I'll remember that %s").format(description));

    yield dlg.manager.permissions.addPermission(permissionRule, description);
    return yield dlg.manager.permissions.checkIsAllowed(principal, program);
}

function describeFilter(dlg, _T, schema, filter) {
    let value = ThingTalk.Describe.describeArg(dlg.manager.gettext, filter.value);
    let argname = filter.name;
    let index = schema.index[argname];
    let argcanonical = schema.argcanonicals[index] || argname;

    // translations come from ThingTalk, hence the _T
    // otherwise they will be picked up by xgettext for Almond
    switch (filter.operator) {
    case 'contains':
    case 'substr':
    case '=~':
        return _T("%s contains %s").format(argcanonical, value);
    case 'in_array':
    case '~=':
        return _T("%s contains %s").format(value, argcanonical);
    case '=':
        return _T("%s is equal to %s").format(argcanonical, value);
    case '!=':
        return _T("%s is not equal to %s").format(argcanonical, value);
    case '<':
        return _T("%s is less than %s").format(argcanonical, value);
    case '>':
        return _T("%s is greater than %s").format(argcanonical, value);
    case '<=':
        return _T("%s is less than or equal to %s").format(argcanonical, value);
    case '>=':
        return _T("%s is greater than or equal to %s").format(argcanonical, value);
    default:
        throw new TypeError('Invalid operator ' + filter.operator);
    }
}

function makeFilterCandidates(permissionFunction) {
    if (!permissionFunction.isSpecified)
        return [];

    let schema = permissionFunction.schema;
    let filterCandidates = [];

    function doMake(from) {
        for (let argname in from) {
            let type = from[argname];
            let ops;
            if (type.isString)
                ops = ['=', '!=', '=~'];
            else if (type.isNumber || type.isMeasure)
                ops = ['=', '<', '>', '>=', '<='];
            else if (type.isArray)
                ops = ['contains'];
            else if (type.isBoolean)
                ops = ['='];
            else if (type.isEntity && (type.type === 'tt:url' || type.type === 'tt:picture'))
                continue;
            else if (type.isDate)
                continue;
            else
                ops = ['=', '!='];
            for (let op of ops)
                filterCandidates.push(new Ast.BooleanExpression.Atom(argname, op, Ast.Value.Undefined(true)));
        }
    }
    doMake(schema.inReq);
    doMake(schema.out);
    return filterCandidates;
}

function* addFilter(dlg, rule) {
    // reuse thingtalk's translations here
    const _T = dlg.manager.gettext.dgettext.bind(dlg.manager.gettext, 'thingtalk');

    //let firstTime = true;
    while (true) {
        let prim;
        let filterCandidates = [];
        if (rule.trigger.isSpecified) {
            prim = rule.trigger;
            filterCandidates.push(...makeFilterCandidates(rule.trigger));
        } else if (rule.query.isSpecified) {
            prim = rule.query;
            filterCandidates.push(...makeFilterCandidates(rule.query));
        } else { //if (rule.action.isSpecified) {
            prim = rule.action;
            filterCandidates.push(...makeFilterCandidates(rule.action));
        }
        /*
        let filterCandidates = {
            trigger: makeFilterCandidates(rule.trigger),
            query: makeFilterCandidates(rule.query),
            action: makeFilterCandidates(rule.action)
        };
        let scope = {};
        let filterDescription = [
            rule.trigger.isSpecified ? Describe.describePermissionFunction(dlg.manager.gettext, rule.trigger, 'trigger', scope) : '',
            rule.query.isSpecified ? Describe.describePermissionFunction(dlg.manager.gettext, rule.query, 'query', scope) : '',
            rule.action.isSpecified ? Describe.describePermissionFunction(dlg.manager.gettext, rule.action, 'action', scope) : ''
        ];

        let primTypes = [];
        let filterCommandChoices = [];
        if (filterCandidates.trigger.length > 0) {
            primTypes.push('trigger');
            filterCommandChoices.push(dlg._("When: %s").format(filterDescription[0]));
        }
        if (filterCandidates.query.length > 0) {
            primTypes.push('query');
            filterCommandChoices.push(dlg._("Get: %s").format(filterDescription[1]));
        }
        if (filterCandidates.action.length > 0) {
            primTypes.push('action');
            filterCommandChoices.push(dlg._("Do: %s").format(filterDescription[2]));
        }
        filterCommandChoices.push(dlg._("Done"));
        filterCommandChoices.push(dlg._("Back"));

        let prim;
        let choice;
        if (!firstTime || primTypes.length > 1) {
            choice = yield dlg.askChoices(dlg._("Pick the part you want to add restrictions to:"), filterCommandChoices);
            if (choice === filterCommandChoices.length - 2) {
                // done!
                return rule;
            }
            if (choice === filterCommandChoices.length - 1) {
                // go back to the top
                return null;
            }
            prim = rule[primTypes[choice]];
        } else {
            prim = rule[primTypes[0]];
            choice = 0;
        }
        let prim = rule[primTypes[choice]];
        */
        dlg.reply(dlg._("Pick the filter you want to add:"));

        const schema = prim.schema;
        filterCandidates.forEach((filter) => {
            let argname = filter.name;
            let ptype = schema.inReq[argname] || schema.out[argname];
            let vtype = ptype;
            if (filter.operator === 'contains')
                vtype = ptype.elem;

            let op;
            if (filter.operator === '=')
                op = 'is';
            else if (filter.operator === '=~')
                op = 'contains';
            else if (filter.operator === 'contains')
                op = 'has';
            else
                op = filter.operator;

            let obj = {
                filter: {
                    name: argname,
                    operator: op,
                    value: null,
                    type: vtype.isMeasure ? 'Measure' : String(vtype)
                }
            };
            if (vtype.isMeasure)
                obj.filter.unit = vtype.unit;
            dlg.replyButton(describeFilter(dlg, _T, schema, filter), JSON.stringify(obj));
        });

        // show the location weather and time
        dlg.replyButton('the time is before $__time', {
            code: ['bookkeeping', 'filter', 'param:__time:Time', '<=', 'SLOT_0'],
            entities: {},
            slots: ['__time'],
            slotTypes: {
                ['__time']: 'Time'
            }
        });
        dlg.replyButton('the time is after $__time', {
            code: ['bookkeeping', 'filter', 'param:__time:Time', '>=', 'SLOT_0'],
            entities: {},
            slots: ['__time'],
            slotTypes: {
                ['__time']: 'Time'
            }
        });
        dlg.replyButton('my location is $__location', {
            code: ['bookkeeping', 'filter', 'param:__location:Location', '==', 'SLOT_0'],
            entities: {},
            slots: ['__location'],
            slotTypes: {
                ['__location']: 'Location'
            }
        });
        dlg.replyButton('my location is not ____', {
            code: ['bookkeeping', 'filter', 'not', 'param:__location:Location', '==', 'SLOT_0'],
            entities: {},
            slots: ['__location'],
            slotTypes: {
                ['__location']: 'Location'
            }
        });
        dlg.replyButton(dlg._("Back"), JSON.stringify({ special: 'back' }));

        let filterIntent = yield dlg.expect(ValueCategory.PermissionResponse);
        if (filterIntent.isBack)
            return null;
        if (filterIntent.isPermissionRule)
            return filterIntent.rule;

        let predicate = filterIntent.predicate;
        for (let [,expr,] of ThingTalk.Generate.iterateSlotsFilter(null, predicate, null, null)) {
            let argname = expr.name;
            if (argname === '__location') {
                if (expr.value.isUndefined) {
                    let question = dlg._("What's the value of this filter?");
                    expr.value = yield* slotFillCustom(dlg, Type.Location, question);
                }

                let schema = yield Utils.getSchemaForSelector(dlg.manager.schemas, 'org.thingpedia.builtin.thingengine.phone', 'get_gps', 'queries', true);
                let inner = new Ast.BooleanExpression.Atom('location', expr.operator, expr.value);
                predicate = new Ast.BooleanExpression.External(Ast.Selector.Device('org.thingpedia.builtin.thingengine.phone', null, null), 'get_gps', [], inner, schema);
            } else if (argname === '__time') {
                if (expr.value.isUndefined) {
                    let question = dlg._("What's the value of this filter?");
                    expr.value = yield* slotFillCustom(dlg, Type.Time, question);
                }

                let schema = yield Utils.getSchemaForSelector(dlg.manager.schemas, 'org.thingpedia.builtin.thingengine.builtin', 'get_time', 'queries', true);
                let inner = new Ast.BooleanExpression.Atom('time', expr.operator, expr.value);
                predicate = new Ast.BooleanExpression.External(Ast.Selector.Device('org.thingpedia.builtin.thingengine.builtin', null, null), 'get_time', [], inner, schema);
            } else if (expr.value.isUndefined) {
                let ptype = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];

                let question = dlg._("What's the value of this filter?");
                let vtype = ptype;
                if (expr.operator === 'contains')
                    vtype = ptype.elem;
                expr.value = yield* slotFillCustom(dlg, vtype, question);
            }
        }

        prim.filter = Generate.optimizeFilter(Ast.BooleanExpression.And([prim.filter, predicate]));
        //firstTime = false;
        return rule;
    }
}

module.exports = function* permissionGrant(dlg, program, principal, identity) {
    let contactName = yield getIdentityName(dlg, identity);
    // replace display of principal ("me") to the correct contact name based on identity
    program.rules.forEach((rule) => {
        rule.actions.forEach((action) => {
            if (action.channel === 'send' && action.schema.args.indexOf('__principal') > -1) {
                let index = action.schema.index['__principal'];
                action.in_params[index].value.display = contactName;
            }

        });
    });
    let description = Describe.describeProgram(dlg.manager.gettext, program);
    let primitiveList = [];
    program.rules.forEach((r) => {
        if (r.trigger)
            primitiveList.push(r.trigger);
        primitiveList = primitiveList.concat(r.queries);
        primitiveList = primitiveList.concat(r.actions.filter((a) => !a.selector.isBuiltin));
    });

    function computeIcon() {
        for (let i = primitiveList.length-1; i >= 0; i--) {
            let prim = primitiveList[i];
            if (prim.selector.isBuiltin)
                continue;
            if (prim.selector.kind !== 'remote' && !prim.selector.kind.startsWith('__dyn') &&
                prim.selector.kind.indexOf('.') >= 0)
                return prim.selector.kind;
        }
        return null;
    }
    dlg.icon = computeIcon();

    let permissionRule = null, anybodyPermissionRule = null, emptyPermissionRule = null;
    try {
        permissionRule = Generate.convertToPermissionRule(principal, contactName, program);
        if (permissionRule) {
            anybodyPermissionRule = permissionRule.clone();
            anybodyPermissionRule.principal = Ast.BooleanExpression.True;
            emptyPermissionRule = permissionRule.clone();
            if (emptyPermissionRule.query.isSpecified)
                emptyPermissionRule.query.filter = Ast.BooleanExpression.True;
            if (emptyPermissionRule.action.isSpecified)
                emptyPermissionRule.action.filter = Ast.BooleanExpression.True;
        }
    } catch(e) {
        // FIXME this should never happen
        console.log('Failed to convert program to policy:', e.message);
    }
    try {
        if (permissionRule) {
            console.log('Converted into permission rule: ' + Ast.prettyprintPermissionRule(permissionRule));

            dlg.reply(dlg._("%s wants to %s").format(contactName, description));

            while (true) {
                dlg.replySpecial(dlg._("Yes this time"), 'yes');
                dlg.replyButton(dlg._("Always from anybody"), {
                    code: ThingTalk.NNSyntax.toNN(anybodyPermissionRule, {}),
                    entities: {}
                });
                dlg.replyButton(dlg._("Always from %s").format(contactName), {
                    code: ThingTalk.NNSyntax.toNN(anybodyPermissionRule, {}),
                    entities: {}
                });
                dlg.replyButton(dlg._("No"), 'no');
                dlg.replyButton(dlg._("Add constraints"), 'maybe');

                let answer = yield dlg.expect(ValueCategory.PermissionResponse);
                if (answer.isYes)
                    return program;
                if (answer.isPermissionRule)
                    return yield* checkPermissionRule(dlg, principal, program, answer.rule);
                if (answer.isMaybe) {
                    let newRule = yield* addFilter(dlg, emptyPermissionRule);
                    if (!newRule)
                        continue;
                    return yield* checkPermissionRule(dlg, principal, program, newRule);
                }
                return null;
            }
        } else {
            // we can't make a permission rule out of this...

            return yield dlg.ask(ValueCategory.YesNo, dlg._("%s wants to %s").format(contactName, description));
        }
    } catch(e) {
        if (e.code === 'ECANCELLED')
            return null;
        throw e;
    }
};
