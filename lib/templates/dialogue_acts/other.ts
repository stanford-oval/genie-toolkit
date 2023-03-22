import { Ast, } from 'thingtalk';

import {
    ContextInfo,
    addNewItem,
} from '../state_manip';


export function showOtherRequests(ctx : ContextInfo) : Ast.DialogueState|null {
    if (!ctx.current)
        return null;
    
    const res = ctx.current.clone();
    res.levenshtein!.expression.other = true;

    return addNewItem(ctx, 'execute', null, 'accepted', res);
}