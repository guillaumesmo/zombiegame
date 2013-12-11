var config = require('./config');
var mysql = require('mysql');
var express = require('express');
var app = express();

// Required by session() middleware
// pass the secret for signed cookies
// (required by session())
app.use(express.cookieParser('secretsecret1234'));

// required for sessions
app.use(express.session());

// required for POST queries
app.use(express.bodyParser());

// required for static files server
app.use(express.static(__dirname + '/public'));

var sqlConnection;

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
    
    sqlConnection.query('SELECT * FROM `users` WHERE `username`=? AND password=md5(?) LIMIT 0,1', [req.body.username, req.body.password], function(err, rows) {
    
        if(err){
            databaseError("/login-ajax (1)", err, res);
            return;
        }
    
        if(rows.length===1){
            req.session.userid = rows[0].id;
            res.json({result: true, userid: req.session.userid});
        } else {
            res.json({result: false, error: 'Bad credentials'});
        }
    });
    
});

app.get('/checklogin-ajax', function(req, res) {
    
    if(!req.session.userid){
        res.json({result: true, logged: false});
        return;
    }
    
    sqlConnection.query('SELECT * FROM `users` WHERE `id`=? LIMIT 0,1', [req.session.userid], function(err, rows) {
        if(err){
            databaseError("/checklogin-ajax (1)", err, res);
            return;
        }
        if(rows.length===1){
            res.json({result: true, logged: true});
        } else {
            delete req.session.userid;
            res.json({result: true, logged: false});
        }
    });
    
});

var serverPort = process.argv[2] ? process.argv[2] : config.defaultPort;
app.listen(serverPort);
console.log('Listening on port ' + serverPort);