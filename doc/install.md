# Installation Instructions

Genie is hosted on [NPM](https://npmjs.com). We recommend using [Yarn](https://yarnpkg.com)
as a package manager, to ensure exact compatibility with Genie's dependencies. Genie depends
on nodejs == 10.*.

## Option 1: "git" install

This option is recommended for development and command-line usage. 
You need a recent version of Yarn for this.

```bash
git clone https://github.com/stanford-oval/genie-toolkit
cd genie-toolkit
yarn
yarn link
```

This method will install the latest development version of Genie. You can switch
to a different version with `git checkout`. See the [releases page](https://github.com/stanford-oval/genie-toolkit/releases)
for available versions. After you run `git checkout`, make sure to also run
`yarn` to ensure that all dependencies are at the correct version.

After running this, try running "genie --help". If encounter "command not found",
make sure the Yarn global bin directory (usually `~/.yarn/bin`) is in your PATH.
You can find the path with the command `yarn global bin`.

## Option 2: "yarn" install

You can also install Genie using:
```
yarn add genie-toolkit
```

This method will install Genie as a library, not as a command-line tool. It is
suitable for integrating Genie in a larger project (such as Almond).

## Training

To train a model, genie uses the [Genie NLP](https://github.com/stanford-oval/genienlp) library. To install it, use:
```
pip install genienlp
```

After training, you should also prepare a directory to contain the embeddings.
Then set the path to that directory as the `GENIENLP_EMBEDDINGS` environment variable.
Embeddings will be downloaded automatically the first time genienlp is launched.
If you skip this step, you might find that genienlp redundantly downloads the embeddings multiple times.
