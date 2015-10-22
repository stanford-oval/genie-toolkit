(function() {

    $(function() {


        //add("http://google.com");
        getNext();

        
    });


    function getNext() {
        $.ajax({
            type: "POST",
            contentType: 'application/json',
            dataType: "text",
            url: '/getNext',
            processData: false,
            //data: JSON.stringify(movie),
            success: function (data) {
              //console.log("success " + data);
              var movie = JSON.parse(data);
              var displayString = "next url is " + movie.url + " with " + movie.likeCount + " likes and " + movie.dislikeCount + " dislikes";
              console.log(displayString);
              $('#display').text(displayString);
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
            type: "Get",
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
