/* -*- mode: js -*- */

/* This is not a real app, rather, it's a unit test for AppExecutor.
   It's run by test/app_grammar_test.js

   If you try to run it as an app, it will probably fail, because the
   needed mock channels and mock devices are not present.
   If you're looking for syntax examples, you'll find more in sample.apps.
*/

//@name "name";
//@description "description";

MyProgram(someone : String) {
    weather = weather(forecast = 1day, temperature <= 70F),
    myloc = #gps.location(distance(location, @home.location) > 3km)
    =>
    #light#livingroom (power = off), "sms1".send(to = "555-555-5555",
                                                 message = "winter is coming");
}
