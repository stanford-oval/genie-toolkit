
import * as Tp from 'thingpedia';
import assert from 'assert';
import { Ast, Type } from "thingtalk";
import { ReplyResult } from './dialogue-loop';
import ThingTalkDialogueHandler, { handleIncomingDelta } from './handlers/thingtalk';
import { NaturalLanguageUserInput } from './user-input';
import { ThingTalkUtils } from '..';
import { parse, SyntaxType } from 'thingtalk/dist/syntax_api';
import { isOutputType } from '../utils/thingtalk';

type GeniescriptReplyResult = Tp.DialogueHandler.ReplyResult;
type GenieScriptTypeChecker = (reply : ReplyResult) => boolean;

interface GeniescriptAnalysisResult extends Tp.DialogueHandler.CommandAnalysisResult {
    branch : string;
}

interface GeniescriptExecptionHandler {
    layer : number;
    handlers : Map<GenieScriptTypeChecker, GeniescriptLogic<ReplyResult, any>>;
}

export interface GenieQuery {
    type : GenieQueryType;
    content : string | GeniescriptAnalysisResult | Tp.DialogueHandler.CommandAnalysisResult | ReplyResult;
}



class GeniescriptException extends Error {
    public layer : number;

    constructor(layer : number) {
        super();
        this.layer = layer;
    }
}

// TODO: investigate how to put this under AgentDialog
export enum DlgStatus {
    SUCCESS,
    INTRRUPTED,
    QUERY_FAIL
}

enum GenieQueryType {
    ANALYZE_COMMAND = "AnalyzeCommand",
    GET_REPLY = "getReply",
    CALLBACK = "callback",
}

export type GenieResponse = Tp.DialogueHandler.CommandAnalysisResult | Tp.DialogueHandler.ReplyResult | GeniescriptReplyResult | null;

export type GeniescriptState<Output> =
    AsyncGenerator<GenieResponse, Output, GenieQuery>;
export type GeniescriptLogic<Input, Output> =
    ((input : Input) => GeniescriptState<Output>) |
    ((input : Input) => Promise<GeniescriptState<Output>>) |
    ((input : Input) => Output) |
    ((input : Input) => Promise<Output>)

export abstract class GeniescriptAgent implements Tp.DialogueHandler<GeniescriptAnalysisResult, string> {
    private _state : GeniescriptState<any> | null;
    private skill_name : string;
    public dlg : AgentDialog;

    protected constructor(public priority = Tp.DialogueHandler.Priority.PRIMARY, public icon : string | null = null, user_target : string, skill_name : string) {
        console.log("AbstractGeniescriptHandler constructor");
        this._state = null;
        if (this.constructor === GeniescriptAgent)
            throw new Error("Abstract classes can't be instantiated.");
        this.skill_name = skill_name;
        this.dlg = new AgentDialog(user_target, skill_name);
    }

    getState() : string {
        // TODO: Implementation serialization
        return "geniescript state";
    }

    async *__wrapped_logic() : GeniescriptState<any> {
        const self = this;
        const prompt_str : string = self.skill_name + " init";

        while (true) {
            try {
                yield* this.dlg!.expect(new Map([
                    [prompt_str, (async function*() {
                        yield* self.logic();
                    })]
                ]));
            } catch(e) {
                this.dlg.say(["geniescript has an error:" + e]);
            } finally {
                const error_prompt = "Geniescript had an error or exited. Please restart genie.";
                this.dlg.say([error_prompt]);
                yield* this.dlg.expect(new Map([]), null, null, error_prompt);
            }
        }
    }

    reset() : void {
        this._state = this.__wrapped_logic();
        // noinspection JSIgnoredPromiseFromCall
        this._state.next();
    }

    async initialize() {
        this._state = this.__wrapped_logic();
        await this._state.next();
        return null;
    }

    async analyzeCommand(command : string) : Promise<GeniescriptAnalysisResult> {
        const utterance = command;
        console.log("AbstractGeniescriptHandler analyzeCommand");
        const result = await this._state!.next({ type: GenieQueryType.ANALYZE_COMMAND, content: utterance });
        console.log(result.value);
        return result.value;
    }

    async getReply(command : GeniescriptAnalysisResult) : Promise<Tp.DialogueHandler.ReplyResult | GeniescriptReplyResult> {
        const result0 = this._state!.next({ type: GenieQueryType.GET_REPLY, content: command });
        const result = await result0;
        return result.value;
    }

