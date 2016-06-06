var randomstring = require('randomstring');
var express = require('express');
var bodyParser = require('body-parser');
var fs = require('fs');
var http = require('http');

var Controller = require('./controller');
var config = require('./config');
var jwt = require('jsonwebtoken');

var Client = require('node-rest-client').Client;

var client = new Client();

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));


var isHealthy = false;
var isIntegrationInfoWrittenInFile = false;
var publicKey = null;
var lambda_config = {};

var controller = new Controller(process.cwd(), function(err){
    isHealthy = !err;
});


// this endpoint only used by marathon
app.get('/health', function (request, response) {
    if (isHealthy)
        response.sendStatus(200);
    else
        response.sendStatus(400);
});


app.post('/:functionName', function (httpRequest, httpResponse) {
    var fnName = httpRequest.params.functionName;
    // use it if u want to test it with ab  cause requestId must be different for concurrent requests
    var requestId = randomstring.generate();
    //var requestId = httpRequest.body.requestId;
    var lambdaHeaders = config.lambdaHeaders || "";
    var functionName = fnName;
    var functionVersion = lambda_config[fnName].functionVersion;
    var functionCdnAddress = null ;
    var handlerName = lambda_config[fnName].handlerName || 'index.handler';
    var timeLimit = lambda_config[fnName].timeLimitInMilliSeconds || 3000;
    var memoryLimit = lambda_config[fnName].memoryLimit || 0;
    var userId = httpRequest.body.userId;
    var userName = httpRequest.body.userName;
    var authenticationId = httpRequest.body.authenticationId;
    var keyType = httpRequest.body.keyType;
    var event = httpRequest.body;
    var functionPath =  controller.functionsDir;

    var contentType = httpRequest.headers['content-type'];
    var authorization = httpRequest.headers['authorization'];
    var userId = null;
    var userName = null;
    var keyType = null;
    if(authorization != null) {
        jwt.verify(authorization.split(" ")[1], publicKey, function (err, decoded) {
            userId = decoded.user_id;
            userName = decoded.user_name;
            keyType = decoded.scope[0];
        });
    }

    isRequestValid(contentType, requestId, functionName, functionVersion, functionCdnAddress, handlerName, function(err) {
       if (err) {
           myLogger.log(err);
           httpResponse.send(createOutput(requestId, handlerName, {status: config.statusCodes.BAD_REQUEST}));
       } else {

           if (!isIntegrationInfoWrittenInFile) {
               var stream = fs.createWriteStream("integrationInfo.json");
               stream.once('open', function(fd) {
                   var content = {"integratedInstances":[{"id": config.authInstanceId ,"type":"auth"},
                       {"id": config.objectSorageInstanceId ,"type":"object-storage"},
                       {"id": config.gameInstanceId ,"type":"game"}]};
                   content.integratedMasterKey = config.integratedMasterKey;
                   stream.write(JSON.stringify(content, null, 4));
                   stream.end();
                   isIntegrationInfoWrittenInFile = true;
                   controller.runRequest(requestId, lambdaHeaders, functionName, functionVersion, functionCdnAddress,
                       handlerName, timeLimit, memoryLimit, userId, userName, authenticationId,
                       keyType, functionPath, lambda_config, event, function(result) {
                           //myLogger.log(result);
                           httpResponse.writeHead(200, {'Content-Type': 'application/json'});
                           httpResponse.write(JSON.stringify(result));
                           httpResponse.end();
                       });
               });
           }
           else {
               controller.runRequest(requestId, lambdaHeaders, functionName, functionVersion, functionCdnAddress,
                   handlerName, timeLimit, memoryLimit, userId, userName, authenticationId, keyType,
                   functionPath, lambda_config,event, function(result) {
                       //myLogger.log(result);
                       httpResponse.writeHead(200, {'Content-Type': 'application/json'});
                       httpResponse.write(JSON.stringify(result));
                       httpResponse.end();

                   });
           }



       }
    });

});

var isRequestValid = function (contentType, requestId, functionName, functionVersion, functionCdnAddress, handlerName, callback) {
    if (!contentType || contentType.indexOf('application/json') !== 0) {
        callback("bad content type");
    } else if (!requestId || !functionName || !functionVersion  || !handlerName || !isHandlerNameValid(handlerName)) {
        callback("bad request data");
    }
    //} else if (runningRequests.indexOf(requestId) > -1 ) { // check not duplicate
    //    callback("duplicate requestId");
    //}
    else {
        callback();
    }
};


var createOutput = function(requestId, handlerName, result) {
    var ret = {
        requestId: requestId,
        handlerName: handlerName,
        statusCode: result.status,
        throttled: result.status == "THROTTLED",
        withError: result.withError || true,
        returnValue: result.returnValue || "",
        returnError: result.returnError || "",
        durationInMilliSeconds: result.durationInMilliSeconds || 0,
        memoryUsed: result.memoryUsed || 0,
        userLogs: result.userLogs || [],
        informationLogs: result.informationLogs || []
    };
    myLogger.log(ret);
    return ret;
};


var myLogger = {};
myLogger.log = function(message) {
    if (config.debug) console.log(JSON.stringify(message, null, 2));
};



var isHandlerNameValid = function(handlerName) {
    return !(!handlerName || handlerName.length < 3 || handlerName.indexOf('.')==0 ||
              handlerName.split('.')[0].length < 1 || handlerName.split('.')[1].length < 1);
};


var server = app.listen(config.api.port, config.api.ip, function () {
    console.log('API starts listening at http://%s:%s', server.address().address, server.address().port);
    client.get("https://api.backtory.com/auth/token_key", function (data, response) {
        publicKey = data.value;
    });
    fs.readFile('lambda_config.json', 'utf8', function (err,data) {
        //fs.readFile('/home/majeed/Workspace/IdeaProjects/javascript2/test/integrationInfo.json', 'utf8', function (err,data) {
        if (err) {
            console.log(err);
        }
        var config = JSON.parse(data);
        lambda_config = config;
    });
});




