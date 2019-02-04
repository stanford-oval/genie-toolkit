%.js : %.yasgg ../tools/meta-sentence-generator/*.js
	node ../tools/meta-sentence-generator $< -o $@
	node -c $@

all : $(patsubst %.yasgg,%.js,$(wildcard *.yasgg) $(wildcard en/*.yasgg))
