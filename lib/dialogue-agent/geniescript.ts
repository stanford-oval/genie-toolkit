import * as Tp from 'thingpedia';
import { Type } from "thingtalk";
import { ReplyResult } from './dialogue-loop';

type GeniescriptReplyResult = Tp.DialogueHandler.ReplyResult;

interface GeniescriptAnalysisResult extends Tp.DialogueHandler.CommandAnalysisResult {
    branch : string;
}

interface GenieQuery {
    type : GenieQueryType;
    content : string | GeniescriptAnalysisResult | Tp.DialogueHandler.CommandAnalysisResult | ReplyResult;
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
        try {
            yield* this.dlg!.expect(new Map([
                [prompt_str, (async function*() {
                    yield* self.logic();
                })]
            ]));
            this.dlg.say(["geniscript should not exit."]);
        } catch(e) {
            this.dlg.say(["geniescript has an error:" + e]);
        } finally {
            const error_prompt = "Geniescript had an error or exited. Please restart genie.";
            this.dlg.say([error_prompt]);
            yield * this.dlg.expect(new Map([
            ]), null, null, error_prompt);
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

    public static objectType(appName : string, funcName : string) : ((reply : ReplyResult) => boolean) {
        return (reply : ReplyResult) => {
            if (reply.raw_results && Object.keys(reply.raw_results).length) {
                const [_appCall, _blob] = reply.raw_results[0];
                const [_appName, _funcName] = _appCall.split(":");
                if ((appName === null || appName === _appName) && (funcName === null || funcName === _funcName))
                    return true;

            }
            return false;
        };
    }
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

}