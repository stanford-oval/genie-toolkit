import * as Tp from 'thingpedia';
import { Type } from "thingtalk";

type GeniescriptReplyResult = Tp.DialogueHandler.ReplyResult;
type ReplyType = Array<string|Tp.FormatObjects.FormattedObject>;

interface GeniescriptAnalysisResult extends Tp.DialogueHandler.CommandAnalysisResult {
    branch : string;
}

interface LogicParameter {
    type : LogicParameterType;
    content : string | GeniescriptAnalysisResult | Tp.DialogueHandler.CommandAnalysisResult | ReplyType;
}

enum LogicParameterType {
    ANALYZE_COMMAND = "AnalyzeCommand",
    GET_REPLY = "getReply",
    CALLBACK = "callback",
}

export type GeniescriptLogic = AsyncGenerator<Tp.DialogueHandler.CommandAnalysisResult | Tp.DialogueHandler.ReplyResult | GeniescriptReplyResult | null, any, LogicParameter>;

export abstract class GeniescriptAgent implements Tp.DialogueHandler<GeniescriptAnalysisResult, string> {
    private _logic : GeniescriptLogic | null;
    private skill_name : string;
    public dlg : AgentDialog;

    protected constructor(public priority = Tp.DialogueHandler.Priority.PRIMARY, public icon : string | null = null, user_target : string, skill_name : string) {
        console.log("AbstractGeniescriptHandler constructor");
        this._logic = null;
        if (this.constructor === GeniescriptAgent)
            throw new Error("Abstract classes can't be instantiated.");
        this.skill_name = skill_name;
        this.dlg = new AgentDialog(user_target, skill_name);
    }

    getState() : string {
        // TODO: Implementation serialization
        return "geniescript state";
    }

    async *__wrapped_logic() : GeniescriptLogic {
        const self = this;
        const prompt_str : string = self.skill_name + " init";
        yield * this.dlg!.expect(new Map([
            [prompt_str, ( async function*() {
                yield * self.logic();
            })]
        ]), "This is KEQD Geniscript. What can I help you with?");
    }

    reset() : void {
        this._logic = this.__wrapped_logic();
        // noinspection JSIgnoredPromiseFromCall
        this._logic.next();
    }

    async initialize() {
        this._logic = this.__wrapped_logic();
        await this._logic.next();
        return null;
    }

    async analyzeCommand(command : string) : Promise<GeniescriptAnalysisResult> {
        const utterance = command;
        console.log("AbstractGeniescriptHandler analyzeCommand");
        const result = await this._logic!.next({ type: LogicParameterType.ANALYZE_COMMAND, content: utterance });
        console.log(result.value);
        return result.value;
    }

    async getReply(command : GeniescriptAnalysisResult) : Promise<Tp.DialogueHandler.ReplyResult | GeniescriptReplyResult> {
        const result0 = this._logic!.next({ type: LogicParameterType.GET_REPLY, content: command });
        const result = await result0;
        return result.value;
    }

    async getAgentInputFollowUp(return_value : ReplyType) {
        console.log("AbstractGeniescriptHandler getAgentInputFollowUp");
        const result0 = this._logic!.next({ type: LogicParameterType.CALLBACK, content: return_value });
        const result = await result0;
        return result.value;
    }

    // TODO: call this main
    async *logic() : GeniescriptLogic {
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
    }

    async *expect(
        func_map : Map<string,
            (GeneratorFunction | AsyncGeneratorFunction | (() => Promise<any>)| (() => any))
            >,
        prompt : string | null = null
    ) : GeniescriptLogic {
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
        if (prompt) {
            this._last_result.messages.push(prompt);
            this._last_result_only_prompt = {
                messages: [prompt!],
                expecting: this._last_expecting,
                context: this._last_analyzed ?? "",
                agent_target: this._last_target!
            };
        } else {
            this._last_result_only_prompt = null;
        }
        while (true) {
            const input = yield this._last_result;
            if (input.type === LogicParameterType.ANALYZE_COMMAND) {
                const content = input.content as string;
                this._last_result = {
                    confident: Tp.DialogueHandler.Confidence.OUT_OF_DOMAIN_COMMAND,
                    utterance: content,
                    user_target: '',
                    branch: ''
                };
                for (const func_key of func_map.keys()) {
                    const regExp = new RegExp(func_key, 'i');
                    const match = regExp.exec(content);
                    if (match) {
                        this._last_branch = func_key;
                        this._last_result = {
                            confident: Tp.DialogueHandler.Confidence.EXACT_IN_DOMAIN_COMMAND,
                            utterance: content,
                            user_target: this._user_target,
                            branch: func_key
                        };
                        break;
                    }
                }
            } else if (input.type === LogicParameterType.GET_REPLY) {
                const content = input.content as GeniescriptAnalysisResult;
                this._last_analyzed = content.user_target;
                const current_func = func_map.get(this._last_branch!)!;
                if (current_func.constructor.name === "GeneratorFunction" || current_func.constructor.name === "AsyncGeneratorFunction")
                    return yield* current_func();
                else if (current_func.constructor.name === "AsyncFunction" || current_func.constructor.name === "Function" )
                    return current_func();
                else
                    throw Error("current_func is not a Function or GeneratorFunction");
            } else if (input.type === LogicParameterType.CALLBACK) {
                this._last_result = this._last_result_only_prompt;
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

    async *execute(program : string, type_check : ((reply : ReplyType) => boolean) | null = null) : GeniescriptLogic {
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
            if (input.type === LogicParameterType.ANALYZE_COMMAND) {
                const content = input.content as string;
                this._last_result = {
                    confident: Tp.DialogueHandler.Confidence.OUT_OF_DOMAIN_COMMAND,
                    utterance: content,
                    user_target: '',
                    branch: ''
                };
            } else if (input.type === LogicParameterType.GET_REPLY) {
                throw Error("Cannot get reply in a execute!");
            } else if (input.type === LogicParameterType.CALLBACK) {
                if (type_check && !type_check(input.content as ReplyType))
                    yield this._last_result_only_prompt;
                else
                    return input.content;

            }
        }

    }

}