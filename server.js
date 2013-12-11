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

var sqlConnection = mysql.createConnection({
    host     : 'localhost', 
    user     : 'root', 
    password : 'mysql', 
    database : 'zombiegame_db'
})

var databaseError = function(where, err){
    res.json({result: false, error: 'A database error has occured'});
    console.log("database error in " + where);
    console.log(err);
}

app.post('/register-ajax', function(req, res) {
    
    sqlConnection.query('SELECT `id` FROM `users` WHERE `username`=? LIMIT 0,1', req.body.username, function(err, rows) {
        if(err){
            databaseError("/register-ajax (1)", err);
            return;
        }
        if(rows.length===0){
            if(req.body.password===req.body.password2){
                sqlConnection.query('INSERT INTO `users` SET username=?, email=?, password=md5(?)', [req.body.username, req.body.email, req.body.password], function(err, result) {
                    if(err){
                        databaseError("/register-ajax (2)", err);
                        return;
                    }
                    res.json({result: true});
                });
            } else {
                res.json({result: false, error: 'This passwords don\'t match'});
            }
        } else {
            res.json({result: false, error: 'This username is already taken'});
        }
    });
    
});

app.post('/login-ajax', function(req, res) {
    
    sqlConnection.query('SELECT * FROM `users` WHERE `username`=? AND password=md5(?) LIMIT 0,1', [req.body.username, req.body.password], function(err, rows) {
    
        if(err){
            databaseError("/login-ajax (1)", err);
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
            databaseError("/checklogin-ajax (1)", err);
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

var serverPort = process.argv[2] ? process.argv[2] : 80;
app.listen(serverPort);
console.log('Listening on port ' + serverPort);