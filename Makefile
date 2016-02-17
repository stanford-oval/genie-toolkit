all:
	npm install
	( cd sempre ; ./pull-dependencies core corenlp ; ant core corenlp )

all-nosempre:
	npm install