    async getAgentInputFollowUp(return_value : ReplyResult) {
        console.log("AbstractGeniescriptHandler getAgentInputFollowUp");
        const result0 = this._state!.next({ type: GenieQueryType.CALLBACK, content: return_value });
        const result = await result0;
        return result.value;
    }

    // TODO: call this main
    async *logic() : GeniescriptState<any> {
        yield null;
        return null;
    }

    async getFollowUp() : Promise<Tp.DialogueHandler.ReplyResult | null> {
        return null;
    }

    abstract uniqueId : string;
}

export class AgentDialog {
    private readonly _user_target : string;
    private readonly _skill_name : string;
    private _last_result : GeniescriptAnalysisResult | GeniescriptReplyResult | null;
    private _last_result_only_prompt : GeniescriptReplyResult | null;
    private _last_branch : string | null;
    private _last_analyzed : string | null;
    private _last_messages : string[];
    private _last_expecting : Type | null;
    private _last_target : string | null;
    private _last_content : string | null;
    private _excpetion_handlers : GeniescriptExecptionHandler[] = [];
    private _exception_layer  = 0;
    private _break  = false;
    // this design would allow ThingTalk dialogue handler to share information
    // with other dialogue handlers. In particular, we would like it to share with the
    // Geniescript dialogue handler in order for it to access and modify the dialogue state, when necessary.
    public dialogueHandler ?: ThingTalkDialogueHandler;

    constructor(user_target : string, skill_name : string) {
        this._user_target = user_target;
        this._skill_name = skill_name;
        this._last_result = null;
        this._last_result_only_prompt = null;
        this._last_branch = null;
        this._last_analyzed = null;
        this._last_messages = [];
        this._last_expecting = null;
        this._last_target = null;
        this._last_content = null;
    }

    /* Exception handler for geniescript
     * @param policy: code to "try"
     * @param exception_map: what to "catch", and what to do with it
     *
     * Essentially, this is a try-catch block:
     * try {
     *   policy();
     * } catch (exception.key1) {
     *   exception_map[exception.key1](exception);
     *   back = false; // default behavior
     * } catch (exception.key2) {
     *   exception_map[exception.key2](exception);
     *   back = true;
     * }
     *
     * Implementation wise
     */
    async *handler(
        policy : GeniescriptLogic<any, any>,
        exception_map : Map<GenieScriptTypeChecker, GeniescriptLogic<ReplyResult, any>>,
    ) : GeniescriptState<any> {
        const current_exception_layer = this._exception_layer;
        this._exception_layer += 1;
        this._excpetion_handlers.push({ layer: current_exception_layer, handlers : exception_map });
        try {
            yield* policy(null);
        } catch(e) {
            if (e instanceof GeniescriptException) {
                if (e.layer === current_exception_layer)
                    return null;
                else
                    throw e;
            } else {
                throw e;
            }
        }
        return null;
    }

