$(function() {
    function handleDeviceFactory(json) {
        var placeholder = $('#device-placeholder');

        placeholder.empty();

        switch(json.type) {
        case 'message':
            placeholder.append($('<p>').text(json.text));
            break;
        case 'form':
            json.fields.forEach(function(field) {
                var input = $('<input>').addClass('form-control')
                    .attr('type', field.type).attr('name', field.name);
                var label = $('<label>').addClass('control-label').text(field.label);
                var div = $('<div>').addClass('form-group').append(label).append(input);
                placeholder.append(div);
            });
            placeholder.append($('<button>').addClass('btn btn-primary')
                               .attr('type', 'submit').text("Configure"));
            break;
        case 'link':
            placeholder.append($('<p>').append($('<a>').attr('href', json.href).text(json.text)));
            break;
        }
    }

    $('#device-kind').change(function() {
        var val = $('#device-kind').val();
        if (!val) {
            $('#device-placeholder').hide();
            return;
        }

        $('#device-placeholder').show();
        $.get('/devices/factory/' + val, handleDeviceFactory, 'json');
    });

    $('#device-placeholder').hide();

    $('.online-account-choice').each(function() {
        var a = $(this);
        var val = a.attr('data-kind');

        $.get('/devices/factory/' + val, function(json) {
            if (json.type !== 'link') {
                console.log('Online account does not use link factory?');
                return;
            }

            a.attr('href', json.href);
        }, 'json');
    });
});
