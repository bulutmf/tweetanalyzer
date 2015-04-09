/*jshint node:true*/

// app.js
// This file contains the server side JavaScript code for your application.
// This sample application uses express as web application framework (http://expressjs.com/),
// and jade as template engine (http://jade-lang.com/).

var express = require('express');
var passport = require('passport')
var BasicStrategy = require('passport-http').BasicStrategy;
var https = require('https');
var http = require('http');
var Twitter = require('twitter');
var watson = require('watson-developer-cloud');
var fs = require('fs');
var $ = require('jquery')(require("jsdom").jsdom().parentWindow);

// setup middleware
var app = express();
app.use(passport.initialize());
app.use(app.router);
app.use(express.errorHandler());
app.use(express.static(__dirname + '/public')); //setup static public directory
app.set('view engine', 'jade');
app.set('views', __dirname + '/views'); //optional since express defaults to CWD/views


var users = [
{ id: 1, username: 'bob', password: 'secret', email: 'bob@example.com' }
, { id: 2, username: 'joe', password: 'birthday', email: 'joe@example.com' }
];

function findByUsername(username, fn) {
	for (var i = 0, len = users.length; i < len; i++) {
		var user = users[i];
		if (user.username === username) {
			return fn(null, user);
		}
	}
	return fn(null, null);
}
// Use the BasicStrategy within Passport.
// Strategies in Passport require a `verify` function, which accept
// credentials (in this case, a username and password), and invoke a callback
// with a user object.
passport.use(new BasicStrategy({},
	function(username, password, done) {
		// asynchronous verification, for effect...
		process.nextTick(function () {
			// Find the user by username. If there is no user with the given
			// username, or the password is not correct, set the user to `false` to
			// indicate failure. Otherwise, return the authenticated `user`.
			findByUsername(username, function(err, user) {
				if (err) { return done(err); }
				if (!user) { return done(null, false); }
				if (user.password != password) { return done(null, false); }
				return done(null, user);
			})
		});
	}
));



// Twitter credentials
var client = new Twitter({
  consumer_key: process.env['twitter_consumer_key'],
  consumer_secret: process.env['twitter_consumer_secret_key'],
  access_token_key: process.env['twitter_access_token'],
  access_token_secret: process.env['twitter_access_token_secret']
});

var servicesT = JSON.parse(process.env.VCAP_SERVICES || "{}");
// Watson Visual Recognition credentials
var visual_recognition = watson.visual_recognition({
  username: servicesT['visual_recognition'][0]['credentials']['username'],
  password: servicesT['visual_recognition'][0]['credentials']['password'],
  version: 'v1'
});

// Some variables
var queue = []
var QUEUESIZE = 100
var started = false
var classified = {}
var lastTime

// render index page
app.get('/', function(req, res){
	res.render('index');
});

app.get('/graph', function(req, res){
	res.render('graph');
});

app.get('/stats', function(req, res){
	
	var sum = 0;
	for (var key in classified) {
		if (classified.hasOwnProperty(key)) {
			sum += classified[key]
		}
	}

	var response = {'classified': classified, 'sum':sum}
	res.send(response)
	//var temp = {"people":3, "tree":5, "human":7}
	//res.json(temp)
});

app.get('/stream', passport.authenticate('basic', { session: false }), function(req, res){
	var d = new Date()
	lastTime = d.getTime()

	client.stream('statuses/filter', {track: 'NYC',language:'en'}, function(stream) {
	  stream.on('data', function(tweet) {

	  	d = new Date()
	  	if ((d.getTime() - lastTime)/60000 >= 120) {
	  			classified = {}
	  			lastTime = d.getTime()
	  	}

	  	if (tweet.entities != null && tweet.entities.media != null) {
	  		var allMedia = tweet.entities.media
	  		//console.log("Have " + allMedia.length + " media in total for the tweet")
	  		//console.log(allMedia)
	  		for (var i = 0; i < allMedia.length;i++) {
	  			if (allMedia[i].type == 'photo') {
	  				var url = allMedia[i].media_url;
	  				console.log("Adding to the queue... " + url);
	  				if (queue.length < QUEUESIZE) {
	  					queue.unshift(url)
	  				} else {
	  					queue.pop()
	  					queue.unshift(url)
	  				}

	  				if (!started)
	  					startAnalyzing()
	  			}
	  		}
	    }
	  });
	 
	  stream.on('error', function(error) {
	    throw error;
	  });
	});

	res.send("Done!");
});

