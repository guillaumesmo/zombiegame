// IMPORTS AND INITIALIZATION

var config = require('./config');
var Class = require('better-js-class');
var _ = require("underscore");
var haversine = require('haversine');
var mysql = require('mysql');
express = require('express.io');
var app = express().http().io();
var facebookApi = require('fbgraph');
facebookApi.setAccessToken(config.facebook.appId + '|' + config.facebook.appSecret);
var twitterAPI = require('node-twitter-api');
var twitter = new twitterAPI({
    consumerKey: 'c209uPdGpcZ6ERYy4LfyQ',
    consumerSecret: 'e5ca2NQYztSmvV37icn5lkGexP7vf9edWApqxvV2A',
    callback: 'http://37.252.127.180/map.html'
});

// Required by session() middleware
// pass the secret for signed cookies
// (required by session())
app.use(express.cookieParser());

// required for sessions
app.use(express.session({secret: config.cookiesSecret}));

// required for POST queries
app.use(express.bodyParser());

// required for static files server
app.use(express.static(__dirname + '/public'));


//DECLARATION OF VARIABLES
var sqlConnection; //for sql


var onlineusers = {}; //the active 'real' users on the server


// Superclass for objects on the map
var MapObject = Class({
    _init: function() {
        this.icon = null;
    },
    getPosition: function(){},
    handleCollision: function(object, distance){}
});

// Array of MapObjects
var mapObjects = [];

// Abstract Item class
// These objects respawn regularly and have a fixed position
var Item = Class(MapObject, {
    _init: function() {
        this.parent._init.call(this);
        this.position = null;
    },
    // Get the position
    getPosition: function(){
        return this.position;
    },
    // Set the position
    setPosition: function(lat, lng){    	
        this.position = [lat, lng];        
    },
    handleCollision: function(object, distance){
        if(object instanceof User && distance<10){
            console.log("collision with item", object);
        }
    }
});

var Shield = Class(Item, {
    //Constructor
    _init: function(id) {
        this.parent._init.call(this);
        this.icon = 'shield';
        this.id = id;		
    }
})

var Radar = Class(Item, {
    //Constructor
    _init: function(id) {
        this.parent._init.call(this);
        this.icon = 'radar';
        this.id = id;
    }
})

var Needle = Class(Item, {
    //Constructor
    _init: function(id) {
        this.parent._init.call(this);
        this.icon = 'needle';
        this.id = id;
    }
})

//NON-PLAYING-CHARACTER CLASS
var NPC = Class(MapObject, {
	
    //Constructor
    _init: function(id) {
        
        this.parent._init.call(this);
        this.icon = 'zombie';
        this.id = id;
        this._waypoints=[[0, 0], [0, 0]];
        this._waypointsLengths=[1, 1];
        this._waypointsLength=2;
        this._speed = 5; // 5m/s
        this._startTime = new Date();
        
    },
    //Get the position of the NPC
    getPosition: function(){
        
        // get the total elapsed distance based on time and speed
        // apply modulo on waypoints length for looping
        var elapsedDistance = ((new Date()-this._startTime)/1000*this._speed);
        
        // get current waypoint segment and interpolation factor
        var temp = this.getCurrentWayPoint(elapsedDistance);
        
        // apply interpolation between current waypoint and next waypoint and return position
        return [
            this._waypoints[temp[0]][0]+temp[1]*(this._waypoints[temp[0]+1==this._waypoints.length ? 0 : temp[0]+1][0]-this._waypoints[temp[0]][0]),
            this._waypoints[temp[0]][1]+temp[1]*(this._waypoints[temp[0]+1==this._waypoints.length ? 0 : temp[0]+1][1]-this._waypoints[temp[0]][1])
        ];
        
    },
    //Returns an array containing the index of the current waypoint and an 
    //interpolation factor [0, 1[ between current waypoint and next waypoint
    getCurrentWayPoint: function(elapsedDistance){
        
        // apply modulo on waypoints length for looping
        // elapsedDistance = [0, this._waypointsLength[
        elapsedDistance = elapsedDistance%this._waypointsLength;
        
        var totalLength = 0;
        // loop over waypoint lengths until totalLength > elapsedDistance
        for(var i=0;i<this._waypointsLengths.length;i++){
            if(totalLength + this._waypointsLengths[i] > elapsedDistance)
                return [i, (elapsedDistance-totalLength)/this._waypointsLengths[i]];
            totalLength += this._waypointsLengths[i];
        }
        
        // we should never reach this code ( because [0, this._waypointsLength[ )
        console.log(new Date(), 'error in getCurrentWayPoint');
        console.log('elapsedDistance', elapsedDistance);
        console.log('this._waypointsLengths', this._waypointsLengths);
        return [0, 0];
        
    },
    //Set the list of waypoint (when making the waypoint graph)
    setWayPoints: function(waypoints){
        
        var waypointsLengths = this.waypointsLengths(waypoints);
        var waypointsLength = _.reduce(waypointsLengths, function(memo, num){ return memo + num; }, 0);
        
        // check if length is non-zero
        if(waypointsLength > 0){
            this._waypoints = waypoints;
            this._waypointsLengths = waypointsLengths;
            this._waypointsLength = waypointsLength;
        }
    },
    //return the length of a certain waypoint
    waypointsLengths: function(waypoints){
        
        // calculate great circle distance between every pair of waypoints (including last and first)
        var waypointsLengths=[];
        for(var i=1;i<=waypoints.length;i++){
            waypointsLengths.push(haversine({latitude: waypoints[i-1][0],longitude: waypoints[i-1][1]}, {latitude: waypoints[i==waypoints.length ? 0 : i][0],longitude: waypoints[i==waypoints.length ? 0 : i][1]}, {unit: 'km'})*1000);
        }
        return waypointsLengths;
        
    }
});

