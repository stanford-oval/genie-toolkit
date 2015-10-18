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
                else if (message.command == 'set-state')
                    setState(message.state);
                else
                    console.log('Unknown message ' + message.command);
            } catch(e) {
                console.log('Unable to parse server message: ' + e);
            }
        };
    }
    openSocket();

    var ytPlayer = null;
    function switchTo(url) {
        console.log('Switching to ' + url);
        $('#content').attr('src', url);
        ytPlayer = new YT.Player('content', {
            events: {
                onReady: onReady,
                onStateChange: onStateChange
            }
        });
    }

    function onReady() {}
    function onStateChange(event) {
        // event.data is
        // -1 not started
        // 0 ended
        // 1 playing
        // 2 paused
        // 3 buffering
        // 5 video cued
        // do something
    }

    function setState(state) {
        if (state === 'playing')
            ytPlayer.playVideo();
        else if (state === 'paused')
            ytPlayer.pauseVideo();
    }
});
