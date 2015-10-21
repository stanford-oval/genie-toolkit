(function() {

    $(function() {


        add();
    });


    function add() {
        console.log("ADD");

        var movie = {
            url: "http://google.com",
            likeCount: 0,
            dislikeCount: 0,
        }

        $.ajax({
            type: "POST",
            contentType: 'application/json',
            dataType: "text",
            url: '/add',
            processData: false,
            data: JSON.stringify(movie),
            success: function (data) {
              console.log("success " + data)
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.log("ajax error", textStatus, errorThrown);
            }
        });       
    }
})();
