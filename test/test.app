/* -*- mode: css -*- */

/* This is not a real app, rather, it's a unit test for AppExecutor.
   It's run by test/app_grammar_test.js

   If you try to run it as an app, it will probably fail, because the
   needed mock channels and mock devices are not present.
   If you're looking for syntax examples, you'll find more in sample.apps.
*/

@name "name";
@description "description";
@setting someone {
    name: "A Someone";
    description: "Write a person name here";
    type: string;
}

:weather(1day) as weather {
    temperature <= 70F;
}
all .person.location as people {
    distance(location, #home.location) > 3km;
}
=>
.livingroom.light {
    power: off;
}
#sms1.sms:send {
    to: "555-555-5555";
    /* message: join(people.name, ' and ') " left and \"winter\" is coming. By " @someone;*/
    /* people is a collection here, because we used 'all', and so
       people.name is also a collection. Because we did not call join(),
       and we try to stringify it, it should do array.join(', ')
       (note the space after the comma)
     */
    message: people.name " left and winter is coming. By " @someone;
}