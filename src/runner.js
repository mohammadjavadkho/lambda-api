var LambdaContext = {

    init: function(requestId, requestHeaders, securityContext) {
        this.requestId = requestId;
        this.requestHeaders = requestHeaders;
        this.securityContext = securityContext;
    },

    succeed: function(output){
        process.send({requestId: this.requestId, code: 'SUCCEEDED', message: {returnValue: output, returnError: null,
                        endTime: new Date()}});
        delete runningRequests[this.requestId];
    },

    fail: function(output){
        process.send({requestId: this.requestId, code: 'FAILED', message: {returnValue: null, returnError: output,
                        endTime: new Date()}});
        delete runningRequests[this.requestId];
        return null;
    },

    getSecurityContext: function () {
        return this.securityContext;
    },

    getRequestHeaders: function () {
        return this.requestHeaders;
    },

    getRemainingTimeInMillis: function () {
        return runningRequests[this.requestId].timeLimit - (new Date() - runningRequests[this.requestId].startTime);
    },

    log: function () {
        save_user_logs(this.requestId, arguments);
    },

    warn: function () {
        save_user_logs(this.requestId, arguments);
    },

    error: function () {
        save_user_logs(this.requestId, arguments);
    },

    info: function () {
        save_user_logs(this.requestId, arguments);
    },

    debug: function () {
        save_user_logs(this.requestId, arguments);
    }
};

exports.LambdaContext = LambdaContext;

var runningRequests = {};
var loadedModules = {};
var loadModule = true;


process.on('message', function(message) {
    var lambda_config = message.lambda_config;
    var requestId = message.requestId;
    var requestHeaders = message.requestHeader;
    var functionName = message.functionName;
    var functionVersion = message.functionVersion;
    var functionLocation = message.functionLocation;
    var handlerName = message.handlerName; // example: index.handler (call exports.handler of file index.js)
    var event = message.event;
    var timeLimit = message.timeLimit;
    var securityContext = message.securityContext;

    var moduleName = handlerName.split('.')[0];
    var exportName = handlerName.split('.')[1];

    var lambdaModule = null;
    var lambdaHandler = null;
    process.send({requestId: requestId, code: 'START', message: {startTime: new Date()}});

    runningRequests[requestId] = {
        requestId: requestId,
        moduleName: moduleName,
        exportName: exportName,
        timeLimit: timeLimit,
        startTime: new Date()
    };

    var selected_module_key = functionName + '-' + functionVersion + '-' + moduleName;
    // Load all modules from lambda_config file
    if(loadModule) {
        loadModule = false;
        for (var k in lambda_config) {
            var moduleTitle = lambda_config[k].handlerName.split('.')[0];
            var module_key = lambda_config[k].functionName + '-' + lambda_config[k].functionVersion + '-' + moduleTitle;
            try {
                lambdaModule = require(functionLocation + '/' + moduleTitle + '.js');
                loadedModules[module_key] = lambdaModule;
            }
            catch (exception) {
                process.send({
                    requestId: requestId, code: 'LOG', message: {
                        time: getTime(), content: "Invalid module '" + moduleTitle + "'", forceShow: true
                    }
                });
                process.send({
                    requestId: requestId, code: 'LOG', message: {
                        time: getTime(), content: exception.stack,
                        forceShow: true
                    }
                });
                process.send({
                    requestId: requestId, code: 'FAILED', message: {
                        returnValue: null,
                        returnError: "Invalid module '" + moduleTitle + "'", endTime: new Date()
                    }
                });
                delete runningRequests[requestId];
                return null;
            }
        }
    }
    lambdaModule = loadedModules[selected_module_key];
    lambdaHandler = lambdaModule[exportName];

    if( !lambdaHandler ){
        process.send({requestId: requestId, code: 'LOG', message: {time: getTime(), content:
        "Handler '" + handlerName + "' missing on module '" + moduleName + "'", forceShow: true}});
        process.send({requestId: requestId, code: 'FAILED', message: {returnValue: null, returnError:
        "Handler '" + handlerName + "' missing on module '" + moduleName + "'", endTime: new Date()}});
        delete runningRequests[requestId];
        return null;
    }

    try {
        var contextObj = Object.create(LambdaContext);
        contextObj.init(requestId, requestHeaders, securityContext);
        lambdaHandler(event, contextObj);
    }
    catch(exception) {
        process.send({requestId: requestId, code: 'LOG', message: {time: getTime(), content: exception.stack,
                        forceShow: true}});
        process.send({requestId: requestId, code: 'FAILED', message: {returnValue: null, returnError:
                        "Process exited before completing request", endTime: new Date()}});
        delete runningRequests[requestId];
    }
});

process.on('uncaughtException', function(err){
    for ( var requestId in runningRequests ) {
        process.send({requestId: requestId, code: 'LOG', message: {time: getTime(), content: err.stack,
                        forceShow: true}});
        process.send({requestId: requestId, code: 'FAILED', message: {returnValue: null, returnError:
                        "Process exited before completing request", endTime: new Date()}});
        delete runningRequests[requestId];
    }
});


var getTime = function () {
    return new Date().toISOString().replace('T', ' ').substr(0, 19);
};

var save_user_logs = function (requestId, arguments) {
    var args = "";
    for (var i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] !== 'string')
            if (i === arguments.length - 1)
                args += JSON.stringify(arguments[i]);
            else
                args += JSON.stringify(arguments[i]) + ' ';
        else
            if (i === arguments.length - 1)
                args += arguments[i];
            else
                args += arguments[i] + ' ';
    }
    process.send({requestId: requestId, code: 'LOG', message: {time: getTime(), content: args}});
};