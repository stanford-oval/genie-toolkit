// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Jake Wu <jmhw0123@gmail.com>

import { Ast, SchemaRetriever } from 'thingtalk';
import * as C from '../templates/ast_manip';

export default class ThingtalkComposer {
    private _schemaRetriever : SchemaRetriever;
    private _device : string;
    private _invocationExpression : Ast.InvocationExpression | null;
    private _filterExpression : Ast.FilterExpression | null;
    private _projectionExpression : Ast.ProjectionExpression | null;
    private _schema : Ast.FunctionDef | null;

    constructor(schemaRetriever : SchemaRetriever, 
                device : string) {
        this._schemaRetriever = schemaRetriever;
        this._device = device;
        this._invocationExpression = null;
        this._filterExpression = null;
        this._projectionExpression = null;
        this._schema = null;
    }
    
    async invoke(func : string) {
        this._schema = await this._schemaRetriever.getSchemaAndNames(this._device, "query", func);
        const invocation = new Ast.Invocation(null, new Ast.DeviceSelector(null, this._device, null, null), func, [], this._schema);
        this._invocationExpression = new Ast.InvocationExpression(null, invocation, this._schema);
        const statement = new Ast.ExpressionStatement(null, this._invocationExpression);
        return new Ast.Program(null, [], [], [statement], {});
    }

    async project(field : string) {
        if (this._invocationExpression)
            this._projectionExpression = C.makeProjection(this._invocationExpression, field);
        else
            throw new Error("function not defined.");
        const statement = new Ast.ExpressionStatement(null, new Ast.ChainExpression(null, [this._projectionExpression], null));
        return new Ast.Program(null, [], [], [statement], {});
    }

    async filter(property : string, op : string, displayValue : string) {
        const filter = new Ast.BooleanExpression.Atom(null, property, op, new Ast.Value.String(displayValue));
        if (this._invocationExpression)
            this._filterExpression = new Ast.FilterExpression(null, this._invocationExpression, filter, this._schema);
        else
            throw new Error("function not defined.");
        const statement = new Ast.ExpressionStatement(null, this._filterExpression);
        return new Ast.Program(null, [], [], [statement], {});
    }
}