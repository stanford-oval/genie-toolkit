var express = require('express');
var router = express.Router();

if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(x) {
        return this.substr(0, x.length) == x;
    }
}

var urlFormatters = {
    yt: function(video) {
        return 'https://www.youtube.com/embed/' + video + '?autoplay=1&enablejsapi=1&origin=http://127.0.0.1:4444';
    }
};

router.post('/switch-to', function(req, res, next) {
    var body = req.body;
    if (typeof body != 'object') {
        res.status(400).json({ error: 'Bad request' });
    }

    var url;
    var yt = false;
    if (body.url) {
        if (body.url.startsWith('http://www.youtube.com/v/')) {
            url = urlFormatters.yt(body.url.substr('http://www.youtube.com/v/'.length));
            yt = true;
        } else if (body.url.startsWith('http://www.youtube.com/watch?v=')) {
            url = urlFormatters.yt(body.url.substr('http://www.youtube.com/watch?v='.length));
            yt = true;
        } else {
            url = body.url;
        }
    } else if (body.yt) {
        url = urlFormatters.yt(body.yt);
        yt = true;
    } else if (body.youtube) {
        url = urlFormatters.yt(body.youtube);
        yt = true;
    } else {
        res.status(400).json({ error: 'Invalid format' });
        return;
    }

    req.app.thingtv.clients.forEach(function(client) {
        console.log('Sending command to client');
        client.send(JSON.stringify({ command: 'switch', url: url, youtube: yt }));
    });
    res.json({ result: 'ok' });
});

router.post('/set-state/:state', function(req, res, next) {
    req.app.thingtv.clients.forEach(function(client) {
        console.log('Sending command to client');
        client.send(JSON.stringify({ command: 'set-state', state: req.params.state }));
    });
    res.json({ result: 'ok' });
});

module.exports = router;