//PLAYING CHARACTER CLASS = USER
var User = Class(MapObject, {
    //Constructor
    _init: function(id, username) {
        this.parent._init.call(this);
        this.icon = 'user';
        this.id = id;
        this.username = username;
        this.lastposition = 0;
        this.lastpositionsave = 0;
        this.position = null;
    },
    //Get the position
    getPosition: function(){
        return this.position;
    },
    //Set the position
    setPosition: function(lat, lng){
        this.lastposition = new Date();
        this.position = [lat, lng];
    
        // update the user position in database if it hasn't been done in the last 3 seconds
        if(this.lastpositionsave<(new Date()-3000)){
            sqlConnection.query('UPDATE `users` SET lastposition=POINT(?, ?) WHERE id=?', [this.position[1], this.position[0], this.id], function(err, result) {
                if(err){
                    databaseError("position", err);
                    return;
                }
            });
            // we can't put this inside the mysql callback because other updates could be executed in the meanwhile
            this.lastpositionsave=new Date();
        }
        
    }
});


//FUNCTION INITIALIZE/RECONNECT TO MySQL
function reconnectMySql(){
    
    // create a new MySql connection
    sqlConnection = mysql.createConnection(config.mysqlConfig);

    sqlConnection.connect(function(err) {
        if(err) {
            console.log(new Date(), 'error when connecting to db:', err);
            // We introduce a delay before attempting to reconnect,
            // to avoid a hot loop, and to allow our node script to
            // process asynchronous requests in the meantime.
            setTimeout(reconnectMySql, 2000); 
        }                                     
    });
    
    sqlConnection.on('error', function(err) {
        databaseError('-', err);
        if(err.code === 'PROTOCOL_CONNECTION_LOST') {
            reconnectMySql();
        } else {
            throw err;
        }
    });
    
}
//Immediately run the function when starting the server to create connection
reconnectMySql(); 

//MySQL error-function
var databaseError = function(where, err, res){
    
    console.log(new Date(), "database error in " + where);
    console.log(err);
    
    // If a client waits for an answer, reply with an error message
    if(res) res.json({result: false, error: 'A database error has occured'});
    
}

//FUNCTION To get the facebook id
function getFacebookId(access_token, callback){
    
    facebookApi.get('/me?fields=permissions,email,name&access_token=' + access_token, function(err, res) {
        if(err){
            console.log(new Date(), "facebook error");
            console.log(err);
        } else {
            console.log(new Date(), "facebook data");
            console.log(res);
        }
        callback(res && res.id ? res.id : null);
    });
    
}

//TWITTER
/*
twitter.search("show", {
        q: "%23zombies"
    },
    '2249501814-zttWztoGdDxd9jLkWhkrtYlkObMSPOf5gleQ2nx', // access token
    '3JqLl7fVCmXKQ8f2P7DJoPdBn7YeULFAjsuP3XKmS1eit', // access token secret
    function(error, data, response) {
        if (error) {
            // something went wrong
        } else {
            // data contains the data sent by twitter
        }
    }
);
*/

// REGISTER HELPER FUNCTION
function commonRegister(req, res, callback){
    
    sqlConnection.query('SELECT `id` FROM `users` WHERE `username`=? LIMIT 0,1', req.body.username, function(err, rows) {
        
        if(err){
            databaseError("/register-ajax (1)", err, res);
            return;
        }
        
        // check if an existing user has been returned from the database
        if(rows.length!==0){
            res.json({result: false, error: 'This username is already taken'});
            return;
        }
        
        callback();
        
    });
    
}

