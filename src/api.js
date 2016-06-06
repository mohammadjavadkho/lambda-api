var randomstring = require('randomstring');

//Lets require/import the HTTP module
var http = require('http');
var fs = require('fs');
var dispatcher = require('httpdispatcher');

var Controller = require('./controller');
var config = require('./config');
var lambda_config = require('./lambda_config');

var isHealthy = false;
var isIntegrationInfoWrittenInFile = false;

var controller = new Controller(process.cwd() + '/usercode/', function(err){
    isHealthy = !err;
});



dispatcher.onGet("/health", function(req, res) {
    if (isHealthy) {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write('OK');
        res.end();
    }
    else {
        res.writeHead(400, {'Content-Type': 'text/html'});
        res.write('OK');
        res.end();
    }
});

dispatcher.onPost("/:test", function(httpRequest, httpResponse) {
    console.log(httpRequest);

    httpRequest.body = JSON.parse(httpRequest.body);
    var fnName = httpRequest.params.functionName;

    var requestId = httpRequest.body.requestId || randomstring.generate();
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
    var event = httpRequest.body.payload || "";
    var integratedMasterKey = httpRequest.body.integratedMasterKey;
    var integratedInstances = httpRequest.body.integratedInstances;

    var contentType = httpRequest.headers['content-type'];

    var functionPath =  controller.functionsDir;

    isRequestValid(contentType, requestId, functionName, functionVersion, functionCdnAddress, handlerName,
                   integratedMasterKey, function(err) {
       if (err) {
           console.log(err);
           httpResponse.writeHead(200, {'Content-Type': 'application/json'});
           httpResponse.write(JSON.stringify(createOutput(requestId, handlerName, {status: config.statusCodes.BAD_REQUEST})));
           httpResponse.end();

       } else {
           if (!isIntegrationInfoWrittenInFile) {
               var stream = fs.createWriteStream("integrationInfo.json");
               stream.once('open', function(fd) {
                   var content = integratedInstances;
                   content.integratedMasterKey = integratedMasterKey;
                   stream.write(JSON.stringify(content, null, 4));
                   stream.end();
                   isIntegrationInfoWrittenInFile = true;
                   controller.runRequest(requestId, lambdaHeaders, functionName, functionVersion, functionCdnAddress,
                                         handlerName, timeLimit, memoryLimit, userId, userName, authenticationId,
                                         keyType, functionPath, event, function(result) {
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
                   functionPath,event, function(result) {
                       //myLogger.log(result);
                       httpResponse.writeHead(200, {'Content-Type': 'application/json'});
                       httpResponse.write(JSON.stringify(result));
                       httpResponse.end();

               });
           }
      }
    });

});

var isRequestValid = function (contentType, requestId, functionName, functionVersion, functionCdnAddress, handlerName,
                               integratedMasterKey, callback) {
    if (!contentType || contentType.indexOf('application/json') !== 0) {
        callback("bad content type");
    } else if (!requestId || !functionName || !functionVersion  || !handlerName ||
                !isHandlerNameValid(handlerName)) {
        callback("bad request data");
    } else {
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
    //myLogger.log(ret);
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

//Lets use our dispatcher
function handleRequest(request, response){
    try {
        //Disptach
        dispatcher.dispatch(request, response);
    } catch(err) {
        console.log(err);
    }
}


//Create a server
var server = http.createServer(handleRequest);

//Lets start our server
server.listen(config.api.port, config.api.ip, function(){
    //Callback triggered when server is successfully listening. Hurray!
    console.log("Server listening on: http://%s:%s", config.api.ip, config.api.port);
});

