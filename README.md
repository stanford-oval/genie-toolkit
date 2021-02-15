# Genie

[![Build Status](https://travis-ci.com/stanford-oval/genie-toolkit.svg?branch=master)](https://travis-ci.com/stanford-oval/genie-toolkit) [![Coverage Status](https://coveralls.io/repos/github/stanford-oval/genie-toolkit/badge.svg?branch=master)](https://coveralls.io/github/stanford-oval/genie-toolkit?branch=master) [![Dependency Status](https://david-dm.org/stanford-oval/genie-toolkit/status.svg)](https://david-dm.org/stanford-oval/genie-toolkit) [![Language grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/stanford-oval/genie-toolkit.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/stanford-oval/genie-toolkit/context:javascript) [![Discord](https://img.shields.io/discord/642041264208085014)](https://discord.gg/anthtR4) [![Discourse status](https://img.shields.io/discourse/https/community.almond.stanford.edu/status.svg)](https://community.almond.stanford.edu)

This repository hosts Genie, a toolkit which allows you to quickly create new semantic
parsers that translate from natural language to a formal language of your choice.

Genie was described in the paper:

_Genie: A Generator of Natural Language Semantic Parsers for Virtual Assistant Commands_  
Giovanni Campagna (\*), Silei Xu (\*), Mehrad Moradshahi, Richard Socher, and Monica S. Lam  
In _Proceedings of the 40th ACM SIGPLAN Conference on Programming Language Design and Implementation_ (PLDI 2019), Phoenix, AZ, June 2019.

If you use Genie in any academic work, please cite the above paper.

## Installation

Genie depends on additional libraries, including the ThingTalk library and the [GenieNLP](https://github.com/stanford-oval/genienlp/) machine learning library.
See [doc/install.md](doc/install.md) for details and installation instructions.

## License

This package is covered by the Apache 2.0 license. See [LICENSE](LICENSE) for details.
Note that this package depends on several nodejs modules by third-parties, each with
their own license. In particular, some modules might have licensing requirements that
are more restrictive than Genie's. It is your responsability to comply with Genie's
copyright license, as well as all licenses of included dependencies.

## Reproducing The Results In Our Papers

To reproduce the machine learning results in Stanford papers that use Genie (including
the PLDI 2019 paper and the ACL 2020 paper), please use the
associated artifacts, available for download from [our website](https://oval.cs.stanford.edu/releases/#section-datasets).
The artifact includes all the necessary datasets (including ablation and case studies), pretrained models
and evaluation scripts. Please follow the instructions in the README file to reproduce individual experiments. 

## Using Genie

### Genie Concepts

Genie is a synthesis-based tool to build dialogue agents. Genie is based on the
_Genie template language_, which succintly defines a space of synthesized sentences.
Genie can use the template language to generate a dataset, then sample a subset of
sentences to paraphrase using crowdsourcing. Commonly, the template language is
paired with a _skill definition_, entered in a repository like [Thingpedia](https://thingpedia.stanford.edu),
which defines the APIs available to the dialogue agent.

### A Turnkey Solution For Genie+Almond

A all-in-one solution to use Genie to extend ThingTalk with new skills and new templates
is provided by [almond-cloud](https://github.com/stanford-oval/almond-cloud).
Please refer to its documentation for installation instructions.

After installation, administrators can create new natural language models,
trigger automated training and deploy the trained models to any Almond system.

### Manual Genie Usage

If one wants to avoid the complexity of setting up a database and web server, it
is possible to invoke Genie manually from the command-line, and have it manipulate
datasets stored as TSV/CSV files.

A number of tutorials are included in the [doc/](doc/index.md) folder, describing
common Genie usage.

NOTE: Genie assumes all files are UTF-8, and ignores the current POSIX locale (LC_CTYPE and LANG
enviornment varialbes). Legacy encodings such as ISO-8859-1 or Big5 are not supported and could
cause problems.

### Modifying ThingTalk

If you want to also extend ThingTalk (with new syntax or new features) you will need to
fork and modify the library, which lives at <https://github.com/stanford-oval/thingtalk>.
After modifying the library, you can use `npm link` to point the almond-cloud installation
to your library. You must make sure that only one copy of the ThingTalk library is loaded
(use `npm ls thingtalk` to check).
