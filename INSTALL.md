# Installation Instructions

Genie is hosted on [NPM](https://npmjs.com). We recommend using [Yarn](https://yarnpkg.com)
as a package manager, to ensure exact compatibility with Genie's dependencies. Genie depends
on nodejs >= 8, and it is known to work with nodejs 8.* and 10.* LTS.

To use Genie as a command line tool run:
```
yarn global add genie-toolkit
```

After running this, if encounter `command not found`, make sure the Yarn global bin directory
(usually `~/.yarn/bin`) is in your PATH. You can find the path with the command
`yarn global bin`.

## Training

To train a model, genie uses the [decaNLP](https://github.com/stanford-oval/decaNLP) library. To install it, use:
```
git clone https://github.com/stanford-oval/decaNLP decanlp
cd decanlp
pip install -r requirements.txt
pip install -e .
```

After training, you should also download the following embedding files:

- <https://oval.cs.stanford.edu/data/glove/glove.840B.300d.txt.vectors.npy>
- <https://oval.cs.stanford.edu/data/glove/glove.840B.300d.txt.table.npy>
- <https://oval.cs.stanford.edu/data/glove/glove.840B.300d.txt.itos.npy>
- <https://oval.cs.stanford.edu/data/glove/charNgram.txt.vectors.npy>
- <https://oval.cs.stanford.edu/data/glove/charNgram.txt.table.npy>
- <https://oval.cs.stanford.edu/data/glove/charNgram.txt.itos.npy>

Then set the path to the directory with the downloaded files as the `DECANLP_EMBEDDINGS` environment variable.

If you skip this step, decaNLP will download those embeddings automatically, but you might find that
it redundantly downloads them multiple times.