    async *expect(
        action_map : Map<string, GeniescriptLogic<string, any>> = new Map([]),
        obj_predicate : (GenieScriptTypeChecker) | null = null,
        yes_action : GeniescriptLogic<ReplyResult, any> | null = null,
        no_prompt : string | null = null
    ) : GeniescriptState<any> {
        const self = this;

        if (yes_action === null)
            yes_action = (reply) => reply;


        if (this._last_analyzed !== null) {
            this._last_result = {
                messages: this._last_messages,
                expecting: this._last_expecting,
                context: this._last_analyzed,
                agent_target: this._last_target!
            };

            this._last_messages = [];
            this._last_expecting = null;
            this._last_target = null;
            this._last_analyzed = null;
        } else {
            this._last_result = {
                messages: this._last_messages,
                expecting: null,
                context: "",
                agent_target: ""
            };
        }

        while (true) {
            const input = yield this._last_result;
            if (input.type === GenieQueryType.ANALYZE_COMMAND) {
                const content = input.content as string;
                this._last_result = {
                    confident: Tp.DialogueHandler.Confidence.OUT_OF_DOMAIN_COMMAND,
                    utterance: content,
                    user_target: '',
                    branch: ''
                };
                for (let func_key of action_map.keys()) {
                    if (func_key.constructor.name === "String") {
                        func_key = func_key as string;
                        const regExp = new RegExp(func_key, 'i');
                        const match = regExp.exec(content);
                        if (match) {
                            this._last_branch = func_key;
                            this._last_content = content;
                            this._last_result = {
                                confident: Tp.DialogueHandler.Confidence.EXACT_IN_DOMAIN_COMMAND,
                                utterance: content,
                                user_target: this._user_target,
                                branch: func_key
                            };
                            break;
                        }
                    }
                }
            } else if (input.type === GenieQueryType.GET_REPLY) {
                const content = input.content as GeniescriptAnalysisResult;
                this._last_analyzed = content.user_target;
                const current_func = action_map.get(this._last_branch!)!;
                if (current_func.constructor.name === "GeneratorFunction" || current_func.constructor.name === "AsyncGeneratorFunction")
                    return yield* current_func(this._last_content as string);
                else if (current_func.constructor.name === "AsyncFunction" || current_func.constructor.name === "Function" )
                    return current_func(this._last_content as string);
                else
                    throw Error("current_func is not a Function or GeneratorFunction");
            } else if (input.type === GenieQueryType.CALLBACK) {
                this._last_messages = [];
                self._last_analyzed = "prompt";
                const reply = input.content as ReplyResult;
                if (obj_predicate !== null && obj_predicate(reply)) {
                    if (yes_action.constructor.name === "GeneratorFunction")
                        return yield* yes_action(reply);
                    else if (yes_action.constructor.name === "AsyncGeneratorFunction")
                        return (yield* yes_action(reply));
                    else if (yes_action.constructor.name === "AsyncFunction")
                        return yes_action(reply);
                    else if (yes_action.constructor.name === "Function")
                        return yes_action(reply);
                    else
                        throw Error("current_func is not a Function or GeneratorFunction");
                } else {
                    for (let i = 0; i < this._excpetion_handlers.length; i++) {
                        self._break = true;
                        const handler = this._excpetion_handlers[i];
                        for (const key of handler.handlers.keys()) {
                            if (key(reply)) {
                                const current_func = handler.handlers.get(key)!;
                                if (current_func.constructor.name === "GeneratorFunction" || current_func.constructor.name === "AsyncGeneratorFunction") {
                                    yield* current_func(reply);
                                    if (self._break)
                                        throw new GeniescriptException(handler.layer);
                                } else if (current_func.constructor.name === "AsyncFunction" || current_func.constructor.name === "Function" ) {
                                    current_func(reply);
                                    if (self._break)
                                        throw new GeniescriptException(handler.layer);
                                } else {
                                    throw Error("current_func is not a Function or GeneratorFunction");
                                }
                            }
                        }
                    }
                    if (no_prompt !== null)
                        self.say([no_prompt]);
                }
                this._last_result = {
                    messages: this._last_messages,
                    expecting: null,
                    context: "",
                    agent_target: ""
                };
            }
        }
    }

    // TODO: say something in the middle of the process
    say(messages : string[], target : string | null = null , expecting : Type | null = null) {
        if (target === null) target = this._skill_name + ".reply";
        this._last_messages = this._last_messages.concat(messages);
        this._last_target = target;
        this._last_expecting = expecting;
    }

    async *execute(program : string, type_check : (GenieScriptTypeChecker) | null = null) : GeniescriptState<any> {
        if (this._last_analyzed !== null) {
            this._last_result = {
                messages: this._last_messages,
                expecting: this._last_expecting,
                context: this._last_analyzed,
                agent_target: this._last_target!,
                program: program
            } as GeniescriptReplyResult;
            this._last_result_only_prompt = this._last_result;

            this._last_messages = [];
            this._last_expecting = null;
            this._last_target = null;
            this._last_analyzed = null;
        }
        while (true) {
            const input = yield this._last_result;
            if (input.type === GenieQueryType.ANALYZE_COMMAND) {
                const content = input.content as string;
                this._last_result = {
                    confident: Tp.DialogueHandler.Confidence.OUT_OF_DOMAIN_COMMAND,
                    utterance: content,
                    user_target: '',
                    branch: ''
                };
            } else if (input.type === GenieQueryType.GET_REPLY) {
                throw Error("Cannot get reply in a execute!");
            } else if (input.type === GenieQueryType.CALLBACK) {
                if (type_check && !type_check(input.content as ReplyResult))
                    yield this._last_result_only_prompt;
                else
                    return input.content;

            }
        }

    }

