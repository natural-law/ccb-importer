'use strict';

const Async = require('async');
const Path = require('path');
const Fs = require('fire-fs');
const Plist = require('plist');
const Url = require('fire-url');

const nodeCreators = {

};

const nodeImporters = {
    'CCSprite' : _initSprite
};

var resRootUrl = '';
var resTempPath = '';
var ccbsTempPath = '';

var importedCCBFiles = [];
var animationData = {};

function importCCBFiles(ccbFiles, tempResPath, tempCCBsPath, targetRootUrl, cb) {
    resTempPath = tempResPath;
    ccbsTempPath = tempCCBsPath;
    resRootUrl = targetRootUrl;

    var index = 0;
    Async.whilst(
        function() {
            return index < ccbFiles.length;
        },
        function(callback) {
            _importCCBFile(ccbFiles[index], function() {
                index++;
                callback();
            });
        },
        function() {
            cb();
        }
    );
}

function _importCCBFile(ccbFilePath, cb) {
    if (importedCCBFiles.indexOf(ccbFilePath) >= 0) {
        return cb();
    }
    Editor.log('Importing ccb file : ', ccbFilePath);

    if (!Fs.existsSync(ccbFilePath)) {
        Editor.warn('%s is not existed!', ccbFilePath);
        return cb();
    }

    var targetFileName = Path.basename(ccbFilePath, Path.extname(ccbFilePath));
    var relativeFolderPath = Path.relative(ccbsTempPath, Path.dirname(ccbFilePath));
    var targetPath = Path.join(resTempPath, relativeFolderPath, targetFileName + '.prefab');

    Async.waterfall([
        function(next) {
            _createPrefabFromFile(ccbFilePath, targetPath, next);
        },
        function(next) {
            if (!Fs.existsSync(targetPath)) {
                return next();
            }

            var targetUrl = Url.join(resRootUrl, relativeFolderPath);
            Editor.assetdb.import([targetPath], targetUrl, false, function () {
                importedCCBFiles.push(ccbFilePath);
                next();
            });
        }
    ], cb);
}

function _createPrefabFromFile(ccbFile, targetPath, cb) {
    var rootNode = new cc.Node();
    var ccbFileObj = Plist.parse(Fs.readFileSync(ccbFile, 'utf8'));

    Async.waterfall([
        function(next) {
            animationData = {};
            _createNodeGraph(rootNode, ccbFileObj.nodeGraph, '', function() {
                next();
            });
        },
        function(next) {
            _createAnimationClips(rootNode, targetPath, next);
        },
        function(next) {
            var prefab = _Scene.PrefabUtils.createPrefabFrom(rootNode);
            var prefabData = Editor.serialize(prefab);
            var targetFolder = Path.dirname(targetPath);
            if (!Fs.existsSync(targetFolder)) {
                Fs.mkdirsSync(targetFolder);
            }
            Fs.writeFileSync(targetPath, prefabData);
            next();
        }
    ], cb);
}

// ---------- Animation related methods ----------
function _createAnimationClips(node, prefabPath, cb) {
    cb();
}

// ---------- NodeGraph related methods ----------
function _createNodeGraph(rootNode, nodeData, curNodePath, cb) {
    var cbNode = rootNode;
    Async.waterfall([
        function(next) {
            if (!rootNode) {
                var nodeType = nodeData.baseClass;
                var creator = nodeCreators[nodeType];
                if (creator) {
                    creator(nodeData, function(newNode, returnNode) {
                        rootNode = newNode;
                        cbNode = returnNode ? returnNode : rootNode;
                        next();
                    });
                } else {
                    rootNode = new cc.Node();
                    cbNode = rootNode;
                    next();
                }
            } else {
                next();
            }
        },
        function(next) {
            // record animation data
            if (nodeData.animatedProperties) {
                if (!curNodePath) {
                    animationData.selfData = nodeData.animatedProperties;
                } else {
                    if (!animationData.childrenData) {
                        animationData.childrenData = {};
                    }
                    animationData.childrenData[curNodePath] = nodeData.animatedProperties;
                }
            }

            if (!curNodePath) {
                rootNode.setName(nodeData.displayName);
            }
            _initNode(rootNode, nodeData, next);
        },
        function(next) {
            // loop in the Children
            var childrenData = nodeData.children;
            if (!childrenData || childrenData.length === 0) {
                next();
                return;
            }

            var addedChildNames = [];
            var index = 0;
            Async.whilst(
                function() {
                    return index < childrenData.length;
                },
                function(callback) {
                    var theNodeName = _genChildName(childrenData[index], addedChildNames);
                    curNodePath += ('/' + theNodeName);

                    _createNodeGraph(null, childrenData[index], curNodePath, function(newNode) {
                        newNode.setName(theNodeName);
                        addedChildNames.push(theNodeName);
                        rootNode.addChild(newNode);
                        index++;
                        callback();
                    });
                },
                function() {
                    next();
                }
            )
        }
    ], function() {
        cb(cbNode);
    });
}

function _genChildName(nodeData, addedChildNames) {
    var nameInData = nodeData.displayName;
    var retName = nameInData.replace('/', '_');
    var i = 1;
    while (addedChildNames.indexOf(retName) >= 0) {
        retName += '_';
        retName += i;
        i++;
    }

    if (nameInData !== retName) {
        Editor.warn('The name of node "%s" was renamed to "%s".', nameInData, retName);
    }

    return retName;
}

function _initNode(node, nodeData, cb) {
    var nodeType = nodeData.baseClass;

    _initBaseProperties(node, nodeData);

    node.active = true;

    // add widget component if necessary
    //_addWidget(node, nodeData);

    // init the node with data of specified type
    if (nodeType && nodeImporters[nodeType]) {
        nodeImporters[nodeType](node, nodeData, cb);
    } else {
        cb();
    }
}

function _initBaseProperties(node, nodeData) {

}

function _initSprite(node, nodeData, cb) {
    cb();
}

module.exports = {
    importCCBFiles: importCCBFiles,
};
