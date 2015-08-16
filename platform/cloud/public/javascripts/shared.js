(function() {
    window.ThingEngine = {};

    ThingEngine.setCloudId = function(cloudId, authToken) {
        if (window.Android !== undefined)
            Android.setCloudId(cloudId, authToken);
        else
            console.log('Setting cloud ID and auth token: ' + cloudId + ',' + authToken);
    };

    ThingEngine.setCloudIdWhenReady = function() {
        $(function() {
            ThingEngine.setCloudId($('#cloud-id').text(),
                                   $('#auth-token').text());
        });
    }
})();
