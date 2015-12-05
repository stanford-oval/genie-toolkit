(function() {
    window.Demo = {};
    Demo.start = function() {
        Omlet.ready(function() {
            var feedId;
            if (Omlet.scope.feedId)
                feedId = Omlet.scope.feedId;
            else if (Omlet.scope.feed_key)
                feedId = Base64.decode(Omlet.scope.feed_key);

            if (feedId) {
                feedId = Base64.encodeURI(feedId);
                if (location.search)
                    location.href = '/demos/weightcomp' + location.search + '&feedId=' + feedId;
                else
                    location.href = '/demos/weightcomp?feedId=' + feedId;
            }
        });
    };
    Demo.exit = function() {
        var rdl = Omlet.createRDL({
    	    noun: "app",
    	    displayTitle: "Weight Competition!",
    	    //displayThumbnailUrl: movie.thumbnail,
    	    displayText: "Click me to enter the weight competition",
    	    json: {},
    	    webCallback: 'https://thingengine.stanford.edu/demos/linkedin',
    	    callback: 'http://127.0.0.1:3000/demos/linkedin',
	});
        Omlet.exit(rdl);
    };
})();
