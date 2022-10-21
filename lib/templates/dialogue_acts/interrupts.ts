import { Ast, } from 'thingtalk';

import * as C from '../ast_manip';
import {
    ContextInfo,
    addQuery,
} from '../state_manip';
// import { areQuestionsValidForContext } from './coref-questions';
import {
    queryRefinement,
    refineFilterToAnswerQuestion,
} from './refinement-helpers';


function projectionDuringSlotFill(ctx : ContextInfo, questions : C.ParamSlot[]) {
    // 1. function from last-turn must be different from this turn
    const lastTurnExp = ctx.state.history[ctx.state.history.length - 1].stmt.expression;
    const lastTurnSchema = lastTurnExp.schema!;
    // const lastTurnSchema = ctx.currentFunction!;
    const thisTurnSchema = ctx.currentFunction;
    if (!thisTurnSchema)
        return null;
    // console.log(`lastTurnExp : ${lastTurnExp.prettyprint()}`);
    // console.log(`thisTurnSchema : ${thisTurnSchema.prettyprint()}`);
    // console.log(ctx);

    // if the function only contains one parameter, do not generate projection for it
    if (C.countInputOutputParams(thisTurnSchema).output === 1)
        return null;

    for (const q of questions) {
        if (!C.isSameFunction(thisTurnSchema, q.schema))
            return null;
        const arg = thisTurnSchema.getArgument(q.name);
        if (!arg || arg.is_input)
            return null;
    }

    if (C.isSameFunction(lastTurnSchema, thisTurnSchema)) {
        // console.log("returning null due to last turn and this turn being the same function");
        // console.log(`lastTurnExp : ${lastTurnExp.prettyprint()}`);
        // console.log(`thisTurnSchema : ${thisTurnSchema.prettyprint()}`);
        return null;
    }

    // assume last turn is an expression with an `id` field inside
    if (lastTurnExp.last instanceof Ast.InvocationExpression) {
        const place = lastTurnExp.last.invocation.in_params.map((x) => (x.name)).indexOf('id');
        if (place >= 0) {
            const topResult = lastTurnExp.last.invocation.in_params[place].value;
            const currentStmt = ctx.current!.stmt;
            const currentTable = currentStmt.expression;

            const newFilter = new Ast.BooleanExpression.Atom(null, 'id', '==', topResult);
            const newTable = queryRefinement(currentTable, newFilter, refineFilterToAnswerQuestion,
                questions.map((q) => q.name));
            if (newTable === null)
                return null;
        
            // Levenshtein: one projection and one filter
            const deltaFilterStatement = new Ast.FilterExpression(null, Ast.levenshteinFindSchema(currentStmt.expression), newFilter, currentStmt.expression.schema);
            const deltaProjectionStatement = new Ast.ProjectionExpression(null, deltaFilterStatement, questions.map((q) => q.name), [], [], deltaFilterStatement.schema);
            const delta = (new Ast.Levenshtein(null, deltaProjectionStatement, "$continue")).optimize();
            const applyres = Ast.applyMultipleLevenshtein(currentStmt.expression, [delta]);
            C.levenshteinDebugOutput(applyres, newTable, "recommendationSearchQuestionReply_multiwoz.txt");
            // console.log("projectionDuringSlotFill succeeded");
        
            const res = addQuery(ctx, 'execute', newTable, 'accepted', delta);
            // we remove the old (accepted) action so that it never goes back to the original action
            // to prevent producing two deltas in one turn
            // during run-time, this is gracefully handled by the new dialogue state design
            res.history.pop();
            return res;
        }
    }
    // console.log("returning null due to lastTurn not containing an id field ");
    return null;
}

export {
    projectionDuringSlotFill
};
