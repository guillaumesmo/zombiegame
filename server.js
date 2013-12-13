var config = require('./config');
var Class = require('better-js-class');
var _ = require("underscore");
var haversine = require('haversine');
var mysql = require('mysql');
express = require('express.io');
var app = express().http().io();

// Required by session() middleware
// pass the secret for signed cookies
// (required by session())
app.use(express.cookieParser());

// required for sessions
app.use(express.session({secret: 'notsosecret'}));

// required for POST queries
app.use(express.bodyParser());

// required for static files server
app.use(express.static(__dirname + '/public'));

var sqlConnection;

var onlineusers = {};
var npcs = [];

var Character = Class({
    _init: function() {
        this.icon = 'user';
    },
    getPosition: function(){}
});

var NPC = Class(Character, {
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
    getPosition: function(){
        
        // get the total elapsed distance based on time and speed
        // apply modulo on waypoints length for looping
        var elapsedDistance = ((new Date()-this._startTime)/1000*this._speed)%this._waypointsLength;
        
        // get current waypoint segment and interpolation factor
        var temp = _.reduce(this._waypointsLengths, function(memo, num, index){ if(_.isArray(memo)) return memo;if(elapsedDistance<memo + num) return [index, (elapsedDistance-memo)/num];return memo + num; }, 0)
        
        // apply interpolation between current waypoint and next waypoint and return position
        return [
            this._waypoints[temp[0]][0]+temp[1]*(this._waypoints[temp[0]+1==this._waypoints.length ? 0 : temp[0]+1][0]-this._waypoints[temp[0]][0]),
            this._waypoints[temp[0]][1]+temp[1]*(this._waypoints[temp[0]+1==this._waypoints.length ? 0 : temp[0]+1][1]-this._waypoints[temp[0]][1])
        ];
        
    },
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
    waypointsLengths: function(waypoints){
        
        // calculate great circle distance between every pair of waypoints (including last and first)
        var waypointsLengths=[];
        for(var i=1;i<=waypoints.length;i++){
            waypointsLengths.push(haversine({latitude: waypoints[i-1][0],longitude: waypoints[i-1][1]}, {latitude: waypoints[i==waypoints.length ? 0 : i][0],longitude: waypoints[i==waypoints.length ? 0 : i][1]}, {unit: 'km'})*1000);
        }
        return waypointsLengths;
        
    }
});

