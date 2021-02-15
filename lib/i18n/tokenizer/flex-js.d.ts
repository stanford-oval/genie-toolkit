// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-

declare module 'flex-js' {
    export default class Lexer<TokenType> {
        static EOF : 0;
        static STATE_INITIAL : 'initial';
        static STATE_ANY : '*';
        static RULE_EOF : '<<EOF>>';

        definitions : Record<string, RegExp>;

        index : number;
        text : string;
        state : string;

        setIgnoreCase(ignoreCase : boolean) : void;
        setDebugEnabled(enabled : boolean) : void;

        addState(name : string, exclusive ?: boolean) : void;
        addDefinition(name : string, expr : RegExp) : void;
        addRule(expr : RegExp, cb ?: (self : Lexer<TokenType>) => TokenType) : void;
        addRules(rules : Array<{ expression : RegExp, action : (self : Lexer<TokenType>) => TokenType }>) : void;
        addStateRule(states : string|string[], expr : RegExp, cb ?: (self : Lexer<TokenType>) => TokenType) : void;
        addStateRules(states : string|string[], rules : Array<{ expression : RegExp, action : (self : Lexer<TokenType>) => TokenType }>) : void;

        setSource(source : string) : void;
        lex() : TokenType|0;
        lexAll() : TokenType[];
        reset() : void;
        clear() : void;

        discard() : void;
        echo() : void;
        begin(newState : string) : void;
        reject() : void;
        more() : void;
        less(n : number) : void;
        unput(s : string) : void;
        input(n : number) : string;
        terminate() : void;
        restart(newSource : string) : void;
        pushState(newState : string) : void;
        topState() : string;
        popState() : void;
        switchState(newState ?: string) : void;
    }
}
