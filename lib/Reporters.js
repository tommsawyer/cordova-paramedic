var JasmineSpecReporter = require('jasmine-spec-reporter'),
    jasmineReporters    = require('jasmine-reporters');

module.exports = function(reportSavePath) {
    var reporters = [new JasmineSpecReporter({displayPendingSummary: false, displaySuiteNumber: true})];

    if (reportSavePath) {
        reporters.push(new jasmineReporters.JUnitXmlReporter({savePath: reportSavePath, consolidateAll: false}));
    }

    return reporters;
};

