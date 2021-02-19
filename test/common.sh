do_setup() {
	set -e
	set -x
	set -o pipefail

	srcdir=`dirname $0`/..
	srcdir=`realpath $srcdir`

	# make a temporary directory as working directory
	workdir=`mktemp -d genie-XXXXXX`
	workdir=`realpath $workdir`

	on_error() {
	    rm -fr $workdir
	}

	oldpwd=`pwd`
	cd $workdir
}

starter_gen_and_train() {
	starter_name="$1"
	experiment_name="$2"
	shift
	shift

	# set some configuration
	# this uses a testing developer key
	cat > config.mk <<EOF
geniedir = ${srcdir}
developer_key = 88c03add145ad3a3aa4074ffa828be5a391625f9d4e1d0b034b445f18c595656
thingpedia_url = https://dev.almond.stanford.edu/thingpedia
EOF

	# make a dataset (a small one)
	make experiment=${experiment_name} target_pruning_size=10 "$@" datadir

	# train a model (for a few iterations)
	make experiment=${experiment_name} model=small train_iterations=6 train_save_every=2 \
	  train_log_every=2 "$@" train
}