//ROUTE TO REGISTER (using express)
app.post('/register-ajax', function(req, res) {
    
    commonRegister(req, res, function() {
        
        // check if password and password repeat match
        if(req.body.password!==req.body.password2){
            res.json({result: false, error: 'This passwords don\'t match'});
            return;
        }
        
        // add the user to the database
        sqlConnection.query('INSERT INTO `users` SET auth="normal", username=?, email=?, password=md5(?)', [req.body.username, req.body.email, req.body.password], function(err, result) {
            if(err){
                databaseError("/register-ajax (2)", err, res);
                return;
            }
            console.log(new Date(), "User " + req.body.username + " registered successfully");
            res.json({result: true});
        });
        
    });
    
});

//ROUTE TO REGISTER VIA FACEBOOK (using express)
app.post('/register-facebook-ajax', function(req, res) {
    
    commonRegister(req, res, function() {
        
        getFacebookId(req.body.accesstoken, function(facebookId){
        
            // check if password and password repeat match
            if(!facebookId){
                res.json({result: false, error: 'There is an error with the facebook login'});
                return;
            }
        
            // add the user to the database
            sqlConnection.query('INSERT INTO `users` SET auth="facebook", username=?, email=?, facebook_id=?', [req.body.username, req.body.email, facebookId], function(err, result) {
                if(err){
                    databaseError("/register-facebook-ajax", err, res);
                    return;
                }
                console.log(new Date(), "User " + req.body.username + " registered successfully with facebook");
                res.json({result: true});
            });
        
        });
        
    });    
});

function loginCallback(rows, req){
    
    console.log(new Date(), "User " + rows[0].username + " logged in successfully");
    req.session.user = {id: rows[0].id, username: rows[0].username};
    
};

//ROUTE TO LOGIN (using express)
app.post('/login-ajax', function(req, res) {
    
    sqlConnection.query('SELECT id, username FROM `users` WHERE `username`=? AND password=md5(?) LIMIT 0,1', [req.body.username, req.body.password], function(err, rows) {
    
        if(err){
            databaseError("/login-ajax (1)", err, res);
            return;
        }
    
        if(rows.length===1){
            loginCallback(rows, req);
            res.json({result: true, userid: req.session.user.id});
        } else {
            res.json({result: false, error: 'Bad credentials'});
        }
    });
    
});

//ROUTE TO LOGIN (using express)
app.get('/login-facebook', function(req, res) {
    
    if(!req.query.access_token){
        // redirect him to the homepage
        res.redirect('/');
        return;
    }
    
    getFacebookId(req.query.access_token, function(facebookId){
    
        if(!facebookId){
            // redirect him to the homepage
            res.redirect('/');
            return;
        }
        sqlConnection.query('SELECT * FROM `users` WHERE `auth`="facebook" AND `facebook_id`=? LIMIT 0,1', facebookId, function(err, rows) {
            if(err){
                databaseError("/login-facebook", err, res);
                return;
            }
            if(rows.length===1){
                loginCallback(rows, req);
                res.redirect('/map.html');
            } else {
                res.redirect('/register_facebook.html?access_token=' + req.query.access_token);
            }
        });
        
    });
    
});

//ROUTE TO LOGOUT (using express) = delete the current user's session.
app.get('/logout', function(req, res) {
    
    if(req.session.user){
        console.log(new Date(), "User " + req.session.user.username + " logged out");
        // remove the user session
        delete req.session.user;
    }
    
    // redirect him to the homepage
    res.redirect('/');
    
});

//ROUTE TO CHECK LOG-IN (using express) = checks whether user is already logged in to redirect to the game
app.get('/checklogin-ajax', function(req, res) {
    
    if(!req.session.user){
        res.json({result: true, logged: false});
        return;
    }
    
    sqlConnection.query('SELECT * FROM `users` WHERE `id`=? LIMIT 0,1', [req.session.user.id], function(err, rows) {
        if(err){
            databaseError("/checklogin-ajax (1)", err, res);
            return;
        }
        if(rows.length===1){
            res.json({result: true, logged: true});
        } else {
            delete req.session.user;
            res.json({result: true, logged: false});
        }
    });
    
});

