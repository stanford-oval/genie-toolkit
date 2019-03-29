# Installation instructions for Genie

Genie is hosted on [NPM](https://npmjs.com). We recommend using [Yarn](https://yarnpkg.com)
as a package manager, to ensure exact compatibility with Genie's dependencies. Genie depends
on nodejs >= 8, and it is known to work with nodejs 8.* and 10.* LTS.

Genie also depends on [genie-parser](https://github.com/Stanford-Mobisocial-IoT-Lab/genie-parser), a semantic
parser written in Python and Tensorflow. Please refer to genie-parser's documentation for installation
instructions.

If you install genie-parser without using `pip`, please set the `GENIE_PARSER_PATH` environment variable to point to
the location where the package is installed.

To use Genie as a command line tool run:
```
yarn global add genie-toolkit
```

After running this, if encounter `command not found`, you can fix this by adding
```
export PATH="$PATH:$(yarn global bin)"
``` 
or add the `yarn global bin` to your PATH in `~/.bash_profile`

<br />

To use Genie as a library in another nodejs project:
```
yarn add genie-toolkit
```
