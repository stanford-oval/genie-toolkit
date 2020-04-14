# Installation Instructions

Genie is hosted on [NPM](https://npmjs.com). We recommend using [Yarn](https://yarnpkg.com)
as a package manager, to ensure exact compatibility with Genie's dependencies. Genie depends
on nodejs == 10.*.

To use Genie as a command line tool run:
```
yarn global add genie-toolkit
```

After running this, if encounter `command not found`, make sure the Yarn global bin directory
(usually `~/.yarn/bin`) is in your PATH. You can find the path with the command
`yarn global bin`.

## Training

To train a model, genie uses the [Genie NLP](https://github.com/stanford-oval/genienlp) library. To install it, use:
```
pip install genienlp
```

After training, you should also prepare a directory to contain the embeddings.
Then set the path to that directory as the `GENIENLP_EMBEDDINGS` environment variable.
Embeddings will be downloaded automatically the first time genienlp is launched.
If you skip this step, you might find that genienlp redundantly downloads the embeddings multiple times.
