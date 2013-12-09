/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

var gameClient = {
    
    init: function(){
        
          
        //$('#loginbutton,#feedbutton').removeAttr('disabled');
        //FB.getLoginStatus(updateStatusCallback);
        
        /*
         * FB.api('/me', function(response) {
                                console.log(response);
                            });
         */
        
        this.loadScreen('login');
    },
    
    currentScreen: null,
    loadScreen: function(name){
        if(this.currentScreen) alert(this.currentScreen);
        alert(name);
        if(this.currentScreen) this.screens[this.currentScreen].cleanup();
        this.screens[name].setup();
        this.currentScreen=name;
    },
    
    screens: {
        'home': {
            setup: function(){
                $('html').css('background', 'url(img/horror.jpg) no-repeat center center fixed')
                    .css('-webkit-background-size', 'cover')
                    .css('-moz-background-size', 'cover')
                    .css('-o-background-size', 'cover')
                    .css('background-size', 'cover');
            },
            cleanup: function(){
                $('html').removeAttr('style');
            }
        }
    }
    
};