    /**
     * Propose a query or action to user, and if accepted, return the query result to user.
     * 
     * The DlgStatus result can be either:
     * (1) SUCCESS, which is when the final returned result to user matches @param expectedType,
     *     regardless of whether the original query is accepted as is
     *     e.g. if an agent proposes "would you like to search for French restaurants?" and sets expected to be
     *     ['com.yelp', 'restaurant'], if user actually issued query about Japense restaurants, SUCCESS is still returned
     * (2) QUERY_FAIL, which is when user accepted the query as is, but the above conditions do not match
     * (3) INTERRUPTED, which is neither of the above conditions.
     *     the user could have executed a refined query, a different query, or just abandoned this proposal,
     *     and the returned result does not match @param expectedType
     *      * 
     * @remark in case where the DlgStatus is QUERY_FAIL and INTERRUPTED, it is recommended to 
     *         inspect the dialogue state and reply result to understand
     *         what happened after this query was proposed
     * 
     * @param {string} queryString either the ThingTalk of the query to be executed, or the natural langauge expressing it
     *                             if using explicit ThingTalk, the string must begin with `\\t` and followed by a space
     *                             if using natural language, this function will consult the contextual semantic parser
     *                             for the formal representation
     * @param {string} agentUtterance
     *                             what the agent says in natural language to user when proposing this query
     * @param {string} expectedType
     *                             expected result returned. This plays a role in the returned status
     *                             If set to both null, the all results are accepted as SUCCESS, as long as there are some results
     * @param {boolean} waitForAck  whether to intercept the query result as soon as the query is executed
     *                              if true, this function will return immediately if the user's query is executed
     *                                                         
     *                                                      
     *                                              
     * @returns {{DlgStatus, Ast.DialogueState, ReplyResult}} status returned, dialogue state at this point, and concrete results
     * 
     */
    async *propose(queryString : string,
                   agentUtterance : string,
                   expectedType : string,
                   waitForAck = true) {

        let queryExpressionStatement;

        if (queryString.startsWith("\\t ")) {
            // extract query from user-inputed ThingTalk command
            queryString = queryString.substring(3);
            const queryProgram = parse(queryString, SyntaxType.Normal, { timezone: undefined }) as Ast.Program;
            queryExpressionStatement = queryProgram.statements[0];
            if (!(queryExpressionStatement instanceof Ast.ExpressionStatement)) {
                throw Error(`initiateQuery: developer-supplied queryString is not of type ExpressionStatement: ${queryString} \n
                            parsed result: ${queryProgram} \n
                            This suggests that the ThingTalk input is not correct. Consider changing it.`);
            }
        } else {
            // consult the contextual semantic parser for the developer-inputted user utterances
            const sendToNLU : NaturalLanguageUserInput = { type : 'command', utterance : queryString, platformData : {} };
            const analyzed = await this.dialogueHandler!._parseCommand(sendToNLU);
            assert(analyzed.parsed instanceof Ast.DialogueState);
            assert(analyzed.parsed.history.length === 1);
            
            handleIncomingDelta(this.dialogueHandler!._dialogueState, analyzed.parsed);
            queryExpressionStatement = analyzed.parsed.history[0].stmt;
        }
        
        // construct the new dialogue state and update in dialogue loop
        const newHistoryItem = new Ast.DialogueHistoryItem(null, queryExpressionStatement, null, "proposed", null);
        const newState = this.dialogueHandler!._dialogueState!.clone();
        newState.history.push(newHistoryItem);
        this.dialogueHandler!._dialogueState = newState;

        // the agent target and expecting is wrapped in here
        // because this is the first and only time for agent utterance
        // these information will be returned to the dialogue loop by expect
        this.say([agentUtterance], 'sys_recommend_one', Type.Boolean);
        
        let result : ReplyResult;
        if (!waitForAck) {
            // if not waiting for ack, always intercept result as soon as receieved
            result = yield *this.expect(
                new Map([]),
                (reply) => true,
                (result) => result,
                null
            );
        } else {
            // if waiting for ack, everytime it comes back, we check if dialogue state has userIsDone equal to true
            let last_result_before_ack = yield *this.expect(
                new Map([]),
                (reply) => true,
                (result) => result,
                null
            );
            let new_result;
            while (!this.dialogueHandler!._dialogueState.userIsDone) {
                new_result = last_result_before_ack;
                console.log("initiateQuery: waitForAck set, user is still not done, hand back to ThingTalk handler");
                last_result_before_ack = yield *this.expect(
                    new Map([]),
                    (reply) => true,
                    (result) => result,
                    null,
                );
            }
            result = new_result;
        }

        // check results and return
        const newDialogueState = this.dialogueHandler!._dialogueState;
        if (result.result_type && result.result_type === expectedType) {
            return {
                status : DlgStatus.SUCCESS,
                dialogueState : newDialogueState,
                results : result.result_values
            };
        } else if (determineQuerySuccess(newDialogueState, queryExpressionStatement)) {
            return {
                status : DlgStatus.QUERY_FAIL,
                dialogueState : newDialogueState,
                results : result
            };
        } else {
            return {
                status : DlgStatus.INTRRUPTED,
                dialogueState : newDialogueState,
                results : result
            };
        }
    }

