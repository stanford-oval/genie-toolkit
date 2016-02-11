# Getting Started with ThingEngine

Welcome to ThingEngine!

This short introduction will teach you the basics of using your ThingEngine.

## What is ThingEngine?

ThingEngine is a system service that will execute simple "mini-apps" for
your Internet of Things devices and your web accounts.

You can get a taste of the kinds of apps that can run in ThingEngine if
you go to our [list of recommended apps](https://thingengine.stanford.edu/thingpedia/apps),

## What can I do with ThingEngine?

ThingEngine will execute apps that use things. Therefore, to have it do anything,
you must associate your engine with your things, and tell the engine what apps
to run, either by choosing them from ThingPedia or by explicitly writing down
the code.

## What is Sabrina?

Sabrina is the magic virtual assistant that lives in your ThingEngine. She can
help you configure your things, execute actions on them, install apps based on
your description of the behavior you want.

This tutorial is also available in interactive form
[here](https://thingengine.stanford.edu/tutorial/1).

## Step-by-step example: Twitter to Sabrina

This example will guide you through filtering your Twitter feed and redirect
to Sabrina. At the end of the example, she will tell you about any tweet in your
stream containing the hashtag "sabrina".

### Step 0: Register to ThingEngine Cloud

You probably already have an account at
[ThingEngine Cloud](https://thingengine.stanford.edu), but if you did
not, you should
[register](https://thingengine.stanford.edu/user/register) and then
come back.

### Step 1: Getting Sabrina

Sabrina uses [Omlet](http://omlet.me) to communicate. Omlet is a chat
app developed by MobiSocial, Inc., and you can download it for
[iPhone](https://itunes.apple.com/us/app/omlet/id682042134?ls=1&mt=8)
or
[Android](https://play.google.com/store/apps/details?id=mobisocial.omlet).

Note that you don't need to install the ThingEngine App on your phone, so
Sabrina works with iOS too (even though there is no ThingEngine for iOS yet).
Unfortunately, there is no support for Windows Phone yet.

In the configuration of Omlet you must also link it to Google, Facebook or
Baidu. You can do that from the profile in the Omlet App. This is a technical
limitation that we hope to overcome soon.

After you obtained Omlet, you should log in to your ThingEngine account, then
click on [Sabrina](https://thingengine.stanford.edu/assistant) in the top left
navigation bar. You will be asked to associate Omlet with your ThingEngine account,
and you will be asked to enable Sabrina. After you say Yes, you should receive
the first greeting from your new assistant.

### Step 2: Twitter

Go to [Online Accounts](https://thingengine.stanford.edu/devices?class=online).
You'll see a list of your accounts that ThingEngine knows about. At this point,
he probably knows about your Omlet, but we need to teach him about Twitter as well.

To that extent, just click on
[Add New Account](https://thingengine.stanford.edu/devices/create?class=online)
and then on
[Twitter Account](https://thingengine.stanford.edu/devices/oauth2/com.twitter).

After you log in to Twitter and grant premission, you will be redirected to the
list of accounts, which now includes Twitter too.

### Step 3: The App

Finally you are ready to enable the app that will actually do the hard-work
of filtering your Twitter.

Go ahead, click on [New App](https://thingengine.stanford.edu/apps/create) in
the navigation bar, and copy-paste the following code in the _Code_ field:

    TwitterTutorial() {
      @twitter.source(text, hashtags, _, from, _, _), $contains(hashtags, "sabrina")
        => @sabrina.say("Tweet from " + from + ": " + text);
    }

Don't worry about the Feed drop-down, or the Run In, as we will get to them
in a more advanced tutorial, but they don't matter for now (but make sure you keep
the latter to the default value of "Cloud").

Click "Create", and you're done! The app is running, taking care of you.

### A look into the rule

We will look at the code in more detail in the [ThingTalk Tutorial](/doc/thingtalk.md),
but you can already guess what's happening at a high level. We define our app
to have name `TwitterTutorial`, and we include one rule in it, composed of everything
in the block up to the semicolon.

The rule has two parts: the part before the `=>` is called a trigger, and defines
when the code runs, the part after is called an action, and defines what to do.

We learn from [ThingPedia](http://www.thingpedia.org/devices/by-id/com.twitter) that
`@twitter` is the name of our Twitter Account (which was mapped to `com.twitter` when
we added it), and `source` is a trigger with 6 arguments: `text`, `hashtags`, `urls`,
`from`, `inReplyTo` and `yours`. We don't care about some of these, so we put `_` in
their place. Furthermore, we want the `hashtags` array to contain "sabrina", so put
a second condition using the `$contains(array, value)` built-in.

Now the action part. Again from
[ThingPedia](http://www.thingpedia.org/devices/by-id/org.thingpedia.builtin.sabrina)
we learn that `@sabrina.say` causes Sabrina to say something, and it wants one
argument, the message. So we paste togheter the values from the trigger, and we're
done.

### Deleting the app

Whenever you're tired of Sabrina telling you about your tweets, you can remove the
app by going in the [list of apps](https://thingengine.stanford.edu/apps), looking
for "TwitterTutorial", and clicking "Delete".

And if you want to stop ThingEngine from touching your Twitter
altogheter, you can do so from the
[list of accounts](https://thingengine.stanford.edu/devices?class=online).

### Inside the engine: the Logs

If you click on [Status](https://thingengine.stanford.edu/status) in the navigation
bar, you will see the current status of your engine. In particular, you get access
to the full execution log.
Here, if you make a mistake, and stuff stops working, you can try and figure out why.

Or maybe we made a mistake in writing ThingEngine, in which case, when you
[report a bug](https://github.com/Stanford-IoT-Lab/ThingEngine/issues) we will
appreciate seeing the full debug log (don't forget to redact your personal info
away!).

### Further Reading:

* [ThingTalk Primer](/doc/thingtalk.md): a more in-depth introduction to the language
* [Advanced ThingEngine](/doc/advanced.md): more on the ThingEngine
