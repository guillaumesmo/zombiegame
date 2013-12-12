var config = require('./config');
var _ = require("underscore");
var mysql = require('mysql');
express = require('express.io')
var app = express().http().io()

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
        onlineusers[req.session.user.id] = {
            id: req.session.user.id,
            username: req.session.user.username,
            lastposition: new Date(),
            lastpositionsave: 0,
            position: req.data.coords
        };
        app.io.broadcast('addmarker', {
            id: 'user' + req.session.user.id,
            lat: req.data.coords.latitude,
            long: req.data.coords.longitude,
            name: req.session.user.username,
            type: 'user'
        });
    }
    
    app.io.broadcast('movemarker', {
        id: 'user' + req.session.user.id,
        lat: req.data.coords.latitude,
        long: req.data.coords.longitude
    });
    
    // update the user position in database if it hasn't been done in the last 3 seconds
    if(onlineusers[req.session.user.id].lastpositionsave<(new Date()-3000)){
        sqlConnection.query('UPDATE `users` SET lastposition=POINT(?, ?) WHERE id=?', [onlineusers[req.session.user.id].position.latitude, onlineusers[req.session.user.id].position.longitude, onlineusers[req.session.user.id].id], function(err, result) {
            if(err){
                databaseError("position", err);
                return;
            }
        });
        // we cant put this inside the mysql callback because a lot of updates would be executed in the meanwhile
        if(onlineusers[req.session.user.id]) onlineusers[req.session.user.id].lastpositionsave=new Date();
    }
    
    req.session.save();
});

app.io.route('getallmarkers', function(req) {
    if(!req.session.user){
        return;
    }
    
    _.each(onlineusers, function(user){
        req.io.emit('addmarker', {
            id: 'user' + user.id,
            lat: user.position.latitude,
            long: user.position.longitude,
            name: user.username,
            type: 'user'
        });
    });
    
    req.session.save();
});

var serverPort = process.argv[2] ? process.argv[2] : config.defaultPort;
app.listen(serverPort);
console.log('Listening on port ' + serverPort);