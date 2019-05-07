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

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { slotFillCustom, slotFillProgram, addDisplayToContact } = require('./slot_filling');

async function checkPermissionRule(dlg, principal, program, permissionRule) {
    dlg.reply(dlg._("Ok, I'll remember that."));
    const description = Describe.describePermissionRule(dlg.manager.gettext, permissionRule);
    await dlg.manager.permissions.addPermission(permissionRule, description);
    return await dlg.manager.permissions.checkIsAllowed(principal, program);
}

async function addFilter(dlg, rule) {
    //let firstTime = true;
    for (;;) {
        let prim;
        let filterCandidates = [];
        if (rule.query.isSpecified) {
            prim = rule.query;
            filterCandidates.push(...Helpers.makeFilterCandidates(rule.query));
        }
        if (rule.action.isSpecified) {
            prim = rule.action;
            filterCandidates.push(...Helpers.makeFilterCandidates(rule.action));
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
            choice = await dlg.askChoices(dlg._("Pick the part you want to add restrictions to:"), filterCommandChoices);
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
        dlg.reply(dlg._("Choose the filter you want to add:"));

        Helpers.presentFilterCandidates(dlg, prim.schema, filterCandidates);

        // show the location weather and time
        dlg.replyButton('the time is before $time', {
            code: ['bookkeeping', 'filter', '@org.thingpedia.builtin.thingengine.builtin.get_time', '{', 'param:time:Time', '<=', 'SLOT_0', '}'],
            entities: {},
            slots: ['time'],
            slotTypes: {
                ['time']: 'Time'
            }
        });
        dlg.replyButton('the time is after $time', {
            code: ['bookkeeping', 'filter', '@org.thingpedia.builtin.thingengine.builtin.get_time', '{', 'param:time:Time', '>=', 'SLOT_0', '}'],
            entities: {},
            slots: ['time'],
            slotTypes: {
                ['time']: 'Time'
            }
        });
        dlg.replyButton('my location is $location', {
            code: ['bookkeeping', 'filter', '@org.thingpedia.builtin.thingengine.phone.get_gps', '{', 'param:location:Location', '==', 'SLOT_0', '}'],
            entities: {},
            slots: ['location'],
            slotTypes: {
                ['location']: 'Location'
            }
        });
        dlg.replyButton('my location is not $location', {
            code: ['bookkeeping', 'filter', '@org.thingpedia.builtin.thingengine.phone.get_gps', '{', 'not', 'param:location:Location', '==', 'SLOT_0', '}'],
            entities: {},
            slots: ['location'],
            slotTypes: {
                ['location']: 'Location'
            }
        });
        dlg.replySpecial(dlg._("Back"), 'back');

        let filterIntent = await dlg.expect(ValueCategory.PermissionResponse);
        if (filterIntent.isBack)
            return null;
        if (filterIntent.isPermissionRule)
            return filterIntent.rule;

        let predicate = filterIntent.predicate;
        await predicate.typecheck(prim.schema, null, dlg.manager.schemas, {}, true);
        for (let [schema,expr,] of predicate.iterateSlots(prim.schema, null, null)) {
            if (expr instanceof Ast.Selector)
                continue;
            let argname = expr.name;
            if (expr.value.isUndefined) {
                let ptype = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];

                let question = dlg._("What's the value of this filter?");
                let vtype = ptype;
                if (expr.operator === 'contains')
                    vtype = ptype.elem;
                expr.value = await slotFillCustom(dlg, vtype, question);
            }
        }

        prim.filter = Ast.BooleanExpression.And([prim.filter, predicate]).optimize();
        //firstTime = false;
        return rule;
    }
}