//ROUTE TO SEND THE POSITION OF A USER (using socket.io)
app.io.route('position', function(req) {
    if(!req.session.user){
        //console.log(new Date(), "Got position from unauthentified user");
        return;
    }
    if(!req.data.coords || !req.data.coords.latitude || !req.data.coords.longitude){
        //console.log(new Date(), "Invalid data");
        return;
    }
    //console.log('Position data for user  ' + req.session.user.id + ':', req.data);
    
    // create a memory user instance if not existing
    if(!onlineusers[req.session.user.id]){
        onlineusers[req.session.user.id] = new User(req.session.user.id, req.session.user.username);
        onlineusers[req.session.user.id].setPosition(req.data.coords.latitude, req.data.coords.longitude);
        req.session.user.markerId = mapObjects.length;
        mapObjects.push(onlineusers[req.session.user.id]);
        app.io.broadcast('addmarker', {
            id: 'object' + req.session.user.markerId,
            pos: [req.data.coords.latitude, req.data.coords.longitude],
            name: req.session.user.username,
            type: 'user'
        });	
    }
    // finally move the marker and broadcast it to all clients
    mapObjects[req.session.user.markerId].setPosition(req.data.coords.latitude, req.data.coords.longitude);
    app.io.broadcast('movemarker', {
        id: 'object' + req.session.user.markerId,
        pos: [req.data.coords.latitude, req.data.coords.longitude]
    });
    
    req.session.save();
});

//ROUTE TO GET ALL THE MARKERS (using socket.io)
app.io.route('getallmarkers', function(req) {
    if(!req.session.user){
        return;
    }
    
    _.each(mapObjects, function(object, index){
        var name = "";
        if(object instanceof User)
            name = object.username;
        req.io.emit('addmarker', {
            id: 'object' + index,
            pos: object.getPosition(),
            name: name,
            type: object.icon
        });
    });
    
    req.session.save();
});

//CREATE SOME SHIELDS
var shieldRange = 0.004;

var shield = new Shield();
shield.setPosition(50.8228 + ((Math.random() * (shieldRange))-shieldRange/2) , 4.395 + ((Math.random() *(shieldRange))-shieldRange/2) );
mapObjects.push(shield);

shield = new Shield();
shield.setPosition(50.8228 + ((Math.random() * (shieldRange))-shieldRange/2) , 4.395 + ((Math.random() *(shieldRange))-shieldRange/2) );
mapObjects.push(shield);

shield = new Shield();
shield.setPosition(50.8228 + ((Math.random() * (shieldRange))-shieldRange/2) , 4.395 + ((Math.random() *(shieldRange))-shieldRange/2) );
mapObjects.push(shield);


//CREATE SOME RADARS
var radarRange = 0.004;

var radar = new Radar();
radar.setPosition(50.8228 + ((Math.random() * (radarRange))-radarRange/2) , 4.395 + ((Math.random() *(radarRange))-radarRange/2) );
mapObjects.push(radar);

//CREATE SOME NEEDLES
var needleRange = 0.004;

var needle = new Needle();
needle.setPosition(50.8228 + ((Math.random() * (needleRange))-needleRange/2) , 4.395 + ((Math.random() *(needleRange))-needleRange/2) );
mapObjects.push(needle);

needle = new Needle();
needle.setPosition(50.8228 + ((Math.random() * (needleRange))-needleRange/2) , 4.395 + ((Math.random() *(needleRange))-needleRange/2) );
mapObjects.push(needle);




// CREATE TWO DEFAULT BOTS WITH DEFAULT PATHS
var npc = new NPC();
npc.setWayPoints([[50.8237104023405,4.39504086971283],[50.82376292791699,4.395038187503815],[50.8238171478049,4.395011365413666],[50.82387136762986,4.394965767860413],[50.823905254988496,4.39491480588913],[50.82394253105458,4.394858479499817],[50.823967946537124,4.394799470901489],[50.82399336200583,4.394729733467102],[50.82401369437082,4.39465194940567],[50.824025554912986,4.394566118717194],[50.82403741545212,4.394464194774628],[50.82403741545212,4.394356906414032],[50.824016235915806,4.394162446260452],[50.823984890184455,4.394060522317886],[50.82395269724926,4.393989443778992],[50.82392219865859,4.393918365240097],[50.82387306199839,4.393891543149948],[50.82382561965671,4.393845945596695],[50.82377817726684,4.393829852342606],[50.82368075077931,4.393811076879501],[50.82358756003581,4.3938083946704865],[50.82346810617439,4.393809735774994],[50.82331306985596,4.393807053565979],[50.82321733679025,4.3938083946704865],[50.82311990913243,4.393812417984009],[50.82301146767425,4.393815100193024],[50.82294115003159,4.393819123506546],[50.822869985080594,4.393855333328247],[50.82282423612628,4.393882155418396],[50.822770862289545,4.393939822912216],[50.82273189087818,4.394024312496185],[50.82269291943427,4.394142329692841],[50.82266580884541,4.3942791223526],[50.82265564237053,4.394407868385315],[50.82265903119574,4.394535273313522],[50.82268529458275,4.3946680426597595],[50.822720030007375,4.3947833776474],[50.82276323745075,4.394874572753906],[50.82282254171969,4.394959062337875],[50.822912345183546,4.395023435354233],[50.82299452367365,4.395050257444382],[50.823073313224235,4.395048916339874],[50.82365364076402,4.3950435519218445]]);
mapObjects.push(npc)

