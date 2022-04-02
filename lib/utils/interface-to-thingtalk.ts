import { Ast, SchemaRetriever } from 'thingtalk';
// import { DialogueLoop } from '../dialogue-agent/dialogue-loop';
// import StatementExecutor from '../dialogue-agent/statement_executor';
// import * as C from '../templates/ast_manip';

export class ThingtalkComposer {
    private _schemaRetriever : SchemaRetriever;
    private _device : string;
    private _invocationExpression : Ast.InvocationExpression | null;
    private _filterExpression : Ast.FilterExpression | null;
    private _schema : Ast.FunctionDef | null;

    constructor(schemaRetriever : SchemaRetriever, 
                device : string) {
        this._schemaRetriever = schemaRetriever;
        this._device = device;
        this._invocationExpression = null;
        this._filterExpression = null;
        this._schema = null;
    }
    
    async invoke(func : string) {
        this._schema = await this._schemaRetriever.getSchemaAndNames(this._device, "query", func);
        const invocation = new Ast.Invocation(null, new Ast.DeviceSelector(null, this._device, null, null), func, [], this._schema);
        this._invocationExpression = new Ast.InvocationExpression(null, invocation, this._schema);
        return new Ast.ExpressionStatement(null, this._invocationExpression);
    }

    async filter(property : string, displayValue : string) {
        const filter = new Ast.BooleanExpression.Atom(null, property, '=~', new Ast.Value.String(displayValue));
        if (this._invocationExpression)
            this._filterExpression = new Ast.FilterExpression(null, this._invocationExpression, filter, this._schema);
        else {
            throw new Error("function not defined.");
        }
        return new Ast.ExpressionStatement(null, this._filterExpression);
    }
}