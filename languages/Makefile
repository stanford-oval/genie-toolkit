%.js : %.yasgg ../lib/genie-compiler/*.js
	node ../lib/genie-compiler $< -o $@
	node -c $@

all : $(patsubst %.yasgg,%.js,$(wildcard *.yasgg) $(wildcard en/*.yasgg))
