module.exports = function(app) {
    app.get('/', function(req, res, next) {
        res.render('index', {
            page_title: 'ThingEngine - run your things!',
        });
    });

    app.ws('/client', function(ws, req) {
        console.log('Client connected on websocket');

        var clients = req.app.thingtv.clients;

        ws.on('close', function() {
            var idx = clients.indexOf(ws);
            if (idx >= 0)
                clients.splice(idx, 1);
        });

        clients.push(ws);
    });
}

