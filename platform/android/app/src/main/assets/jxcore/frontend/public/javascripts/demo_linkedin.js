(function() {
    window.LinkedInDemo = {};
    LinkedInDemo.start = function() {
        Omlet.ready(function() {
            var feedId;
            if (Omlet.scope.feedId)
                feedId = Omlet.scope.feedId;
            else if (Omlet.scope.feed_key)
                feedId = Base64.decode(Omlet.scope.feed_key);

            if (feedId) {
                feedId = Base64.encodeURI(feedId);
                if (location.search)
                    location.href = '/demos/linkedin' + location.search + '&feedId=' + feedId;
                else
                    location.href = '/demos/linkedin?feedId=' + feedId;
            }
        });
    };
    LinkedInDemo.exit = function() {
        var rdl = Omlet.createRDL({
    	    noun: "app",
    	    displayTitle: "LinkedIn Party!",
    	    //displayThumbnailUrl: movie.thumbnail,
    	    displayText: "Click me to share your LinkedIn info, and see who works in the same field as you",
    	    json: {},
    	    webCallback: 'https://thingengine.stanford.edu/demos/linkedin',
    	    callback: 'http://127.0.0.1:3000/demos/linkedin',
	});
        Omlet.exit(rdl);
    };
})();
