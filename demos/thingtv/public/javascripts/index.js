$(function() {
    var retryCount = 0;
    function openSocket() {
        var sock = new WebSocket('ws://127.0.0.1:4444/client', 'thingtv');

        retryCount ++;
        sock.onclose = function() {
            console.log('Connection to server lost');
            if (retryCount < 4)
                setTimeout(openSocket, 10000);
        }

        sock.onopen = function() {
            retryCount = 0;
        }

        sock.onmessage = function(messageEvent) {
            try {
                var message = JSON.parse(messageEvent.data);
                if (message.command == 'switch')
                    switchTo(message.url);
                else
                    console.log('Unknown message ' + message.command);
            } catch(e) {
                console.log('Unable to parse server message: ' + e);
            }
        };
    }
    openSocket();

    function switchTo(url) {
        console.log('Switching to ' + url);
        $('#content').attr('src', url);
    }
});
