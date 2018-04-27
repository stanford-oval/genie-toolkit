# Internal API

The library must be used in conjuction with [thingengine-core](https://github.com/Stanford-Mobisocial-IoT-Lab/thingengine-core)
and the rest of the ThingSystem platform.

The library exposes a single class, `Almond`, which represents a single conversation with the user.
This file documents only the internal API. For the high level dialog model of Almond, see [https://almond.stanford.edu/thingpedia/developers/almond-dialog-api-reference.md].

## Class Almond

### method notify

```javascript
function notify(programId : string?,
                icon : string?,
                outputType : string,
                outputValue : any)
```

Present a result (notification) of the given ThingTalk program to the user.

### method notifyError

```javascript
function notifyError(programId : string?,
                     icon : string?,
                     error : Error)
```

Report an error from a ThingTalk program running in the background.

### method askForPermission

```javascript
function askForPermission(principal : string,
                          identity : string,
                          program : ThingTalk.Ast.Program) : Promise<bool>
```

Perform an interactive permission request. `principal` indicates the account identifier of the source of the program, and `identity` is the identity they
claim to own. The identity has been verified beforehand and it is safe to show
to the user.

### method askQuestion

```javascript
function askQuestion(programId : string?,
                     icon : string?,
                     type : ThingTalk.Ast.Type,
                     question : string) : Promise<any>
```

Ask a question from a ThingTalk program. The expected value is inferred
from the given `type`, and the result will be the JS representation of the
value that the user chose.

### method interactiveConfigure

```javascript
function interactiveConfigure(kind : string) : Promise<>
```

Interactively configure a device of the given `kind`.

### method runProgram

```javascript
function runProgram(program : ThingTalk.Ast.Program,
                    programId : string) : Promise<>
```

Guide the user through completing the given `program` and then run it.