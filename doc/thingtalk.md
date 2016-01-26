# ThingTalk primer

## What is ThingTalk?

ThingTalk is the programming language that ThingEngine uses. It's a _declarative
domain-specific language_, which means it's a language that we specifically developed
for the Internet of Things (hence the name) and it does not use common constructs
like for, if or lambdas, hopefully providing a higher level abstraction for connecting
things.

## What can I write in ThingTalk?

ThingTalk is rule based, and was developed as an extension of the well-known
[IFTTT][] service.

Each app is composed of a list of rules, each containing a trigger, an optional list
of conditions, and an action. The trigger determines when the action is executed,
and the conditions further limit it.

## A ThingTalk tutorial.

### 1. The Basics

Let's start with the basics: like every programming language, we start from Hello World.
This tutorial assumes that you already have configured Sabrina. If not, see the [Getting Started Tutorial](/getting-started.md)
first.

This is the code for the Hello World app:

    HelloWorld() {
      @sabrina.listen("hello") => @sabrina.say("world");
    }

Go ahead and copy paste it in the [New App](https://thingengine.stanford.edu/apps/create) form,
then create an app.

Now every time you say "hello" to Sabrina, she will reply with "world".

### 2. Smarter Matching

If you played with your Sabrina a little, you'll notice that she seems quite limited: as soon as you
say "Hello", or "hello!" or even "hello " with a trailing space, she will not respond with "world".
What's going on?

Well, let's break down the example first. The above code is equivalent to

    HelloWorld() {
      @sabrina.listen(text), text = "hello"
        => @sabrina.say("world");
    }

The trigger `@sabrina.listen` has a single argument, which we say _binds_ to the variable `text`.
This is similar to Datalog or other logic programming languages, and effectively means that the
every time the trigger happen, the `text` variable in the scope of the rule will contain the
first value produced by the trigger.

From the ThingPedia documentation on Sabrina, we learn that `@sabrina.listen` is a trigger that
fires every time you say something to Sabrina, and the first and only argument to it is the
content of your message, with no further processing. So that's what `text` will contain when
the rule is being executed: your message, as you wrote it.

The part after the comma is a condition, that further limits the execution of the rule. You
can have as many conditions as you want, and they all have to be true when the trigger happen,
or the rule will be ignored until the next occurrence of the trigger (in this case, the next
message you send to Sabrina).

Now we start to see the problem: the condition is too strict! We can replace the condition
with something more lenient, for example:

    HelloWorld() {
      @sabrina.listen(text), $regex(text, "hello", "i")
        => @sabrina.say("world");
    }

This second condition uses `$regex(text, regexp, flags)`, a condition which is true when `text`
matches the regular expression `regexp` (in [JavaScript syntax][JSRegExp]). So in this case
Sabrina will reply "world" every time your message contains "hello" as a substring -
including "hello", "hello Sabrina" but also "othello". If you want to match just "hello" as a
word, you could instead use `"\\\\sshello\\\\s"` or `"\\\\bhello\\\\b"` (note the double escaping of
backlashes, which are special characters in strings <!-- and another level of escaping is
due to Markdown -->). Again, look at JavaScript to find out
what regular expressions are supported, as the well as what `flags` is for (in our case,
it just tells the runtime to do case-insensitive matching, so that "Hello" and "hello" both
work).

### 3. Connecting Sources of Information

Right now, the app listens to Sabrina, and speaks to Sabrina. This can be useful, but it's
hardly interesting, and there are probably better ways to build a programmable virtual assistant
that can talk back. Instead, the power of ThingTalk relies on the ability to connect to
outside sources for knowledge.

We [already saw](/doc/getting-started.md) how to get Sabrina to report all Tweets. Now let's
see how we can make it more interactive. The goal is to be able to tell Sabrina to watch for
a given hashtag, without changing the app or writing code.

First of all, we need to know what hashtag the user is interested in. For example, we can
tell the user to say "on hashtag" followed by the hashtag:

    var HashTag : (String);
    @sabrina.listen(text), $regex(text, "^on\\\\s+hashtag\\\\s+([a-z0-9]+)", "i", hashtag)
    => HashTag(hashtag);

Here we observe how we use local storage: first we declare a variable, of type `(String)`
(tuple of one `String` element), and then we use that variable as an action in a rule to
write into it. Because our first use of the variable is in a write, we could have skipped
the declaration, but we included it for clarity.

We also observe how we can pass additional arguments to `$regex` to bind to capturing
groups in the regular expression and extract useful information from the matched text.

The next step is to use the variable holding the hashtag in a rule
that matches on Twitter.  We already know how to get tweets (if we
forgot, we can always
[look on ThingPedia](http://www.thingpedia.org/devices/by-id/com.twitter)), so the rule
becomes:

    @twitter.source(text, hashtags, _, from, _, _), HashTag(interesting),
    $contains(hashtags, interesting) =>
    @sabrina.say("Interesting tweet from " + from + ": " + text);

(The full code of the app is in [ThingPedia](http://www.thingpedia.org/apps/

[IFTTT]: http://ifttt.com
[JSRegExp]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp
