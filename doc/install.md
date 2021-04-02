# Installation Instructions

Genie is hosted on [NPM](https://npmjs.com), and depends on node >= 12.*.

## Dependencies

The following OS packages are required to build and run Genie:
- node
- a C++ compiler
- GNU make
- gettext
- zip
- GraphicsMagick (only for `genie assistant` command)
- unzip (only for `genie assistant` command)

The following commands can be used to install all the dependencies on common Linux distributions:

```bash
dnf -y install nodejs make gcc-c++ gettext GraphicsMagick zip unzip # Fedora/RHEL
apt -y install nodejs build-essential make g++ gettext graphicsmagick zip unzip # Ubuntu/Debian
```

## Option 1: "git" install

This option is recommended for development and command-line usage. 
You need a recent version of NPM for this.

```bash
git clone https://github.com/stanford-oval/genie-toolkit
cd genie-toolkit
npm install
npm link
```

This method will install the latest development version of Genie. You can switch
to a different version with `git checkout`. See the [releases page](https://github.com/stanford-oval/genie-toolkit/releases)
for available versions. After you run `git checkout`, make sure to also run
`npm install` to ensure that all dependencies are at the correct version.

## Option 2: "npm" install

You can also install Genie using:
```
npm install genie-toolkit
```

This method will install Genie as a library, not as a command-line tool. It is
suitable for integrating Genie in a larger project (such as Almond).

## Training

To train a model, genie uses the [Genie NLP](https://github.com/stanford-oval/genienlp) library. To install it, use:
```bash
pip install 'genienlp>=0.6.0a1'
```

After training, you should also prepare a directory to contain the embeddings.
Then set the path to that directory as the `GENIENLP_EMBEDDINGS` environment variable.
Embeddings will be downloaded automatically the first time genienlp is launched.
If you skip this step, you might find that genienlp redundantly downloads the embeddings multiple times.
