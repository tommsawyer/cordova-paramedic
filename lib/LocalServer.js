var Q = require('q'),
    io = require('socket.io'),
    logger = require('./utils').logger,
    exec = require('./utils').exec,
    path = require('path'),
    util = require('util'),
    portChecker = require('tcp-port-used'),
    EventEmitter = require('events').EventEmitter;

function LocalServer(port, externalServerUrl) {
    this.port = port;
    this.externalServerUrl = externalServerUrl;
}

util.inherits(LocalServer, EventEmitter);

LocalServer.startServer = function(ports, externalServerUrl, useTunnel) {
    logger.info("cordova-paramedic: scanning ports from " + ports.start + " to " + ports.end);

    return LocalServer.getFirstAvailablePort(ports.start, ports.end)
        .then(function(port) {
            logger.info("cordova-paramedic: port " + port + " is available");
            logger.info("cordova-paramedic: starting local medic server");

            var localServer = new LocalServer(port, externalServerUrl);
            localServer.createSocketListener();

            if (useTunnel) {
                return Q.promise(function(resolve) {
                    localServer.createTunnel().then(function(){
                        resolve(localServer);
                    });
                });
            }

            return localServer;
        });
};

LocalServer.getFirstAvailablePort = function(startPort, endPort) {
    var ports = Array.apply(null, Array(endPort - startPort + 1)).map(function(element, index) {
        return startPort + index;
    });

    return Q.promise(function(resolve, reject) {
        ports.reduce(function(promise, port){
            return promise.then(function(isPortUsed) {
                if (!isPortUsed) {
                    resolve(port - 1);
                    return false;
                } else {
                    return portChecker.check(port);
                }
            });
        }, Q(true));
    });
};

LocalServer.prototype.createTunnel = function() {
    logger.info('cordova-paramedic: attempt to create local tunnel');
    var self = this;

    //TODO: use localtunnel module instead of shell
    return Q.Promise(function(resolve, reject) {
        exec(path.resolve(__dirname, '../node_modules/.bin/lt') + ' --port ' + self.port, null, function(output) {
            var tunneledUrl = output.split(' ')[3];
            self.tunneledUrl = tunneledUrl;
            logger.info('cordova-paramedic: using tunneled url ' + tunneledUrl);
            resolve();
        });
    });
};

LocalServer.prototype.createSocketListener = function() {
    var listener = io.listen(this.port, {
        pingTimeout: 60000, // how many ms without a pong packet to consider the connection closed
        pingInterval: 25000 // how many ms before sending a new ping packet
    });

    var self  = this;

    listener.on('connection', function(socket) {
        logger.info('local-server: new socket connection');
        self.connection = socket;

        // server methods 
        ['deviceLog', 'disconnect', 'deviceInfo',
        'jasmineStarted', 'specStarted', 'specDone',
        'suiteStarted', 'suiteDone', 'jasmineDone'].forEach(function(route) {
            socket.on(route, function(data) {
                self.emit(route, data);
            });
        });
    });
};

LocalServer.prototype.getConnectionUrl = function() {
    return this.tunneledUrl || 
           (this.externalServerUrl ? this.externalServerUrl + ":" + this.port : undefined);
};

LocalServer.prototype.getStandartUrlForPlatform = function(platformId) {
    var connectionUrl;

    switch(platformId) {
             case "android" : connectionUrl = "http://10.0.2.2:";
                              break;
             case "ios"     :
             case "browser" :
             case "windows" :
             /* falls through */
             default: connectionUrl = "http://127.0.0.1:";
         }

    return connectionUrl + this.port;
};

LocalServer.prototype.isDeviceConnected = function() {
    return !!this.connection;
};

module.exports = LocalServer;
