var express = require('express');
var router = express.Router();

var uriFormatters = {
    raw: function(url) {
        return url;
    },

    yt: function(video) {
        return 'https://www.youtube.com/embed/' + video + '?autoplay=1&origin=http://127.0.0.1:4444';
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
        client.send(JSON.stringify({ command: 'switch', url: url, youtube: req.params.kind === 'yt' }));
    });
    res.json({ result: 'ok' });
});

router.post('/set-state/:state', function(req, res, next) {
    client.send(JSON.stringify({ command: 'set-state', state: req.params.state }));
});

module.exports = router;
