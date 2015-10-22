(function() {

    $(function() {


        //add("http://google.com");
        //del("http://google.com");
        //like("http://google.com", 5);
        dislike("http://google.com", 5);
    });

    function dislike(url, cnt) {
        var movie = {
            like: false,
            url: url,
            cnt: cnt,
        }

        $.ajax({
            type: "POST",
            contentType: 'application/json',
            dataType: "text",
            url: '/like',
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

    function like(url, cnt) {
        var movie = {
            like: true,
            url: url,
            cnt: cnt,
        }

        $.ajax({
            type: "POST",
            contentType: 'application/json',
            dataType: "text",
            url: '/like',
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
              console.log("success " + data)
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
              console.log("success " + data)
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.log("ajax error", textStatus, errorThrown);
            }
        });       
    }
})();
