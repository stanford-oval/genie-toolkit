(function() {
    LinkedInDemo = {};
    LinkedInDemo.start = function() {
        Omlet.ready(function() {
            document.location.href = '/demos/linkedin?feedId=' + Omlet.scope.feedId;
        });
    };
    LinkedInDemo.exit = function() {
        Omlet.ready(function() {
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
        });
    };
})();
