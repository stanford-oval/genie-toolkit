=====
0.9.1

* Add synthetic data sampler for string and entity types [#871]
* Disable parallelization in the custom starter code, which no longer works [#865]
* Remove mmap-io for the exact matcher in the parser [#898]
* Move travis testing environment from 12 to 14 [#897]
* Misc bug fixes [#872, #899]
* Update dependencies [#873, #878, #886, #889, #890, #892, #893, #894, #895, #896, #901, #902]
* Typos [#864]

0.9.0
=====

Please see the previous releases for the full list of changes in this
development cycle.

0.9.0-rc.1
==========

## Dialogue agent improvements
* Added another confidence level, used to override normal confidence [#848].
* The logic to choose dialogue handlers was improved to avoid an accidental switch
  when answering a question from the agent [#850].

## New features in engine and runtime
* Improved handling of active and inactive conversations, allowing the engine to
  go to sleep without losing the conversation state [#836].
* Added support for persistent conversation history [#835].

## Changes to synthesis and training tools
* Added support for disk-based sampling of parameters during augmentation [#846].
* Starter makefiles now download parameter datasets from S3 instead of Thingpedia [#846].

## Other changes
* `genie assistant` now uses the Thingpedia URL configured in git, if present [#850].
* Added some more FAQs to the builtin skill [#851, #855, #856].
* Misc bug fixes [#852, #853, #854].
* Updated dependencies [#833, #837, #857].

0.9.0-alpha.1
=============

## User visible changes
* All references to the assistant now use the name "Genie" rather than "Almond".
* New feature: one-off timers at a specific time [#623, #673, #681, #695, #696,
  #699, #715, #750].

## Dialogue agent improvements
* Added support to dispatch to different dialogue backends not backed by ThingTalk.
  This is useful to interface with FAQ models and question-answering systems
  [#639, #652, #654, #752, #773].
* Added support for deciding if a command is likely parsed correctly based on
  confidence scores [#660, #663, #722].
* Added the ability to start the dialogue with a specific command instead of a
  generic welcome message.
* Added support for custom empty search phrases.
* Added support for custom follow-ups.
* Transaction dialogues were tuned to be more command-oriented and more suitable
  to a virtual assistant [#716, #718].
* Added support for joins that return pairs of items [#755].
* Improve templates for answers to projection questions [#748].
* Completed support for RecurringTimeSpecification ThingTalk type [#832].

## New features in engine and runtime
* Added support for new speech-to-text API provided by almond-cloud, and removed
  the old code to interface directly with Microsoft Speech API [#619].
* Added support for different storage backends for the engine database.
  This allows storing data for multiple engines (users) in a single relational
  database, which is convenient in a cloud deployment [#617, #648, #658, #667].
* Added support for logging conversations in the database instead of a local
  file. This eliminates any use of the local file system for persistent storage
  [#649, #662, #719].
* Added support for detecting that the engine is idle and can be stopped [#724].
* Added persistent storage of conversation state [#751, #757, #818].
* Added new protocol over the conversation websocket to synchronize devices.
  This is helpful to expose the Spotify access token to the client [#769].
* Added new protocol over the conversation websocket to control audio players
  (stop, pause, resume, set volume, etc.). This makes those commands available
  to a smart-speaker running the Genie client, connected to a cloud instance of
  Genie [#787, #792].

## Changes to synthesis and training tools
* The synthesis algorithm was refactored, and is now dynamic. It no longer
  requires a fixed template grammar throughout synthesis. This is in preparation
  for allowing arbitrary imperative code in the dialogue agent [#685].
* Synthesis of dialogues now specifies a policy module, rather than a template
  file as entry point. The policy module instantiates the relevant templates
  and in the future will define the agent policy function [#685].
* Auto-annotation was refactored, and obsolete algorithms were removed [#807].
* Improved support for generating Wikidata question-answering models, with
  new support for using Bootleg to identify the correct entity QID [#813].

## Other changes
* Genie is now fully timezone-aware, and can operate in a timezone different
  from the operating system one. We use the Temporal polyfill library for
  this [#783].
* Templates are now part of the library proper, and no longer distributed as
  a separate bundle [#636].
* It is now possible to translate templates and builtin skills using standard
  gettext tools. Additionally, an initial translated PO file can be obtained
  using machine translation [#738, #810, #815, #817, #825].
* Conversion to Typescript continued, with most of the library now using
  TypeScript.
* ESLint is now enforcing style and indentation on all library files [#811].
* Predictions can now be cached in the local parser client, by providing an
  interface to talk to a caching server [#812].
* Misc bug fixes [#657, #661, #665, #670, #671, #674, #682, #683, #687, #688,
  #690, #692, #694, #720, #726, #729, #758, #759, #760, #766, #777, #790,
  #814, #816, #823, #824, #827, #832].
* Updated dependencies [#640, #643, #646, #650, #659, #672, #675, #680, #735,
  #739, #768, #779, #804, #808, #809, #826].
* Build system and documentation fixes [#647, #754, #822].

0.8.0
=====

* Misc bug fixes [#633].

Please see the previous release for the full list of changes in this
development cycle.

0.8.0-rc.1
==========

* Improved agent templates, so more dialogue states are handled correctly
  by the agent [#629].
* Added support for beam search in prediction [#629].
* Misc bug fixes, many related to handling of multiple devices [#575, #618, #620,
  #621, #625, #626, #627, #628, #630].

Contributors to this release:
- Philip Allgaier
- Sina Semnani

0.8.0-beta.1
============

* Tokenization change: numbers are no longer preprocessed to special tokens.
  Instead they are normalized and left in the sentence. This allows to represent
  commands that have numbers inside quoted strings (e.g. inside song names or
  movie titles) [#492, #573]
* The template system was overhauled to add the ability to produce grammatical
  sentence in the face of arbitrarily complex constraints. This is now used
  to ensure properly grammatical agent sentences, w.r.t to singular and plural,
  without hacks [#542].
* Canonical forms for actions are now treated like implicit primitive templates,
  identically to canonical forms for queries [#546].
* Added linking of tt:device entities, by searching in Thingpedia [#538].
* Added the ability to provide custom help messages for Thingpedia skills, using
  the `#_[help]` class annotation [#538].
* Added a new conversation API to expose the executed ThingTalk programs and their
  raw results. This allows the frontend layers to provide a semantic (graphical)
  representation of the program results, such as charts or interactive widgets [#420].
* Added a new AudioController engine module that coordinates access to audio
  on the speaker device. This is now used to stop playing music when the user
  asks to play news and viceversa [#552].
* Added new card objects to play audios and videos. Audio and sound effect
  card objects are now natively supported on platforms with sound output, and
  can optionally synchronize with each other [#552].
* The `#_[result]` annotation was extended to allow more complex phrases for
  lists with arbitrary length. The default templates for lists were also
  improved to describe lists of results with no common attribute
  [#486, 504, #552, #559, #561, #587].
* Streams and monitors are now fully supported in the dialogue agent. Notifications
  are sent to the chat by default, but the agent can be configured to send
  notifications to SMS or emails [#558, #567, #585].
* Device IDs are now propagated turn-by-turn in dialogues, and multiple devices
  are simulated at training time. This allows to properly support multiple devices
  of the same type [#578].
* Queries can now be implemented lazily using async generators, to reduce
  the number of API calls necessary [#238, #557].
* All commands that were previously part of thingpedia-cli are now part of genie
  directly. This simplifies configuration and reduces dependency skew [#562].
* Added a new "custom" starter code that contains a fully functional local
  environment for developing custom Thingpedia skills and training models [#562].
* Anonymous mode is again fully supported and safe to use in the dialogue agent
  [#567, #571, #585].
* Conversations are now serializable, so the state of the conversation can be
  transferred from one Genie agent to another. This can be used for smooth hand-off
  between anonymous and logged-in context [#585].
* Restored and updated documentation [#553].
* Misc bug fixes [#528, #536, #541, #547, #548, #549, #550, #551, #554, #555,
  #560, #563, #565, #566, #574, #577, #579, #583, #586, #588, #589, #599, #600,
  #602, #603, #607, #609, #610, #611, #613].
* Updated dependencies [#556, #584, #591, #592, #594, #608, #614].

Contributors to this release:
- Ryan Cheng
- Mehrad Moradshahi
- Antonio Muratore
- Sina Semnani
- Silei Xu

0.8.0-alpha.5
=============

* Join templates have been replaced with subqueries, supporting a richer set
  of questions, and compatible with dialogues as well [#530, #543].
* Expanded FAQs [#512]
* Dialogue recordings now include timestamps, for performance analysis [#515].
* Added a dialogue parser that tolerates format errors. This is suitable for
  automatic analysis of recordings [#517].
* Improved the display of times and dates [#520, #526, #537].
* The wake-word is more reliable, as we now use speech-to-text to detect the
  presence of the wake word in case the wake-word model activates spuriously [#519].
* Misc bug fixes [#521, #524, #525, #533].

0.8.0-alpha.4
=============

* Devices are now automatically updated in the background while the
  assistant is running. Currently we check for updates every 3 hours [#510].
* Multiple fixes related to response generation [#498, #499, #502].
* Misc bug fixes [#505, #511].
* Updated dependencies [#506, #508, #509].

0.8.0-alpha.3
=============

* Schema2QA evaluation sets have been fully updated to ThingTalk 2.0 [#472].
* The transaction state machine now asks for "anything else" at the end of a
  conversation [#491, #495].
* Misc bug fixes [#470, #481, #483, #485, #491, #494].

0.8.0-alpha.2
=============

* Improved the default bounds of the random number skill [#475].
* Misc bug fixes [#479, #480].
* Updated dependencies [#477].
* Build system fixes [#482].

0.8.0-alpha.1
=============

This is a large release that culminates more than 5 months of development.
This changelog includes only the major changes. Refer to the git history
for additional details.

* A large portion of the library was converted to TypeScript. This allows
  strict typechecking, which should improve the robustness and API compatibility
  going forward.
* As part of this migration, the recommended package manager is now npm instead
  of yarn, because yarn has problems with dependencies that need a building step.
* The AutoQA template extraction code was rewritten to use a regular
  expression-like pattern matching syntax, which should allow greater extensibility
  in the future.
* Sentence generation was refactored, and made significantly faster with a new
  sampling strategy and constraint-based top-down pruning. Confusing features of
  the template system, like computed non-terminals and placeholder replacement,
  were refactored out and removed.
* The codebase was updated for ThingTalk 2.0. Support for other programming
  languages was removed in light of keeping the codebase lean, but might be
  reintroduced in the future.
* Picture and RDL (link) outputs are again available to Thingpedia skills, as
  a graphical supplement to the voice output on Almond platforms with a graphical
  display.
* Added support for confidence based dispatch. If a suitable GenieNLP model is
  available, the agent will consider parsing confidence when deciding whether
  to act on an input from the user, or dispatch it out to other backends.
* Added support for inference in Kubeflow, which will makes it possible to
  swap out models transparently and scale out model serving resources automatically.
* Added a basic support for certain frequently asked questions in Almond, using
  the builtin skill.
* Lots and lots of bug fixes, too many to list here.

0.7.0
=====

* Added support for area and volume units [#347].
* Misc bug fixes and tuning of the agent policy and replies [#342, #344, #349,
  #350, #355].

0.7.0-rc.2
==========

* Updated documentation for the schema.org starter code [#321].
* Misc bug fixes [#306, #310, #311, #312, #313, #316, #317, #318, #319, #320,
  #322, #324, #327, #331, #333].

0.7.0-rc.1
==========

* Fixed bugs around hyphens and underscores in the tokenizer [#308].
* Fixed several bugs in the dialogue agent runtime [#245, #278, #287, #288,
  #289, #291, #298, #309].

0.7.0-beta.6
============

* The AutoQA/Schema2QA scripts were updated to match the version used in the
  camera-ready version of the Schema2QA paper. This includes more manual
  annotations for the Schema.org domains we experimented with [#282].
* Added templates for imprecise dates and date ranges, such as "this monday"
  or "the 90s" [#282].
* Added templates for recurrent time specifications (used to express opening
  hours) [#282].
* Added templates for argmin/argmax questions in compound commands (e.g.
  "play the most popular song") [#270].
* Added a tool to import Wikidata into an ElasticSearch instance [#271].
* Added a tool to measure the entropy of a training set, for intrinsic
  evaluation of the synthesis process [#270].
* Added a tool to measure how well a training set covers the evaluation set
  [#247].
* Added a tool to subsample a thingpedia.tt file [#270].
* The manual-annotate-dialog tool can now be forced to append to the output
  dataset, even when not editing [#270].
* The evaluate-server script can now operate in "oracle" mode, in which the
  target code is passed to genienlp [#283].
* Added a new #[default] annotation, which provides the implied value of
  an optional parameter. The synthesis ensures that parameters with the
  implied value are not generated, but the value is added to the ThingTalk
  code before execution (and thus can be a relative location or time) [#270].
* Prepositions are now correctly postprocessed for relative times ("today",
  "tomorrow") and locations ("here", "at home") [#270].
* Templates were tuned and rebalanced to improve generation quality in
  multidomain settings [#270].
* Entity linking now correctly calls to the Thingpedia query for ID entities.
  Also, the entity linking code has been made more robust [#264, #270, #276].
* Generation of contractions ("'s", "'re", etc.) was expanded for user
  utterances, and consolidated for agent utterances [#270].
* ThingTalk normalization during evaluation was reimplemented is now
  applied consistently both when evaluating sentence by sentence and when
  evaluating dialogues [#270].
* Pre-execution ThingTalk transformations (device choice, entity linking,
  resolution of relative times and locations) are now applied consistently
  during simulation and during execution [#270].
* Misc bug fixes [#269, #270, #271, #281, #286].
* Added tests [#275, #284]
* Build fixes and dependency updates [#277, #279, #280]
  and new handling

0.7.0-beta.5
============

* Added canonical forms and templates for domain-specific argmin/argmax [#260].
* Expanded templates for projection, with type-appropriate wh- questions [#261].
* Added hooks to the execution environment so devices can be notified when
  a program ends. This can be used to batch the execution of multiple actions
  in the same program [#259].

0.7.0-beta.4
============

* New command: "genie preprocess-string-dataset". Can convert a list of string
  values to a properly formatted TSV string dataset [#255].
* Handling of ID constants in the templates was changed to allow secondary
  entities that appear in a query without a join [#254].
* The templates were reorganized to allow more query+actions compounds to be
  generated at lower depth [#254].
* Actions can now be specified to be executed as a compound command with the
  query, without splitting the query into a separate statement [#254].
* The implementation of action output parameters was finished [#254].
* API users can now keep a conversation alive even after it becomes inactive
  [#256].
* The speech handler has been tested and fixed. Speech support in the demo
  assistant platform (the "genie assistant" command-line tool) has been removed
  [#256, #257].
* The speech handler can now be enabled and disabled at runtime. It was also
  extended to consider screen lock, if screen lock is enabled [#254].
* Added some additional postprocessing for agent replies [#254].
* The "genie auto-annotate" command now accepts a "--batch-size" option, to
  run on smaller GPUs [#258].
* Misc. template fixes and speedups [#254].

0.7.0-beta.3
============

* Extended parameter replacement to measurements, when replacing numbers [#246].
* Added an option to split the evaluation of models by device [#248].
* The template flag "projection_with_filter" was removed and is now treated
  as if it is always set [#250].
* Misc bug fixes [#244, #246, #250, #251].
* Templates were tuned to improve quality on the new version of Thingpedia [#250].
* Updated dependencies [#243, #253].

0.7.0-beta.2
============

* The contextual dialogue model is now unconditionally used by the agent;
  to use a non-contextual model, use Almond 1.* instead [#237].
* Autoannotation is now significantly faster, due to better use of batching when
  calling the pretrained models [#235, #236].
* Parsing and serialization of dialogue datasets is now part of the public API [#241,
* Misc bug fixes [#220, #237, #242].

0.7.0-beta.1
============

* The library is now covered by the Apache 2.0 license, which allows it to
  be used in proprietary applications as well [#208].
* The almond-dialog-agent and thingengine-core library have been merged in
  this repository, which now contains all the code necessary to produce a
  functional dialogue agent. Legacy functionality (including all code to
  support permission control) was removed. An example assistant is provided as
  the command "genie assistant". The example has speech support if the pulseaudio
  library is available. The library API has also been cleaned up, which should
  reduce code duplication between different Almond platforms [#184, #185,
  #187, #189, #192, #196, #197, #217].
* The format of dialogue templates was changed to separate user and agent templates,
  and all dialogue templates were rewritten accordingly. This separation reduces
  duplication as the same agent-only templates are used at inference time by the
  agent. It also allows more fine-grained control of what the agent replies at
  inference time, and it allows the agent to include metadata that controls the
  UI in the reply [#194, #200, #206].
* New command: "auto-annotate". This command will use pretrained language models
  (BERT and BART) to automatically generate the natural language annotations
  associated with a skill [#164, #195, #211, #214].
* Commands formerly prefixed with "webqa-" are now prefixed with "autoqa-" [#186].
* A number of new commands were added, specific to the MultiWOZ dataset [#176].
* It is now possible to specify a different locale for parameters when augmenting
  a dataset. Parameter dataset files must now include the locale of the file [#162].
* Added new templates for Q&A, in particular around projections [#173].
* Added new templates for dialogues, in particular around multidomain dialogues,
  queries that return a single result, queries that have input parameters, and
  actions that need input parameters [#177, #210, #216].
* The almond-tokenizer was replaced with a faster and more precise tokenizer
  implemented in JS. This simplifies the installation of Genie, and simplifies
  deployment of Genie with local NLP instead of remote NLP [#178, #213].
* Skeleton support for more languages was added; this support is still pending
  templates or a training set in the target language [#190].
* PPDB augmentation was removed, as it was ineffective [#179].
* Documentation has been updated, and should now be clearer in how install Genie
  and quickly generate a dataset. "Starter" code is now available in the form
  of Makefiles that can be used to quickly set up Genie for various use cases [#191].
* Misc bug fixes [#162, #164, #174, #176, #181, #183, #199, #205, #207, #212, #234].
* Updated dependencies [#166, #167, #168, #169, #170, #171, #180, #182, #201, #202,
  #203, #209, #218].

0.6.2
=====

* Fix another crash during dataset generation, related to compound types [#161]

0.6.1
=====

* Fix two crashes during dataset generation [#159, #160].

0.6.0
=====

* Schema2QA scripts fully migrated to the new annotation scheme [#144].
* Misc bug fixes [#147, #148].

0.6.0-beta.1
============

* Program normalization during evaluation was improved, which should result in higher
  accuracy and fewer errors due to incorrect evaluation [#139].
* ThingTalk templates for single sentence and dialogues have been merged. This should
  have no impact on downstream users as dialogues are disabled by default, but it will
  allow us to share fixes [#138].
* The "requote" script has been refactored and fixed, and now has a mode where the
  string values are preserved in the sentence, but wrapped in quote marks [#140].
* The performance of template generation (in terms of sentence/sec) has been improved
  significantly, compared to previous unstable releases, and should be on par or better with
  the 0.5 series. This primarily affects dialogue templates, but it should improve
  single-sentence templates too [#142].
* Misc template fixes [#139, #141].

0.6.0-alpha.1
=============

* Introduce the support for programming languages other than ThingTalk.
  New programming languages can be supported by adding the relevant abstraction
  module, and then selecting it when generating data [#123].
* Added the ability to build Q&A skills for structured web data using
  schema.org markup. Genie now includes new subcommands, prefixed with "webqa-",
  which can process structured schema.org markup and produce a Thingpedia
  skill definition and implementation to answer database-style questions [#124, #130, #132, #135].
* Templates for questions were rewritten and expanded, to support a larger
  and more varied set of possible filters [#124].
* Added new command to generate multi-turn dialogue. This command supersedes
  the old "generate-contextual" command, and generates both the first turn and
  the subsequent turn of the dialogue in one shot. The "generate-contextual" command,
  and the associated command "contextualize" are now obsolete and will be removed soon [#129].
* The syntax of contextual templates have been modified, and now there is a single
  tagger function that associates one or more "tags" to each context [#129].
* Added templates for MultiWOZ dialogues. These templates target the intent-and-slot
  representation used in MultiWOZ, and generate multi-turn dialogues [#107].
* Added new templates for multi-turn ThingTalk. These templates support
  single-domain transaction-style dialogues similar to those in MultiWOZ [#129, #137].
* Added support for the new genienlp library, which includes new BERT-based
  semantic parsing and NLU models, yielding significantly higher accuracy [#137].
* Post-processing in the American English was expanded, so models using Genie are
  more robust to inconsistent punctuation and contractions.
* Added HTML templates and tools to help collect manually-annotated validation data
  on MTurk [#124].
* Added a tool to requote a training set, replacing all string spans with entities
  like QUOTED_STRING, LOCATION, etc.
* Added a command to run a simple HTTP server serving a trained Genie model, with
  an API compatible with the Almond NLP API. This allows testing a full-fledged Almond
  against a newly trained Genie model, without deploying Almond Cloud.
* The sampling algorithm used by the synthetic sentence generator was rewritten,
  and it now honors the sampling tunable a lot more closely. It is now possible to
  specify a sampling weight for every template [#129].
* The implementation of the inner-loop of the sentence generation was rewritten
  to allow more optimization by the JS engine, and has now significantly less overhead.
* Misc bug fixes [#117, #118, #119, #125, #128, #134].
* Node 8 is no longer supported. The only supported version of node is 10.*.

0.5.3
=====

* Added support for `defaultTemperature` measurement units, allowing
  the user to use imprecise language around temperature units and have
  them resolved according to their preference [#127].

Contributors:
  Lim Swee Kiat

0.5.2
=====

* Added support for the measurement units added in ThingTalk 1.9.2
* Updated and documented the default flags for ThingTalk [#118]
* Updated Simplified Chinese templates [Jian Li; #116]

0.5.1
=====

* Fixed augmentation to exclude evaluation sentences [#117]
* Fixed evaluation to exclude augmented sentences [#117]
* Misc template fixes [#114, #115]

0.5.0
=====

* Fixed templates for device names [#113]

0.5.0-beta.2
============

* Added the ability to train models in multiple languages, by passing the locale
  to decanlp [#110]
* Misc bug fixes [#111, #112]

0.5.0-beta.1
============

* Added support for referring to devices by name [#108]

0.5.0-alpha.5
=============

* Fix how we use the ThingpediaClient API to be compatible with the latest version
  of the Thingpedia SDK [#102]

0.5.0-alpha.4
=============

* Added templates for contextual references [Jackie Yang; #105]

0.5.0-alpha.3
=============

* manual-annotate now consistently uses surface syntax, and also allows typing
  the code without pressing `t` first [#103].
* evaluation now separates sentences by complexity, in addition to prim vs compound [#103].
* Added an option to generate and generate-contextual to control the pruning size
  of the dataset [#104].
* Added more constants in the example data file, and fixed several bugs in the
  constant sampler [#103].
* Fixed progress bar during generation [#103].
* Misc bug fixes [#103].

0.5.0-alpha.2
=============

* Added the ability to expand primitive templates with more filters
  by matching the canonical form in the utterance [#89].
* Dataset augmentation now runs multiple threads in parallel [#97].
* The timer templates were expanded and are now enabled by default [#79, #98, #101].
* Misc bug fixes [#100].
* Build and dependency fixes [#99].

0.5.0-alpha.1
=============

* Added construct templates for argmin/argmax [Jian Li; #85]
* Added type-specific construct templates for measurements [Jian Li; #90]
* Expanded the set of APIs, making Genie more usable as a library [#87]
* Updated templates for the new features in ThingTalk 1.9 [#92, #93]
* Misc bug fixes [#91, #94]
* Build and dependency fixes [#95]

0.4.1
=====

* DatasetSplitter introduced a specific flag to choose which sentences are
  suitable for evaluation [#84]
* Fixed templates for projections and aggregations [#76, #82, #83]
* Fixed handling of tokenizer disconnections [#86]
* Misc fixes [#77]

0.4.0
=====

* Added a tool to sample constants from string & entity datasets.

Please see the beta version release notes for the full list of changes and
new features in this release.

0.4.0-beta.1
============

Contextual support [#57, #62]:
* Added API to predict based on context.
* Added contextual templates for follow ups, incrementally adding filters, and
  answering slot-filling questions.
* Contextual sentence generation now runs in parallel using multiple threads.
  This requires a version of node compiled with worker support.
* Slot-filling answer in the templates use `bookkeeping(answer())` forms instead
  of generating new programs with the parameter slot-filled.
* Contextual evaluation now tracks "raw" string answers correctly.
* The `sample` and `mturk-validate` commands can now operate in contextual mode,
  to paraphrase contextual datasets.
* New command line tool `manual-annotate-dialog` to interactively annotate dialog
  datasets, while tracking context and answers correctly.
* New command line tool `typecheck` to typecheck a dataset, and optionally interactively
  correct it. The tool is mostly useful when the Thingpedia signatures change.
* Added MTurk template for contextual paraphrasing.

Question-Answering support [#61, #65]:
* The templates now include programs with projections, and the projections are
  preserved.
* Templates now honor the new `#[unique]` parameter annotation in ThingTalk.
* Added support for different grammatical forms of parameter `#_[canonical]` annotation.
* Added experimental templates for "who" questions, based on Wikidata.
* Added several new flags to the templates: `timer`, `projection`, `undefined_filter`,
  `projection_with_filter`, `extended_timers`.

General enhancements:
* The tokenizer client was updated to pass the full locale tag. This requires a recent
  version of almond-tokenizer, and enables distinguishing Simplified and Traditional
  Chinese [#70].
* Templates can now be packed in a self-contained ZIP file, suitable to upload
  to an instance of almond-cloud with enabled luinet. This allows one-click
  generation, training & deployment of Genie/LUInet models [#67].
* Added experimental templates for richer timers. These templates are behind a flag,
  `extended_timers`. [Ricky Grannis-Vu, #66].
* All commands now expect a `thingpedia.tt` file instead of a `thingpedia.json`
  file. The `download-snapshot` command has been updated to download the snapshot
  in ThingTalk format. Entities must be provided separately to the commands that
  need them [#58].
* Augmentation and generation now can track progress, and show a progress bar
  when called without debugging from the command line.
* Added parameter expansion for LOCATION, which soon will not be preprocessed by
  almond-tokenizer [#54].
* Added a new augmentation pass for commands that use a single device, which are
  prefixed with the device name, like in Alexa [#55].
* Fixed location of Los Angeles in the default constant file.
* Fixed parameter expansion to handle joins correctly [#69].
* Fixed support for primitive templates that include projections, aggregations
  and other complex ThingTalk operators [#68].
* Updated dependencies [#56, #59, #60, #63, #71, #79].

0.3.3
=====

* Fix tokenizer ignoring the expected value and not tokenizing locations correctly
  when given as answers

0.3.2
=====

* Fixed construct templates for location after get_gps was moved to @builtin

0.3.1
=====

* Fixed replacing parameters of bookkeeping commands

0.3.0
=====

* Added templates for the ThingTalk bookkeeping language, which includes
  commands such as "yes", "no", "more", "back", etc. [#42]
* Added a tool to preprocess datasets [#40]
* Experimental support for contextual commands (commands whose meaning
  changes based on the previously issued commands) [#5, #6, #43, #44]
* Improved templates for Chinese [#39]
* Added enum translation for Chinese [#35]
* Improved documentation for Internationalization [#40]
* Misc bug fixes [#41, #45, #46]
* Updated dependencies

Contributors in this release:
- Elvis Yu-Jing Lin
- Johnny Hsu

0.2.1
=====

* Pinned dependency `mmap-io` down to a functioning version.
* Fixed `train` command.

0.2.0
=====

* Added support for Simplified and Traditional Chinese. This support is experimental,
  incomplete, and might change in the future.
* Added commands to evaluate the dataset against a running server, or against a file
  of predictions, and compute error analysis
* Added a command to annotate a file by hand; this command brings up an interactive
  command-line UI
* Added command to generate a cheatsheet in PDF form, and mturk pages to collect
  cheatsheet data
* Added decanlp training and evaluation backend
* The tokenization client is now part of the public API
* New construct templates: placeholders ("some X", "something", "some person", etc.)
* Policies, aggregations and remote command templates are now hidden behind a flag
* The parameter replacement augmentation step now requires more fallback parameter
  lists, and will optionally use them even if a more specific list is available
* Synthetic generation and augmentation hyperparameters have been tuned
* Fixed evaluation sets generated by DatasetSplitter [#9]
* Updated dependencies

0.1.0
=====

* First public release
