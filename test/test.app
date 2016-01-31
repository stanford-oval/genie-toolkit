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
    extern HomeLocation : (Location);
    var Tomorrow : (String, Measure(C));
    @weather(1day, forecast, temperature) =>
        Tomorrow(forecast, temperature);
    @gps(time, location) =>
        MyLocation(location);

    Tomorrow(_, temp), temp >= 70F, MyLocation(loc), HomeLocation(homeloc),
    $distance(loc, homeloc) > 3km =>
        @(type="light",loc="livingroom").power(off);
}
