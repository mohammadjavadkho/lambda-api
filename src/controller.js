var cp = require('child_process');
var AdmZip = require('adm-zip');
var request = require('request');
var fs = require('fs');
var mkdirp = require('mkdirp');

var config = require('./config');


var Controller = function(userCodesPath, callback) {

    this.userCodesPath = userCodesPath;
    this.runnerProcess = null;
    this.requestsInfo = {};     // key: requestId -> value: { httpRequest, httpResponse, logs, ??? }
    this.runningRequests = {};  // key: pid -> value: [ requestId1, requestId2, ... ]
    this.modules = {};          // key: functionName + '-' + functionVersion -> [ version1, version2, ... ]

    this.downloadDir = this.userCodesPath + '/downloads/';
    this.functionsDir = this.userCodesPath + '/modules';
    this.debug = config.debug;
    this.statusCodes = config.statusCodes;

    this.killedRequests = [];


    this.init(function (error) {
        callback(error);
    });
};




Controller.prototype.runRequest = function (requestId, requestHeader, functionName, functionVersion, functionCdnUrl,
                                            handlerName, timeLimit, memoryLimit, userId, userName, authenticationId,
                                            keyType, functionPath, lambda_config, event, callback) {
    var controller = this;
    // send request for runner and it to running requests list
    controller.runnerProcess.send({
        requestId: requestId,
        requestHeader: requestHeader,
        functionName: functionName,
        functionVersion: functionVersion,
        functionLocation: functionPath,
        handlerName: handlerName,
        event: event,
        timeLimit: timeLimit,
        lambda_config : lambda_config,
        memoryLimit: memoryLimit,
        securityContext: {
            userId: userId,
            userName: userName,
            authenticationId: authenticationId,
            keyType: keyType
        }
    });
    controller.runningRequests[controller.runnerProcess.pid].push(requestId);

    var timeOutChecker = setTimeout(function () {
        controller.log("time out happened for requestId: " + requestId);
        controller.processMessage(requestId, config.statusCodes.TIME_OUT, null);
    }, timeLimit);


    controller.requestsInfo[requestId] = {
        callback: callback,
        timeOutChecker: timeOutChecker,
        requestId: requestId,
        requestHeader: requestHeader,
        functionName: functionName,
        functionVersion: functionVersion,
        handlerName: handlerName,
        timeLimit: timeLimit,
        lambda_config : lambda_config,
        startTime: null,
        status: null,
        endTime: null,
        duration: null,
        returnValue: null,
        returnError: null,
        userLogs: [],
        informationLogs: [],
        logSize: 0,
        logRejectedOnce: false
    };

    // it must be here! to ensure log for killed processes
    controller.requestsInfo[requestId].informationLogs.push("START requestId: " + requestId +
        " Version: " + controller.requestsInfo[requestId].functionVersion);
};


Controller.prototype.init = function(callback) {
    var controller = this;

    if (!controller.runnerProcess) controller.runnerProcess = controller.createRunnerProcess();

    mkdirp(controller.userCodesPath, function (err) {
        if (err)
            callback(err);
        else
            mkdirp(controller.downloadDir, function (err) {
                if (err)
                    callback(err);
                else
                    mkdirp(controller.functionsDir, function (err) {
                        if (err)
                            callback(err);
                        else
                            callback();
                    });
           });
    });
};


Controller.prototype.createRunnerProcess = function () {
    var controller = this;
    controller.log("creating new runner");

    var newRunnerProcess = cp.fork(__dirname + '/runner.js');
    controller.runningRequests[newRunnerProcess.pid] = [];
    newRunnerProcess.on('message', function(messageFromRunner) {
        // ignore messages from killed requests
        if (controller.killedRequests.indexOf(messageFromRunner.requestId) === -1)
           controller.processMessage(messageFromRunner.requestId, messageFromRunner.code, messageFromRunner.message);
    });
    return newRunnerProcess;
};