    /**
     * A simple wrapper for dlg.expect
     * This function will yield the floor to the user, and be called again only
     * when an expected result is returned and reported to the user
     * 
     * @param appName 
     * @param funcName 
     * @returns 
     */
    async *expectType(appName : string | null, funcName : string | null) {
        const res = yield* this.expect(
            new Map([]),
            (x) => ThingTalkUtils.isOutputType(appName, funcName)(x),
            (x) => x,
            null);
        return res;
    }


    async *proposeQueryRefinement(proposeField : string[],
                                  agentUtterance : string,
                                  waitForAck = true) {
        // set the dialogue act directly
        this.dialogueHandler!._dialogueState!.dialogueAct = 'sys_search_question';
        this.dialogueHandler!._dialogueState!.dialogueActParam = proposeField;

        // register agent utterance
        this.say([agentUtterance]);

        let result : ReplyResult;
        if (!waitForAck) {
            // if not waiting for ack, always intercept result as soon as receieved
            result = yield *this.expect(
                new Map([]),
                (reply) => true,
                (result) => result,
                null
            );
        } else {
            // if waiting for ack, everytime it comes back, we check if dialogue state has userIsDone equal to true
            result = yield *this.expect(
                new Map([]),
                (reply) => true,
                (result) => result,
                null
            );
            while (!this.dialogueHandler!._dialogueState!.userIsDone) {
                result = yield *this.expect(
                    new Map([]),
                    (reply) => true,
                    (result) => result,
                    null,
                );
            }
        }

        // determine if this proposal has been accepted by the user
        // if no, re-ask the proposal, making this an explicit slot-fill
        // TODO
        console.log(result);
        const newDialogueState = this.dialogueHandler!._dialogueState;
        return {
            status : DlgStatus.SUCCESS,
            dialogueState : newDialogueState,
            result : result
        };
    }

    isOutputType(first : string | null, second : string | null) {
        return isOutputType(first, second);
    }

    getLastCommand() : Ast.ChainExpression {
        return this.dialogueHandler!._dialogueState!.history[this.dialogueHandler!._dialogueState!.history.length - 1].stmt.expression;
    }

    getLastResult() : Ast.DialogueHistoryResultList | null {
        return this.dialogueHandler!._dialogueState!.history[this.dialogueHandler!._dialogueState!.history.length - 1].results;
    }
    
    getLastResultSize() : number | null {
        const res = this.dialogueHandler!._dialogueState!.history[this.dialogueHandler!._dialogueState!.history.length - 1].results;
        if (!res)
            return null;
        assert(res.count.isNumber && res.count instanceof Ast.NumberValue);
        return res.count.value;
    }

    ifSimpleProjectionQuery(deviceName : string, functionName : string) {
        const lastCommand = this.getLastCommand();
        if (lastCommand.expressions.length !== 1)
            return [false, null, null];
        const expression = lastCommand.expressions[0];
        if (!(expression instanceof Ast.ProjectionExpression))
            return [false, null, null];
        const invocations = Ast.getAllInvocationExpression(expression);
        if (invocations.length === 1 &&
            invocations[0] instanceof Ast.InvocationExpression &&
            invocations[0].invocation.channel === functionName &&
            invocations[0].invocation.selector.kind === deviceName)
            return [true, expression.args, expression];
        return [false, null, null];
    }

    ifExpressionContains(desiredName : string) {
        const lastCommand = this.getLastCommand();
        if (Ast.getAllFilterNames(lastCommand).indexOf(desiredName) >= 0)
            return true;
        return false;
    }

    ifExpressionNotContains(desiredName : string) {
        const lastCommand = this.getLastCommand();
        if (Ast.getAllFilterNames(lastCommand).indexOf(desiredName) === -1)
            return true;
        return false;
    }

}

function determineQuerySuccess(state : Ast.DialogueState,
                               initialQuery : Ast.ExpressionStatement) {
    for (const item of state.history) {
        if (item.stmt.expression.equals(initialQuery.expression) && item.confirm !== 'proposed')
            return true;
    }
    return false;

}

export const POLICY_NAME = 'org.thingpedia.dialogue.transaction';