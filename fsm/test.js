var StateMachine = require('./state-machine');

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
        ongreen: function(event, from, to, msg) {
            var condition = '1';
            this.transTrigger(condition);
        }
    },
    triggers: {
        'green': {'1': 'warn', '2': 'alarm'},
        'red':   {'1': 'calm'}
    }
});

fsm.startup();

// 'warn' is automatically executed in state green because of the 'transTigger'
// in 'ongreen', thus the initial state becomes 'yellow', rather than 'green'.
// fsm.warn();

fsm.panic('killer bees');
fsm.calm();
fsm.clear('sedatives in the honey pots');