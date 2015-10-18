var express = require('express');
var router = express.Router();

var uriFormatters = {
    raw: function(url) {
        return url;
    },

    yt: function(video) {
        return 'https://www.youtube.com/embed/' + video + '?autoplay=1';
    }
};

router.post('/switch-to/:kind/:url', function(req, res, next) {
    var formatter = uriFormatters[req.params.kind];
    if (formatter === undefined) {
        res.status(404).json({ error: 'Invalid format' });
        return;
    }

    var url = formatter(req.params.url);
    req.app.thingtv.clients.forEach(function(client) {
        console.log('Sending command to client');
        client.send(JSON.stringify({ command: 'switch', url: url }));
    });
    res.json({ result: 'ok' });
});

module.exports = router;
