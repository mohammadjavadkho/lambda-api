var config = {};

config.api = {};

// ip address and port of http service
config.api.ip = "0.0.0.0";
config.api.port = "8085";

config.debug = true;

config.statusCodes = {
    BAD_REQUEST: 'BAD_REQUEST',
    TIME_OUT: 'TIME_OUT',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
    KILLED: 'KILLED',
    THROTTLED: 'THROTTLED',
    CDN_CONNECTION_ERROR : 'CDN_CONNECTION_ERROR',
    CDN_RETURN_BAD_RESPONSE_CODE : 'CDN_RETURN_BAD_RESPONSE_CODE',
    CDN_RETURN_NON_ZIP : 'CDN_RETURN_NON_ZIP',
    ERROR_IN_EXTRACTING: 'ERROR_IN_EXTRACTING'
};

config.logLimit = 100000;
config.lambdaHeaders =
    {
    'x-backtory-authentication-id':"5734df81e4b05a0b0e955409",
    'x-backtory-cache-mode': "No-Cache"
    };
config.authInstanceId = "5734df81e4b05a0b0e955409";
config.objectSorageInstanceId = "5734df82e4b05a0b0e95540b";
config.gameInstanceId = "5734df82e4b05a0b0e95540c";
config.integratedMasterKey = "6723df81e4b09a527aa07443";
module.exports = config;
