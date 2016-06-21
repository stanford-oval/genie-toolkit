const StateMachine = require('./state-machine');
const ValueCategory = require('../lib/semantic').ValueCategory;
const readline = require('readline');

var fsm = StateMachine.create({
    initial: {state: 'green', defer: true},
    events: [
        {name: 'warn',  from: 'green',  to: 'yellow'},
        {name: 'alarm', from: 'green',  to: 'red'   },
        {name: 'panic', from: 'yellow', to: 'red'   },
        {name: 'calm',  from: 'red',    to: 'yellow'},
        {name: 'clear', from: 'yellow', to: 'green' }
    ],
    callbacks: {
        onpanic: function(event, from, to, msg) {
            console.log('panic! ' + msg);
        },
        onclear: function(event, from, to, msg) {
            console.log('thanks to ' + msg);
        },
        onwarn: function(event, from, to, msg) {
            console.log('warn ' + msg);
        },
        oncalm: function(event, from, to, msg) {
            console.log('calm ' + msg);
        },
        onalarm: function(event, from, to, msg) {
            console.log('alarm ' + msg);
        },
    },
    triggers: {
        'green':  {1: 'warn',  2: 'alarm'},
        'yellow': {1: 'panic', 2: 'clear'},
        'red':    {1: 'calm'}
    },
    expecting: {
        'green': ValueCategory.Number,
        'yellow': ValueCategory.Number,
        'red': ValueCategory.Number,
    }
});

fsm.startup();

/*
fsm.warn();
fsm.panic('killer bees');
fsm.calm();
fsm.clear('sedatives in the honey pots');
*/

function main() {
    var rl = readline.createInterface({input: process.stdin, output: process.stdout});
    rl.setPrompt('$ ');
    
    function quit() {
        console.log('Bye\n');
        rl.close();
        process.exit();
    }
    
    rl.on('line', function(line) {
        if (line.trim().length === 0) {
            rl.prompt();
            return;
        } else {
            condition = line;
            fsm.transTrigger(condition);
            rl.prompt();
        }
    });
    rl.on('SIGINT', quit);

    rl.prompt();
}
    
main();
  