npc = new NPC();
npc.setWayPoints([[50.8205740100116,4.394236207008362],[50.82047572959229,4.394166469573975],[50.82027239013701,4.39453661441803],[50.820994241195436,4.395722150802612],[50.8212077442997,4.3961405754089355],[50.821289078558834,4.396371245384216],[50.82144157991284,4.396902322769165],[50.82153646939283,4.397132992744446],[50.82163474757957,4.397245645523071],[50.82189569210608,4.397476315498352],[50.82230913369486,4.397803544998169],[50.822407410255316,4.397937655448914],[50.822702238695555,4.398345351219177],[50.823122450726096,4.398822784423828],[50.82325800218728,4.3989139795303345],[50.82398319582,4.398157596588135],[50.82409502374228,4.397969841957092],[50.82404758162614,4.3977391719818115],[50.823939142322516,4.397342205047607],[50.82394930851794,4.397138357162476],[50.82450844585673,4.396349787712097],[50.82427123689444,4.395861625671387],[50.82416957554167,4.395630955696106],[50.82402047182385,4.395620226860046],[50.82394591978638,4.395577311515808],[50.82391203245727,4.395496845245361],[50.823915421191295,4.395362734794617],[50.823898477518746,4.39527690410614],[50.82383070276706,4.395309090614319],[50.82360026787543,4.395309090614319],[50.82353249269086,4.395411014556885],[50.82309703478331,4.39540833234787],[50.82304111966049,4.395478069782257],[50.82268529458275,4.395470023155212],[50.82255990795682,4.395333230495453],[50.822420965626726,4.395325183868408],[50.82230913369486,4.395196437835693],[50.822078691293676,4.395244717597961],[50.822126135410414,4.395008683204651],[50.82217357947896,4.394659996032715],[50.822193912636415,4.394391775131226],[50.82229218943938,4.393962621688843],[50.822424354468964,4.3933939933776855],[50.8224853535872,4.392964839935303],[50.82251585311643,4.39277708530426],[50.822614129241785,4.39252495765686],[50.82259040743735,4.39227819442749],[50.822614129241785,4.39203143119812],[50.82258362977675,4.391843676567078],[50.822431132152694,4.3914735317230225],[50.82196685854204,4.391870498657227],[50.82190924762604,4.392648339271545],[50.82186858105434,4.392959475517273],[50.82181097001709,4.393104314804077],[50.82170930330737,4.393152594566345],[50.821580525157295,4.393184781074524],[50.82131280102439,4.393222332000732],[50.82102135275487,4.393340349197388],[50.820862072117876,4.393554925918579],[50.82071634680386,4.3937695026397705],[50.82062823360267,4.393930435180664],[50.8205773989879,4.3940430879592896]]);
mapObjects.push(npc)

// SEND THEIR POSITION TO CLIENTS EVERY SECOND
setInterval(function(){
    
    _.each(mapObjects, function(object, index){
        if(object instanceof NPC)
            app.io.broadcast('movemarker', {
                id: 'object' + index,
                pos: object.getPosition()
            });
    });
    
}, 1000);

// HANDLE COLLISIONS
setInterval(function(){
    
    var i=mapObjects.length;
    
    // the following construction pairs every element with every other element once (unordered)
    while(i--){
        var j = i;
        while(j--){
            
            // calculate the distance (in meters)
            var position1 = mapObjects[i].getPosition();
            var position2 = mapObjects[j].getPosition();
            var distance = haversine({latitude: position1[0],longitude: position1[1]}, {latitude: position2[0],longitude: position2[1]}, {unit: 'km'})*1000;
            
            // handle when object 1 collides with object 2
            mapObjects[i].handleCollision(mapObjects[j], distance);
            
            // handle when object 2 collides with object 1
            mapObjects[j].handleCollision(mapObjects[i], distance);
            
        }
    }
    
}, 1000);


var serverPort = process.argv[2] ? process.argv[2] : config.defaultPort;
app.listen(serverPort);
console.log(new Date(), 'Listening on port ' + serverPort);
