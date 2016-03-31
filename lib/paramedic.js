#!/usr/bin/env node

var exec = require('./utils').exec,
    shell = require('shelljs'),
    Server = require('./LocalServer'),
    Q = require('q'),
    tmp = require('tmp'),
    PluginsManager = require('./PluginsManager'),
    path = require('path'),
    Q = require('q'),
    fs = require('fs'),
    getReporters = require('./Reporters'),
    logger = require('./utils').logger;

function ParamedicRunner(config, _callback) {
    this.tempFolder = null;
    this.pluginsManager = null;

    this.config = config;

    exec.setVerboseLevel(config.isVerbose());
}

ParamedicRunner.prototype.run = function() {
    var self = this;

    return Q().then(function() {
        self.ensureCordovaInstalled();
        self.createTempProject();
        self.prepareProjectToRunTests();
        return Server.startServer(self.config.getPorts(), self.config.getExternalServerUrl(), self.config.getUseTunnel());
    })
    .then(function(server) {
        self.server = server;

        self.injectReporters();
        self.subcribeForEvents();

        var connectionUrl = server.getConnectionUrl() || 
                            server.getStandartUrlForPlatform(self.config.getPlatformId());
        self.writeMedicConnectionUrl(connectionUrl);

        return self.runTests();
    })
    .fin(function() {
        self.cleanUpProject();
    });
};

ParamedicRunner.prototype.ensureCordovaInstalled = function() {
    var cordovaVersion = exec('cordova --version');
    var npmVersion = exec('npm -v');

    if (cordovaVersion.code || npmVersion.code) {
        throw new Error(cordovaVersion.output + npmVersion.output);
    }

    logger.normal("cordova-paramedic: using cordova version " + cordovaVersion.output.replace('\n', ''));
    logger.normal("cordova-paramedic: using npm version " + npmVersion.output.replace('\n', ''));
};

ParamedicRunner.prototype.createTempProject = function() {
    this.tempFolder = tmp.dirSync();
    tmp.setGracefulCleanup();
    logger.info("cordova-paramedic: creating temp project at " + this.tempFolder.name);
    exec('cordova create ' + this.tempFolder.name);
    shell.pushd(this.tempFolder.name);
};

ParamedicRunner.prototype.prepareProjectToRunTests = function() {
    this.installPlugins();
    this.setUpStartPage();
    this.installPlatform();
    this.checkPlatformRequirements();
};

ParamedicRunner.prototype.installPlugins = function() {
    logger.info("cordova-paramedic: installing plugins");
    this.pluginsManager = new PluginsManager(this.tempFolder.name, this.storedCWD);
    this.pluginsManager.installPlugins(this.config.getPlugins());
    this.pluginsManager.installTestsForExistingPlugins();
    this.pluginsManager.installSinglePlugin('cordova-plugin-test-framework');
    this.pluginsManager.installSinglePlugin('cordova-plugin-device');
    this.pluginsManager.installSinglePlugin(path.join(__dirname, '../paramedic-plugin'));
};

ParamedicRunner.prototype.setUpStartPage = function() {
    logger.normal("cordova-paramedic: setting app start page to test page");
    shell.sed('-i', 'src="index.html"', 'src="cdvtests/index.html"', 'config.xml');
};

ParamedicRunner.prototype.installPlatform = function() {
    logger.normal("cordova-paramedic: adding platform : " + this.config.getPlatform());
    exec('cordova platform add ' + this.config.getPlatform());
};

ParamedicRunner.prototype.checkPlatformRequirements = function() {
    logger.normal("cordova-paramedic: checking requirements for platform " + this.config.getPlatformId());
    var result = exec('cordova requirements ' + this.config.getPlatformId());

    if (result.code !== 0) 
        throw new Error('Platform requirements check has failed!');
};

ParamedicRunner.prototype.injectReporters = function() {
    var self = this;
    var reporters = getReporters(self.config.getReportSavePath());

    ['jasmineStarted', 'specStarted', 'specDone',
    'suiteStarted', 'suiteDone', 'jasmineDone'].forEach(function(route) {
        reporters.forEach(function(reporter) {
            if (reporter[route] instanceof Function)
                self.server.on(route, reporter[route].bind(reporter));
        });
    });
};

ParamedicRunner.prototype.subcribeForEvents = function() {
    this.server.on('deviceLog', function(data) {
        logger.verbose('device|console.' + data.type + ': '  + data.msg[0]);
    });

    this.server.on('deviceInfo', function(data) {
        logger.info('cordova-paramedic: Device info: ' + JSON.stringify(data));
    });
};

ParamedicRunner.prototype.writeMedicConnectionUrl = function(url) {
    logger.normal("cordova-paramedic: writing medic log url to project " + url);
    fs.writeFileSync(path.join("www","medic.json"), JSON.stringify({logurl:url}));
};

ParamedicRunner.prototype.runTests = function() {
    var self = this;

    return Q.promise(function(resolve, reject) {
        self.server.on('jasmineDone', function(data) {
            logger.info('cordova-paramedic: tests have been completed');

            var isTestPassed = data.specResults.specFailed === 0;

            resolve(isTestPassed);
        });

        self.server.on('disconnect', function() {
            reject(new Error('device is disconnected before passing the tests'));
        });

        var command = self.getCommandForStartingTests();
        logger.normal('cordova-paramedic: running command ' + command);

        exec(command, function(code, output) {
            if(code) 
                return reject(new Error(command + " returned error code " + code));

            // skip tests if it was just build
            if (!self.shouldWaitForTestResult()) {
                return resolve(true);
            }

            // reject if device not connected in pending time
            self.waitForConnection().catch(reject);
        });
    });
};

ParamedicRunner.prototype.getCommandForStartingTests = function() {
    var cmd = "cordova " + this.config.getAction() + " " + this.config.getPlatformId();

    if (this.config.getArgs()) {
        cmd += " " + this.config.getArgs();
    }

    return cmd;
};

ParamedicRunner.prototype.shouldWaitForTestResult = function() {
    var action = this.config.getAction();
    return action === 'run' || action  === 'emulate';
};

ParamedicRunner.prototype.waitForConnection = function() {
    var self = this;

    var MAX_PENDING_TIME = 60000,
        ERR_MSG = 'Seems like device not connected to local server in ' + MAX_PENDING_TIME / 1000 + ' secs';

    return Q.promise(function(resolve, reject) {
        setTimeout(function() {
            if (!self.server.isDeviceConnected()) {
                reject(new Error(ERR_MSG));
            } else {
                resolve();
            }
        }, MAX_PENDING_TIME);
    });
};

ParamedicRunner.prototype.cleanUpProject = function() {
    if(this.config.getShouldCleanUpAfterRun()) {
        logger.info("cordova-paramedic: Deleting the application: " + this.tempFolder.name);
        shell.popd();
        shell.rm('-rf', this.tempFolder.name);
    }
};

var storedCWD =  null;

exports.run = function(paramedicConfig) {

    storedCWD = storedCWD || process.cwd();

    var runner = new ParamedicRunner(paramedicConfig, null);
    runner.storedCWD = storedCWD;

    return runner.run()
    .timeout(paramedicConfig.getTimeout(), "This test seems to be blocked :: timeout exceeded. Exiting ...");
};