module.exports = async function permissionGrant(dlg, program, principal, identity) {
    // if we get here, there must be a permission manager that requires an interactive grant
    assert(dlg.manager.permissions !== null);

    const sourceContact = Ast.Value.Entity(identity, 'tt:contact', null);
    await addDisplayToContact(dlg, sourceContact);
    let contactName = sourceContact.display;
    if (!contactName)
        contactName = identity.split(':')[1];

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
    const icon = Helpers.getProgramIcon(program);
    dlg.icon = icon;

    let permissionRule = null, anybodyPermissionRule = null, emptyPermissionRule = null;
    let hasParam = false;
    try {
        permissionRule = program.convertToPermissionRule(principal, contactName);
        if (permissionRule) {
            anybodyPermissionRule = permissionRule.clone();
            anybodyPermissionRule.principal = Ast.BooleanExpression.True;
            if (anybodyPermissionRule.query.isSpecified)
                anybodyPermissionRule.query.filter = Ast.BooleanExpression.True;
            if (anybodyPermissionRule.action.isSpecified)
                anybodyPermissionRule.action.filter = Ast.BooleanExpression.True;
            emptyPermissionRule = permissionRule.clone();
            if (emptyPermissionRule.query.isSpecified) {
                if (!emptyPermissionRule.query.filter.isTrue)
                    hasParam = true;
                emptyPermissionRule.query.filter = Ast.BooleanExpression.True;
            }
            if (emptyPermissionRule.action.isSpecified) {
                if (!emptyPermissionRule.action.filter.isTrue)
                    hasParam = true;
                emptyPermissionRule.action.filter = Ast.BooleanExpression.True;
            }
        }
    } catch(e) {
        // FIXME this should never happen
        console.log('Failed to convert program to policy:', e.message);
        console.error(e.stack);
    }
    try {
        if (permissionRule) {
            //console.log('Converted into permission rule: ' + permissionRule.prettyprint());

            dlg.reply(dlg._("%s would like to %s.").format(contactName, description));

            for (;;) {
                dlg.icon = icon;
                dlg.replySpecial(dlg._("Yes this time"), 'yes');
                if (hasParam) {
                    dlg.replyButton(dlg._("Always from anybody (no restrictions)"), {
                        program: anybodyPermissionRule.prettyprint(),
                    });
                    dlg.replyButton(dlg._("Always from %s (no restrictions)").format(contactName), {
                        program: emptyPermissionRule.prettyprint(),
                    });
                    dlg.replyButton(dlg._("Always from %s (this exact request)").format(contactName), {
                        program: permissionRule.prettyprint(),
                    });
                } else {
                    dlg.replyButton(dlg._("Always from anybody"), {
                        program: anybodyPermissionRule.prettyprint(),
                    });
                    dlg.replyButton(dlg._("Always from %s").format(contactName), {
                        program: emptyPermissionRule.prettyprint(),
                    });
                }
                dlg.replySpecial(dlg._("No"), 'no');
                dlg.replySpecial(dlg._("Only if…"), 'maybe');

                let answer = await dlg.expect(ValueCategory.PermissionResponse);
                if (answer.isYes)
                    return program;
                if (answer.isPermissionRule) {
                    let ok = await slotFillProgram(dlg, answer.rule);
                    if (!ok)
                        continue;

                    let description = Describe.describePermissionRule(dlg.manager.gettext, answer.rule);
                    ok = await dlg.ask(ValueCategory.YesNo, dlg._("Ok, so %s. Is that correct?")
                        .format(description));
                    if (!ok)
                        continue;
                    return await checkPermissionRule(dlg, principal, program, answer.rule);
                }
                if (answer.isMaybe) {
                    const filteredPermissionRule = emptyPermissionRule.clone();
                    let newRule = await addFilter(dlg, filteredPermissionRule);
                    if (!newRule)
                        continue;
                    let description = Describe.describePermissionRule(dlg.manager.gettext, newRule);
                    let ok = await dlg.ask(ValueCategory.YesNo, dlg._("Ok, so %s. Is that correct?")
                        .format(description));
                    if (!ok)
                        continue;
                    return await checkPermissionRule(dlg, principal, program, newRule);
                }
                return null;
            }
        } else {
            // we can't make a permission rule out of this...

            let ok = await dlg.ask(ValueCategory.YesNo, dlg._("%s wants to %s").format(contactName, description));
            if (ok)
                return program;
            else
                return null;
        }
    } catch(e) {
        if (e.code === 'ECANCELLED')
            return null;
        throw e;
    }
};
