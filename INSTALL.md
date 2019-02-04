# Installation instructions for Genie

Genie is hosted on [NPM](https://npmjs.com). We recommend using [Yarn](https://yarnpkg.com)
as a package manager, to ensure exact compatibility with Genie's dependencies. Genie depends
on nodejs >= 8, and it is known to work with nodejs 8.* and 10.* LTS.

Genie also depends on [luinet](https://github.com/Stanford-Mobisocial-IoT-Lab/luinet), a semantic
parser written in Python and Tensorflow. Please refer to luinet's documentation for installation
instructions.

If you install luinet without using `pip`, please set the `LUINET_PATH` environment variable to point to
the location where the package is installed.

To use Genie as a command line tool run:
```
yarn global add genie-tool
```

To use Genie as a library in another nodejs project:
```
yarn add genie-tool
```
