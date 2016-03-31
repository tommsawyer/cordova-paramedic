module.exports = {
    //"externalServerUrl": "http://10.0.8.254",
    "useTunnel": true,
    "verbose": true,
    "plugins": [
        "https://github.com/apache/cordova-plugin-inappbrowser"
    ],
     "platform": "windows",
     "action": "run",
     "args": "--archs=x64 -- --appx=uap"
};
