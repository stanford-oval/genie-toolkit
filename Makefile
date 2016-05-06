all:
	npm install
	( cd sempre ; ./pull-dependencies core corenlp overnight ; ant core corenlp overnight )

all-nosempre:
	npm install
