
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import assert from 'assert';
import { Ast, Type } from "thingtalk";
import { AgentReplyOptions, AgentReplyRecord } from '../templates/state_manip';
import { ReplyResult } from './dialogue-loop';
import ThingTalkDialogueHandler from './handlers/thingtalk';
import { NaturalLanguageUserInput } from './user-input';
import { determineSameExceptSlotFill } from '../templates/ast_manip';

type GeniescriptReplyResult = Tp.DialogueHandler.ReplyResult;

interface GeniescriptAnalysisResult extends Tp.DialogueHandler.CommandAnalysisResult {
    branch : string;
}

interface GenieQuery {
    type : GenieQueryType;
    content : string | GeniescriptAnalysisResult | Tp.DialogueHandler.CommandAnalysisResult | ReplyResult;
}

// TODO: implement FAILED
export enum DLGResultStatus {
    SUCCESS,
    INTERRUPTED
}

// interface DLGResult {
//     status : DLGResultStatus;
//     dialogueState : DialogueState;
//     result ?: unknown;
// }

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

    async *expect(
        action_map : Map<string, GeniescriptLogic<string, any>> = new Map([]),
        obj_predicate : ((reply : ReplyResult) => boolean) | null = null,
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

    async *execute(program : string, type_check : ((reply : ReplyResult) => boolean) | null = null) : GeniescriptState<any> {
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
     * Propose an action to user. If user accepts the action, it will be automatically executed.
     * This corresponds to agent semantic function `makeRecommendationReply`, used to propose actions
     * 
     * @param actionString 
     * @param actionDescription
     * TODO: figure out the return possibilities
     * @returns GeniescriptResponse, which is a possibility of:
     *          - succeeded   : the user accepts the proposal and the action is executed
     *          - declined    : the user did not accept the proposal
     *          - interrupted : the user asks another question and the dialogue flow was re-directed
     */
    async *initiateAction(actionString : string, actionDescription : string) {
        this.say([actionDescription]);
        // consult the contextual semantic parser for the developer-inputted user utterances
        const sendToNLU : NaturalLanguageUserInput = { type : 'command', utterance : actionString, platformData : {} };
        const analyzed = await this.dialogueHandler!._parseCommand(sendToNLU);
        assert(analyzed.parsed instanceof Ast.DialogueState);
        assert(analyzed.parsed.history.length === 1);
        const action = (analyzed.parsed.history[0].stmt.expression.first as Ast.InvocationExpression).invocation;

        // TODO: very likely, all other things except state will not be used in `options`
        //       figure that out
        const options : AgentReplyOptions = {
            numResults: 1
        };
        options.end = false;

        // construct the new dialogue state and update TT handler's dialogue state
        const reply = makeAgentReply(addActionParam(this.dialogueHandler!._dialogueState!, 'sys_recommend_one', action, 'proposed'), null, options);
        this.dialogueHandler!._dialogueState = reply.state;
        
        // wrap and return
        // TODO: when user declines, what to do?
        const blob = yield *this.expect(
            new Map([]),
            null,
            null,
            null
        );
        return blob;
    }

    /**
     * Propose a query to user, and if accepted, return the query result to user.
     * This corresponds to the agent semantic function `makeRecommendationReply` with no action input.
     * 
     * @param queryString to-be-proposed query in ThingTalk representation
     * @param queryDescription agent output (natural language) of the proposal
     * @param expectedType expected return type from this query
     * @returns 
     */
    async *initiateQuery(queryString : string,
                         queryDescription : string) {
                        // expectedType : [string, string]) {
        // consult the contextual semantic parser for the developer-inputted user utterances
        this.say([queryDescription]);
        const sendToNLU : NaturalLanguageUserInput = { type : 'command', utterance : queryString, platformData : {} };
        const analyzed = await this.dialogueHandler!._parseCommand(sendToNLU);
        assert(analyzed.parsed instanceof Ast.DialogueState);
        assert(analyzed.parsed.history.length === 1);
        const queryExpressionStatement = analyzed.parsed.history[0].stmt;
        
        // construct the new dialogue state
        const newHistoryItem = new Ast.DialogueHistoryItem(null, queryExpressionStatement, null, "proposed", null);
        const newState = this.dialogueHandler!._dialogueState!.clone();
        newState.history.push(newHistoryItem);
        const reply = makeAgentReply(newState);
        
        // update the dialogueState with the state returned from semantic function
        this.dialogueHandler!._dialogueState = reply.state;
        
        // wrap and return
        yield *this.expect(
            new Map([]),
            (reply) => true,
            null,
            null,
        );
        
        const newDialogueState = this.dialogueHandler!._dialogueState;
        const latestItem = newDialogueState.history[newDialogueState.history.length - 1];
        if (determineSameExceptSlotFill(queryExpressionStatement, latestItem.stmt) && latestItem.confirm === 'confirmed') {
            return {
                status : DLGResultStatus.SUCCESS,
                dialogueState : newDialogueState,
                result : latestItem.results!.results[0]
            };
        }
        
        return {
            status : DLGResultStatus.INTERRUPTED,
            dialogueState : newDialogueState
        };
    }
}


function addActionParam(dialogueState : Ast.DialogueState,
                        dialogueAct : string,
                        action : Ast.Invocation,
                        confirm : 'accepted' | 'proposed') : Ast.DialogueState {
    assert(action instanceof Ast.Invocation);
    assert(['accepted', 'confirmed', 'proposed'].indexOf(confirm) >= 0);

    const in_params = action.in_params;
    const setparams = new Set;
    for (const param of action.in_params) {
        if (param.value.isUndefined)
            continue;
        setparams.add(param.name);
    }
    const schema = action.schema;

    // TODO: need to make this back online
    // // make sure we add all $undefined values, otherwise we'll fail
    // // to recognize that the statement is not yet executable, and we'll
    // // crash in the compiler
    // for (const arg of schema.iterateArguments()) {
    //     if (arg.is_input && arg.required && !setparams.has(arg.name))
    //         in_params.push(new Ast.InputParam(null, arg.name, new Ast.Value.Undefined(true)));
    // }

    const newInvocation = new Ast.Invocation(null,
        action.selector,
        action.channel,
        in_params,
        schema
    );
    const newStmt = new Ast.ExpressionStatement(null,
        new Ast.InvocationExpression(null, newInvocation, schema));
    const newHistoryItem = new Ast.DialogueHistoryItem(null, newStmt, null, confirm, null);

    const newState = new Ast.DialogueState(null, POLICY_NAME, dialogueAct, null, dialogueState.history);
    newState.history.push(newHistoryItem);

    // TODO : figure out if we need to propagateDeviceIDs or adjustDefaultParameters
    return newState;
}

export const POLICY_NAME = 'org.thingpedia.dialogue.transaction';


function makeAgentReply(state : Ast.DialogueState,
                        expectedType : ThingTalk.Type|null = null,
                        options : AgentReplyOptions = {}) : AgentReplyRecord {
    
    assert(state instanceof Ast.DialogueState);
    assert(state.dialogueAct.startsWith('sys_'));
    assert(expectedType === null || expectedType instanceof ThingTalk.Type);

    // show a yes/no thing if we're proposing something
    if (expectedType === null && state.history.some((item) => item.confirm === 'proposed'))
        expectedType = Type.Boolean;

    // if false, the agent is still listening
    // the agent will continue listening if one of the following is true:
    // - the agent is eliciting a value (slot fill or search question)
    // - the agent is proposing a statement
    // - the agent is asking the user to learn more
    // - there are more statements left to do (includes the case of confirmations)
    let end = options.end;
    if (end === undefined) {
        end = expectedType === null &&
            state.dialogueActParam === null &&
            !state.dialogueAct.endsWith('_question') &&
            state.history.every((item) => item.results !== null);
    }

    // at inference time, we don't need to compute any of the auxiliary info
    // necessary to synthesize the new utterance, so we take a shortcut
    // here and skip a whole bunch of computation

    return {
        state,
        contextPhrases: [],
        expect: expectedType,

        end: end,
        // if true, enter raw mode for this user's turn
        // (this is used for slot filling free-form strings)
        raw: !!options.raw,

        // the number of results we're describing at this turn
        // (this affects the number of result cards to show)
        numResults: options.numResults || 0,
    };
}