function startAnalyzing() {
	if (queue.length > 0) {
		started = true
		console.log("Analyzing next, queue length: " + queue.length + " downlading: " + queue[queue.length-1])
		downloadImage(queue.pop())
	} else {
		started = false
	}
}

function downloadImage(url) {
	var dest = "file.jpg"
	var download = function(url, dest, cb) {
	  	var file = fs.createWriteStream(dest);
	  	var request = http.get(url, function(response) {
	    	response.pipe(file);
	    	file.on('finish', function() {
	      		file.close(cb);
	    	});
	  	});
	}

	download(url, dest, function(err) {
		if (err != null) {
			console.log("Error while downloading the file: " + err)
			startAnalyzing()
		} else {
			console.log("Downloaded the the image; now analyzing!")
			analyzeImage(dest)
		}

	});
}

function analyzeImage(fileLoc) {
	var params = {
	  image_file: fs.createReadStream('./' + fileLoc)
	};

	visual_recognition.recognize(params, function(err, res) {
	  if (err) {
	    console.log(err);
	    
	    startAnalyzing()
	    return err;
	} else {
		if (res['images'] != null && res['images'][0] != null && res['images'][0]['labels'] != null) {
			var label = res['images'][0]['labels'][0]['label_name']
		    console.log(label);
		    if (classified[label] == null)
		    	classified[label] = 1
		    else
		    	classified[label] += 1
		}

	    startAnalyzing()

	    return res;
	}});
}

app.get('/alllabels', passport.authenticate('basic', { session: false }), function(req, res){
	
	var response = getAllLabels()
	res.send(response);
});

function getAllLabels() {
	var params = null;
	visual_recognition.labels(params,function(err, res) {
	  if (err) {
	    console.log(err);
	    return err;
	} else {
	    console.log(res);
	    return res;
	}});
}


// Bluemix Twitter Service Test
app.get('/test', passport.authenticate('basic', { session: false }), function(req, res){
	
	var options = {
	  hostname: 'cdeservice.mybluemix.net',
	  auth: servicesT['twitter_insights'][0]['credentials']['username'] + ':' + servicesT['twitter_insights'][0]['credentials']['password'],
	  port: 443,
	  path: '/api/v1/messages/search?q=IBM&size=1',
	  method: 'GET'
	};

	var req = https.request(options, function(res) {
	  console.log("statusCode: ", res.statusCode);
	  //console.log("headers: ", res.headers);

	  res.on('data', function(d) {
	    process.stdout.write(d + "\n");
	  });
	});
	req.end();
	req.on('error', function(e) {
	  console.error(e);
	});

	res.send('hello world!');
});

// Twitter API test
app.get('/tweets', passport.authenticate('basic', { session: false }), function(req, res){
	var params = {screen_name: 'fatih_bulut'};
	client.get('statuses/user_timeline', params, function(error, tweets, response){
	  if (!error) {
	    console.log(tweets);
	    res.send(tweets)
	  }
	});
});

// There are many useful environment variables available in process.env.
// VCAP_APPLICATION contains useful information about a deployed application.
var appInfo = JSON.parse(process.env.VCAP_APPLICATION || "{}");
// TODO: Get application information and use it in your app.

// VCAP_SERVICES contains all the credentials of services bound to
// this application. For details of its content, please refer to
// the document or sample of each service.
var services = JSON.parse(process.env.VCAP_SERVICES || "{}");
// TODO: Get service credentials and communicate with bluemix services.

// The IP address of the Cloud Foundry DEA (Droplet Execution Agent) that hosts this application:
var host = (process.env.VCAP_APP_HOST || 'localhost');
// The port on the DEA for communication with the application:
var port = (process.env.VCAP_APP_PORT || 3000);
// Start server
app.listen(port, host);
console.log('App started on port ' + port);

