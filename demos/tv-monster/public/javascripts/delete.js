(function() {

    $(function() {


        //add("http://google.com");
        del("http://google.com");
    });


    function del(url) {
        var movie = {
            url: url,
        }

        $.ajax({
            type: "POST",
            contentType: 'application/json',
            dataType: "text",
            url: '/delete',
            processData: false,
            data: JSON.stringify(movie),
            success: function (data) {
              console.log("success " + data);
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.log("ajax error", textStatus, errorThrown);
            }
        }); 

    }

    function add(url) {
        console.log("ADD");

        var movie = {
            url: url,
        }

        $.ajax({
            type: "POST",
            contentType: 'application/json',
            dataType: "text",
            url: '/add',
            processData: false,
            data: JSON.stringify(movie),
            success: function (data) {
              console.log("success " + data);
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.log("ajax error", textStatus, errorThrown);
            }
        });       
    }
})();
