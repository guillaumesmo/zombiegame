
var zombieEngine = {
    
    socket: null,
    
    initialize: function(){

        if(!navigator || !navigator.geolocation){
            alert('Unfortunately, geolocation is not enabled on your device');
            return;
        }
        
        // initialize websockets
        this.socket = io.connect();

        // watch for GPS coordinate changes
        navigator.geolocation.watchPosition(function(position){
            
            zombieEngine.socket.emit('position', position);

        }, function(){
            alert('An error has occured while locating you');
        }, {
            enableHighAccuracy: true,
            maximumAge: 5000
        });

        /*socket.on('news', function (data) {
            alert('data');
            console.log(data);
            socket.emit('my other event', { my: 'data' });
        });*/
        
    }
    
}

$(function(){
    
    zombieEngine.initialize();
    
});