Controller.prototype.processMessage = function (requestId, code, message) {
    var controller = this;

    var requestInfo = controller.requestsInfo[requestId];

    if (code === "START") {
        requestInfo.startTime = message.startTime;
    }
    if (code === "LOG") {
        var logSize = JSON.stringify(message.content).length;
        if (!requestInfo) {
            console.log("log received after process finished");
        } else if (message.forceShow) {
            requestInfo.informationLogs.push(message.time + ' ' + message.content);
            requestInfo.userLogs.push(message.content);
        } else if (!requestInfo.logRejectedOnce) {
            if (requestInfo.logSize + logSize >= config.logLimit) {
                requestInfo.logRejectedOnce = true;
                if (logSize >= config.logLimit) {
                    requestInfo.informationLogs.push(message.time + ' ' + "Too much large log. " +
                        "(log-size = " + logSize + "byte, log-limit=" + config.logLimit + ")");
                    requestInfo.informationLogs.push(message.time + ' ' + "This request logs will " +
                        "be rejected since now.");
                } else {
                    requestInfo.informationLogs.push(message.time + ' ' + "You have received your " +
                        "log limit for this request.");
                    requestInfo.informationLogs.push(message.time + ' ' + "This request logs will " +
                        "be rejected since now.");
                }
            } else {
                requestInfo.informationLogs.push(message.time + ' ' + message.content);
                requestInfo.userLogs.push(message.content);
                requestInfo.logSize += JSON.stringify(message.content).length;
            }
        }
    }
    else if (code === config.statusCodes.SUCCEEDED || code === config.statusCodes.FAILED ||
             code === config.statusCodes.KILLED) {

        if (!requestInfo) {
            console.log("finished received after finished. (ignored).")
        } else {
            requestInfo.status = code;
            requestInfo.returnValue = message.returnValue;
            requestInfo.returnError = message.returnError;

            if (code !== config.statusCodes.KILLED) {
                requestInfo.endTime = message.endTime;
                requestInfo.duration = new Date(requestInfo.endTime) - new Date(requestInfo.startTime);
            }
            else{
                requestInfo.duration = requestInfo.timeLimit;
                requestInfo.endTime = new Date(requestInfo.startTime) + requestInfo.duration;
            }
            requestInfo.informationLogs.push("END requestId: " + requestId);

            // remove it from running processes
            var current_running_requests = controller.runningRequests[controller.runnerProcess.pid];
            var index = current_running_requests.indexOf(requestId);
            if (index > -1) current_running_requests.splice(index, 1);

            // clear time out
            clearTimeout(requestInfo.timeOutChecker);

            // send result to main callback
            var ret = controller.createFinalOutput(requestInfo);
            requestInfo.callback(ret);

            delete controller.requestsInfo[requestId]; // must double check no error when killed
        }
    } else if (code === "TIME_OUT") {
        var runningRequests = controller.runningRequests[controller.runnerProcess.pid];

        controller.runnerProcess.kill('SIGTERM');
        controller.runnerProcess = controller.createRunnerProcess();

        // observation: event will receive for timeout request after killed
        //              and duplicate response will be send which i handle it in api.

        for (var i = runningRequests.length-1; i>=0; i--) {
            var mustKilledRequestId = runningRequests[i];
            controller.killedRequests.push(mustKilledRequestId);
            controller.log("process killed with requestId: " + mustKilledRequestId);
            controller.processMessage(mustKilledRequestId, config.statusCodes.KILLED, {returnValue: null,
                                      returnError: "Process killed before completing request", endTime: null});
        }
   }
};


Controller.prototype.createErrorOutput = function(requestId, handlerName, result) {
    return {
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
};


Controller.prototype.createFinalOutput = function (requestInfo) {

    var withError = false;

    if (typeof requestInfo.returnValue !== 'string')
        requestInfo.returnValue = JSON.stringify(requestInfo.returnValue, null, 0);
    if (requestInfo.returnValue === "null") requestInfo.returnValue = "";

    if (requestInfo.returnError)
        withError = true;

    if (typeof requestInfo.returnError !== 'string')
        requestInfo.returnError = JSON.stringify(requestInfo.returnError, null, 0);
    if (requestInfo.returnError === "null") requestInfo.returnError = "";

    return {
        requestId: requestInfo.requestId,
        handlerName: requestInfo.handlerName,
        statusCode: requestInfo.status,
        throttled: false,
        withError: withError,
        returnValue: requestInfo.returnValue,
        returnError: requestInfo.returnError,
        durationInMilliSeconds: requestInfo.duration,
        memoryUsed: 0,
        userLogs: requestInfo.userLogs,
        informationLogs: requestInfo.informationLogs
    };
};



Controller.prototype.downloadCodeIfNeeded = function (functionName, functionVersion, functionCdnUrl, callback) {
    var controller = this;

    var functionDir = controller.functionsDir + functionName + '/';
    var functionVersionDir = functionDir + functionVersion + '/';
    var zipFileLocation = controller.downloadDir + functionName + "_" + functionVersion + ".zip";

    var key = functionName + '-' + functionVersion;
    if (key in controller.modules) {
        //controller.log("function loaded already.");
        callback(null, functionVersionDir);
        return;
    }

    fs.exists(functionVersionDir, function(exists) {
        if (exists) {
            controller.log("function files already exists. (no need to download).");
            controller.modules[key] = true;
            callback(null, functionVersionDir);
        }
        else {

            mkdirp(functionDir, function (err) {
                if (err) console.log(err);
                else {
                    mkdirp(functionVersionDir, function (err) {
                        if (err) console.log(err);
                        else {
                            var response_sent = false; // it works but maybe buggy.
                            request(functionCdnUrl)
                                .on('error', function(error) {
                                    callback(controller.statusCodes.CDN_CONNECTION_ERROR, functionVersionDir);
                                    response_sent = true;
                                })
                                .on('response', function(response) {
                                    if (response.statusCode !== 200) {
                                        callback(controller.statusCodes.CDN_RETURN_BAD_RESPONSE_CODE,
                                                 functionVersionDir);
                                        response_sent = true;
                                    }
                                    else if (response.statusCode == 200 &&
                                             response.headers['content-type'] != 'application/zip') {
                                        callback(controller.statusCodes.CDN_RETURN_NON_ZIP, functionVersionDir);
                                        response_sent = true;
                                    }
                                })
                                .pipe(fs.createWriteStream(zipFileLocation))
                                .on('close', function () {
                                    if (!response_sent) {
                                        controller.modules[key] = true;
                                        controller.log("function files downloaded.");
                                        try{
                                            var zip = new AdmZip(zipFileLocation);
                                            zip.extractAllTo(/*target path*/functionVersionDir, /*overwrite*/true);
                                            callback(null, functionVersionDir);
                                        } catch (err) {
                                            controller.log(err);
                                            callback(controller.statusCodes.ERROR_IN_EXTRACTING, functionVersionDir);
                                        }
                                    }
                                });
                        }
                    });
                }
            });
        }
    });

};


Controller.prototype.log = function(message) {
    var controller = this;
    if (controller.debug) console.log(message);
};


module.exports = Controller;