var User = Class(Character, {
    _init: function(id, username) {
        this.parent._init.call(this);
        //this.icon = 'user';
        this.id = id;
        this.username = username;
        this.lastposition = 0;
        this.lastpositionsave = 0;
        this.position = null;
    },
    getPosition: function(){
        return this.position;
    },
    setPosition: function(lat, lng){
        this.lastposition = new Date();
        this.position = [lat, lng];
    
        // update the user position in database if it hasn't been done in the last 3 seconds
        if(this.lastpositionsave<(new Date()-3000)){
            sqlConnection.query('UPDATE `users` SET lastposition=POINT(?, ?) WHERE id=?', [this.position[0], this.position[1], this.id], function(err, result) {
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

function reconnectMySql(){
    
    // create a new MySql connection
    sqlConnection = mysql.createConnection(config.mysqlConfig);

    sqlConnection.connect(function(err) {
        if(err) {
            console.log('error when connecting to db:', err);
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
reconnectMySql();

var databaseError = function(where, err, res){
    
    console.log("database error in " + where);
    console.log(err);
    
    // If a client waits for an answer, reply with an error message
    if(res) res.json({result: false, error: 'A database error has occured'});
    
}

app.post('/register-ajax', function(req, res) {
    
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
        
        // check if password and password repeat match
        if(req.body.password!==req.body.password2){
            res.json({result: false, error: 'This passwords don\'t match'});
            return;
        }
        
        // add the user to the database
        sqlConnection.query('INSERT INTO `users` SET username=?, email=?, password=md5(?)', [req.body.username, req.body.email, req.body.password], function(err, result) {
            if(err){
                databaseError("/register-ajax (2)", err, res);
                return;
            }
            res.json({result: true});
        });
        
    });
    
});

app.post('/login-ajax', function(req, res) {
    
    sqlConnection.query('SELECT id, username FROM `users` WHERE `username`=? AND password=md5(?) LIMIT 0,1', [req.body.username, req.body.password], function(err, rows) {
    
        if(err){
            databaseError("/login-ajax (1)", err, res);
            return;
        }
    
        if(rows.length===1){
            req.session.user = {id: rows[0].id, username: rows[0].username};
            res.json({result: true, userid: req.session.user.id});
        } else {
            res.json({result: false, error: 'Bad credentials'});
        }
    });
    
});

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

app.io.route('position', function(req) {
    if(!req.session.user){
        console.log("Got position from unauthentified user");
        return;
    }
    console.log('Position data for user  ' + req.session.user.id + ':', req.data);
    
    // create a memory user instance of not existing
    if(!onlineusers[req.session.user.id]){
        onlineusers[req.session.user.id] = new User(req.session.user.id, req.session.user.username);
        onlineusers[req.session.user.id].setPosition(req.data.coords.latitude, req.data.coords.longitude);
        app.io.broadcast('addmarker', {
            id: 'user' + req.session.user.id,
            pos: [req.data.coords.latitude, req.data.coords.longitude],
            name: req.session.user.username,
            type: 'user'
        });
    }
    
    app.io.broadcast('movemarker', {
        id: 'user' + req.session.user.id,
        pos: [req.data.coords.latitude, req.data.coords.longitude]
    });
    
    req.session.save();
});

app.io.route('getallmarkers', function(req) {
    if(!req.session.user){
        return;
    }
    
    _.each(onlineusers, function(user){
        req.io.emit('addmarker', {
            id: 'user' + user.id,
            pos: user.getPosition(),
            name: user.username,
            type: user.icon
        });
    });
    
    _.each(npcs, function(npc){
        req.io.emit('addmarker', {
            id: 'npc' + npc.id,
            pos: npc.getPosition(),
            name: 'Gargamel',
            type: npc.icon
        });
    });
    
    req.session.save();
});

var npc = new NPC(npcs.length+1);
npc.setWayPoints([[50.8237104023405,4.39504086971283],[50.82376292791699,4.395038187503815],[50.8238171478049,4.395011365413666],[50.82387136762986,4.394965767860413],[50.823905254988496,4.39491480588913],[50.82394253105458,4.394858479499817],[50.823967946537124,4.394799470901489],[50.82399336200583,4.394729733467102],[50.82401369437082,4.39465194940567],[50.824025554912986,4.394566118717194],[50.82403741545212,4.394464194774628],[50.82403741545212,4.394356906414032],[50.824016235915806,4.394162446260452],[50.823984890184455,4.394060522317886],[50.82395269724926,4.393989443778992],[50.82392219865859,4.393918365240097],[50.82387306199839,4.393891543149948],[50.82382561965671,4.393845945596695],[50.82377817726684,4.393829852342606],[50.82368075077931,4.393811076879501],[50.82358756003581,4.3938083946704865],[50.82346810617439,4.393809735774994],[50.82331306985596,4.393807053565979],[50.82321733679025,4.3938083946704865],[50.82311990913243,4.393812417984009],[50.82301146767425,4.393815100193024],[50.82294115003159,4.393819123506546],[50.822869985080594,4.393855333328247],[50.82282423612628,4.393882155418396],[50.822770862289545,4.393939822912216],[50.82273189087818,4.394024312496185],[50.82269291943427,4.394142329692841],[50.82266580884541,4.3942791223526],[50.82265564237053,4.394407868385315],[50.82265903119574,4.394535273313522],[50.82268529458275,4.3946680426597595],[50.822720030007375,4.3947833776474],[50.82276323745075,4.394874572753906],[50.82282254171969,4.394959062337875],[50.822912345183546,4.395023435354233],[50.82299452367365,4.395050257444382],[50.823073313224235,4.395048916339874],[50.82365364076402,4.3950435519218445]]);
npcs.push(npc)

npc = new NPC(npcs.length+1);
npc.setWayPoints([[50.8205740100116,4.394236207008362],[50.82047572959229,4.394166469573975],[50.82027239013701,4.39453661441803],[50.820994241195436,4.395722150802612],[50.8212077442997,4.3961405754089355],[50.821289078558834,4.396371245384216],[50.82144157991284,4.396902322769165],[50.82153646939283,4.397132992744446],[50.82163474757957,4.397245645523071],[50.82189569210608,4.397476315498352],[50.82230913369486,4.397803544998169],[50.822407410255316,4.397937655448914],[50.822702238695555,4.398345351219177],[50.823122450726096,4.398822784423828],[50.82325800218728,4.3989139795303345],[50.82398319582,4.398157596588135],[50.82409502374228,4.397969841957092],[50.82404758162614,4.3977391719818115],[50.823939142322516,4.397342205047607],[50.82394930851794,4.397138357162476],[50.82450844585673,4.396349787712097],[50.82427123689444,4.395861625671387],[50.82416957554167,4.395630955696106],[50.82402047182385,4.395620226860046],[50.82394591978638,4.395577311515808],[50.82391203245727,4.395496845245361],[50.823915421191295,4.395362734794617],[50.823898477518746,4.39527690410614],[50.82383070276706,4.395309090614319],[50.82360026787543,4.395309090614319],[50.82353249269086,4.395411014556885],[50.82309703478331,4.39540833234787],[50.82304111966049,4.395478069782257],[50.82268529458275,4.395470023155212],[50.82255990795682,4.395333230495453],[50.822420965626726,4.395325183868408],[50.82230913369486,4.395196437835693],[50.822078691293676,4.395244717597961],[50.822126135410414,4.395008683204651],[50.82217357947896,4.394659996032715],[50.822193912636415,4.394391775131226],[50.82229218943938,4.393962621688843],[50.822424354468964,4.3933939933776855],[50.8224853535872,4.392964839935303],[50.82251585311643,4.39277708530426],[50.822614129241785,4.39252495765686],[50.82259040743735,4.39227819442749],[50.822614129241785,4.39203143119812],[50.82258362977675,4.391843676567078],[50.822431132152694,4.3914735317230225],[50.82196685854204,4.391870498657227],[50.82190924762604,4.392648339271545],[50.82186858105434,4.392959475517273],[50.82181097001709,4.393104314804077],[50.82170930330737,4.393152594566345],[50.821580525157295,4.393184781074524],[50.82131280102439,4.393222332000732],[50.82102135275487,4.393340349197388],[50.820862072117876,4.393554925918579],[50.82071634680386,4.3937695026397705],[50.82062823360267,4.393930435180664],[50.8205773989879,4.3940430879592896]]);
npcs.push(npc)

setInterval(function(){
    
    _.each(npcs, function(npc){
        app.io.broadcast('movemarker', {
            id: 'npc' + npc.id,
            pos: npc.getPosition()
        });
    });
    
}, 1000);

var serverPort = process.argv[2] ? process.argv[2] : config.defaultPort;
app.listen(serverPort);
console.log('Listening on port ' + serverPort);