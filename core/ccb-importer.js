'use strict';

const Async = require('async');
const Path = require('path');
const Fs = require('fire-fs');
const Plist = require('plist');
const Url = require('fire-url');

//const DEFAULT_SP_URL = 'db://internal/image/default_sprite.png/default_sprite';
const DEFAULT_SPLASH_SP_URL = 'db://internal/image/default_sprite_splash.png/default_sprite_splash';
const DEFAULT_BTN_NORMAL_URL = 'db://internal/image/default_btn_normal.png/default_btn_normal';
const DEFAULT_BTN_PRESSED_URL = 'db://internal/image/default_btn_pressed.png/default_btn_pressed';
const DEFAULT_BTN_DISABLED_URL = 'db://internal/image/default_btn_disabled.png/default_btn_disabled';
const DEFAULT_VSCROLLBAR_URL = 'db://internal/image/default_scrollbar_vertical.png/default_scrollbar_vertical';
const DEFAULT_HSCROLLBAR_URL = 'db://internal/image/default_scrollbar.png/default_scrollbar';

const ACTION_FOLDER_SUFFIX = '_action';
const DEFAULT_ACTION_FPS = 30;

const easePrefixTypes = [
    'cubic', 'elastic', 'bounce', 'back'
];

const easeSuffixTypes = [
    'In', 'Out', 'InOut'
];

const nodeCreators = {
    'CCBFile' : _createNodeFromCCB,
    'CCScrollView' : _createScrollView
};

const nodeImporters = {
    'CCSprite' : _initSprite,
    'CCScale9Sprite' : _initScale9Sprite,
    'CCLayerColor' : _initLayerColor,
    'CCLabelTTF' : _initLabel,
    'CCLabelBMFont' : _initLabel,
    'CCMenuItemImage' : _initButton,
    'CCControlButton' : _initControlButton,
    'CCParticleSystemQuad' : _initParticle
};

const actionPropsParser = {
    'position' : _parsePosition,
    'rotation' : _parseRotation,
    'scale' : _parseScale,
    'visible' : _parseVisible,
    'color' : _parseColor,
    'opacity' : _parseOpacity,
    'displayFrame' : _parseFrame
};

var resRootUrl = '';
var resTempPath = '';
var ccbsTempPath = '';

var importedCCBFiles = [];
var animationData = {};
var sequences = [];

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
            sequences = ccbFileObj.sequences;
            var resolutionIdx = ccbFileObj.currentResolution;
            var resolutions = ccbFileObj.resolutions;
            var sceneSize = new cc.Size(0, 0);
            if (resolutions && resolutions[resolutionIdx]) {
                sceneSize.width = resolutions[resolutionIdx].width;
                sceneSize.height = resolutions[resolutionIdx].height;
            }
            _createNodeGraph(rootNode, ccbFileObj.nodeGraph, '', sceneSize, function() {
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
    if (!animationData.selfData && !animationData.childrenData) {
        // no animation data
        return cb();
    }

    var timelines = [];
    var defaultClipIdx = -1;
    var i, n;
    for (i = 0, n = sequences.length; i < n; i++) {
        var theInfo = sequences[i];
        timelines[i] = {
            name : theInfo.name,
            duration : theInfo.length,
            sample : DEFAULT_ACTION_FPS
        };

        if (theInfo.autoPlay) {
            defaultClipIdx = i;
        }
    }

    if (animationData.selfData) {
        _collectFrames(animationData.selfData, '', timelines);
    }

    if (animationData.childrenData) {
        for (var nodePath in animationData.childrenData) {
            if (!animationData.childrenData.hasOwnProperty(nodePath)) {
                continue;
            }

            _collectFrames(animationData.childrenData[nodePath], nodePath, timelines);
        }
    }

    // write files
    var actionTempPath = _genActionTempPath(prefabPath);
    if (!Fs.existsSync(actionTempPath)) {
        Fs.mkdirsSync(actionTempPath);
    }
    var parentPath = Path.dirname(actionTempPath);
    var relativeFolder = Path.relative(resTempPath, parentPath);
    var targetUrl = Url.join(resRootUrl, relativeFolder);
    var importedUrls = [];

    for (i = 0, n = timelines.length; i < n; i++) {
        var timeline = timelines[i];
        var targetFileName =  timeline.name + '.anim';
        var animFilePath = Path.join(actionTempPath, targetFileName);
        var animClip = new cc.AnimationClip();
        animClip.sample = timeline.sample;
        animClip._name = timeline.name;
        animClip._duration = timeline.duration;
        animClip.curveData = timeline.curveData;
        var animClipStr = Editor.serialize(animClip);
        Fs.writeFileSync(animFilePath, animClipStr);

        importedUrls.push(Url.join(targetUrl, Path.basename(actionTempPath), targetFileName));
    }

    Async.waterfall([
        function(next) {
            // import animation files to assets
            Editor.assetdb.import([actionTempPath], targetUrl, false, function() {
                next();
            });
        },
        function(next) {
            // add animation component for the node
            var animateComponent = node.addComponent(cc.Animation);
            if (!animateComponent) {
                Editor.warn('Add Animation component failed.');
                next();
            } else {
                // set properties for animation component
                for (i = 0, n = importedUrls.length; i < n; i++) {
                    var clipUrl = importedUrls[i];
                    var uuid = Editor.assetdb.remote.urlToUuid(clipUrl);
                    if (!uuid) {
                        continue;
                    }

                    var animClip = new cc.AnimationClip();
                    animClip._uuid = uuid;
                    animClip._name = Url.basenameNoExt(clipUrl);
                    animateComponent.addClip(animClip);

                    if (defaultClipIdx === i) {
                        animateComponent.defaultClip = animClip;
                        animateComponent.playOnLoad = true;
                    }
                }
                next();
            }
        }
    ], cb);
}

function _genActionTempPath(prefabPath) {
    var folderPath = Path.dirname(prefabPath);
    var relativePath = Path.relative(resTempPath, folderPath);
    var prefabName = Path.basename(prefabPath, Path.extname(prefabPath));

    var folderName = prefabName + ACTION_FOLDER_SUFFIX;
    var checkUrl = Url.join(resRootUrl, relativePath, folderName);
    var i = 1;
    while (Fs.existsSync(Editor.assetdb.remote._fspath(checkUrl))) {
        folderName = prefabName + ACTION_FOLDER_SUFFIX + i;
        checkUrl = Url.join(resRootUrl, relativePath, folderName);
        i++;
    }

    return Path.join(resTempPath, relativePath, folderName);
}

function _collectFrames(nodeFrameData, nodePath, timelines) {
    var theNodeObj = nodeFrameData.theNode;
    for (var i = 0, n = timelines.length; i < n; i++) {
        var frameForTimeline = nodeFrameData['' + i];
        if (!frameForTimeline) {
            continue;
        }

        if (!timelines[i].curveData) {
            timelines[i].curveData = {};
        }

        if (!nodePath) {
            // is the rootNode
            _gatherFrameData(frameForTimeline, theNodeObj, timelines[i].curveData);
        } else {
            if (!timelines[i].curveData.paths) {
                timelines[i].curveData.paths = {};
            }
            if (!timelines[i].curveData.paths[nodePath]) {
                timelines[i].curveData.paths[nodePath] = {};
            }
            _gatherFrameData(frameForTimeline, theNodeObj, timelines[i].curveData.paths[nodePath]);
        }
    }
}

function _gatherFrameData(propsData, theNodeObj, ret) {
    if (!ret.props) {
        ret.props = {};
    }

    if (!ret.comps) {
        ret.comps = {};
    }

    for (var prop in propsData) {
        if (!propsData.hasOwnProperty(prop)) {
            continue;
        }

        var parser = actionPropsParser[prop];
        if (parser) {
            parser(propsData[prop], theNodeObj, ret);
        } else {
            Editor.log('Action for property "%s" is not supported.', prop);
        }
    }
}

function _getEasingData(keyFrame) {
    if (!keyFrame.easing) {
        return null;
    }

    var easeType = keyFrame.easing.type;
    if (easeType < 0 || easeType > 13) {
        return null;
    }

    var ret = null;
    if (easeType === 0) {
        ret = 'constant';
    }
    else if (easeType === 1) {
        ret = 'linear';
    }
    else {
        var type = easeType - 2;
        var prefixIdx = Math.floor((type - 1) / 3);
        var suffixIdx = (type - 1) % 3;
        ret = easePrefixTypes[prefixIdx] + easeSuffixTypes[suffixIdx];
    }

    return ret;
}

function _parsePosition(data, theNodeObj, ret) {
    ret.props.position = [];
    for (var i = 0, n = data.keyframes.length; i < n; i++) {
        var keyFrame = data.keyframes[i];
        var frameData = {};
        frameData.frame = keyFrame.time;
        var pos = _convertNodePos(theNodeObj, cc.p(keyFrame.value[0], keyFrame.value[1]));
        frameData.value = [ pos.x, pos.y ];

        var easeData = _getEasingData(keyFrame);
        if (easeData) {
            frameData.curve = easeData;
        }

        ret.props.position.push(frameData);
    }
}

function _parseRotation(data, theNodeObj, ret) {
    ret.props.rotation = [];
    for (var i = 0, n = data.keyframes.length; i < n; i++) {
        var keyFrame = data.keyframes[i];
        var frameData = {
            frame: keyFrame.time,
            value: keyFrame.value
        };

        var easeData = _getEasingData(keyFrame);
        if (easeData) {
            frameData.curve = easeData;
        }

        ret.props.rotation.push(frameData);
    }
}

function _parseScale(data, theNodeObj, ret) {
    ret.props.scaleX = [];
    ret.props.scaleY = [];
    for (var i = 0, n = data.keyframes.length; i < n; i++) {
        var keyFrame = data.keyframes[i];
        var frameDataX = {
            frame: keyFrame.time,
            value: keyFrame.value[0]
        };
        var frameDataY = {
            frame: keyFrame.time,
            value: keyFrame.value[1]
        };


        var easeData = _getEasingData(keyFrame);
        if (easeData) {
            frameDataX.curve = easeData;
            frameDataY.curve = easeData;
        }

        ret.props.scaleX.push(frameDataX);
        ret.props.scaleY.push(frameDataY);
    }
}

function _parseVisible(data, theNodeObj, ret) {
    ret.props.active = [];
    for (var i = 0, n = data.keyframes.length; i < n; i++) {
        var keyFrame = data.keyframes[i];
        var frameData = {
            frame: keyFrame.time,
            value: ((i % 2) === 0)
        };
        ret.props.active.push(frameData);
    }
}

function _parseColor(data, theNodeObj, ret) {
    ret.props.color = [];
    for (var i = 0, n = data.keyframes.length; i < n; i++) {
        var keyFrame = data.keyframes[i];
        var frameData = {
            frame: keyFrame.time,
            value: new cc.Color(keyFrame.value[0], keyFrame.value[1], keyFrame.value[2])
        };

        var easeData = _getEasingData(keyFrame);
        if (easeData) {
            frameData.curve = easeData;
        }

        ret.props.color.push(frameData);
    }
}

function _parseOpacity(data, theNodeObj, ret) {
    ret.props.opacity = [];
    for (var i = 0, n = data.keyframes.length; i < n; i++) {
        var keyFrame = data.keyframes[i];
        var frameData = {
            frame: keyFrame.time,
            value: keyFrame.value
        };

        var easeData = _getEasingData(keyFrame);
        if (easeData) {
            frameData.curve = easeData;
        }

        ret.props.opacity.push(frameData);
    }
}

function _parseFrame(data, theNodeObj, ret) {
    if (!theNodeObj) {
        return;
    }
    var sp = theNodeObj.getComponent(cc.Sprite);
    if (sp) {
        var compName = 'cc.Sprite';
        if (!ret.comps[compName]) {
            ret.comps[compName] = {};
        }
        var spFramePropInfo = [];
        for (var i = 0, n = data.keyframes.length; i < n; i++) {
            var keyFrame = data.keyframes[i];
            var frameCfg = [ keyFrame.value[1], keyFrame.value[0] ];
            var spFrame = _getSpriteFrame(frameCfg, '');
            if (!spFrame) {
                continue;
            }

            var frameData = {
                frame: keyFrame.time,
                value: spFrame
            };
            spFramePropInfo.push(frameData);
        }
        ret.comps[compName].spriteFrame = spFramePropInfo;
    }
}

// ---------- NodeGraph related methods ----------
function _createNodeGraph(rootNode, nodeData, curNodePath, parentSize, cb) {
    var cbNode = rootNode;
    Async.waterfall([
        function(next) {
            if (!rootNode) {
                var nodeType = nodeData.baseClass;
                var creator = nodeCreators[nodeType];
                if (creator) {
                    creator(nodeData, parentSize, function(newNode, returnNode) {
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
                    animationData.selfData.theNode = rootNode;
                } else {
                    if (!animationData.childrenData) {
                        animationData.childrenData = {};
                    }
                    animationData.childrenData[curNodePath] = nodeData.animatedProperties;
                    animationData.childrenData[curNodePath].theNode = rootNode;
                }
            }

            if (!curNodePath) {
                rootNode.setName(nodeData.displayName);
            }
            _initNode(rootNode, nodeData, parentSize, next);
        },
        function(next) {
            // loop in the Children
            var childrenData = nodeData.children;
            if (!childrenData || childrenData.length === 0) {
                next();
                return;
            }

            var nodeSize = rootNode.getContentSize();
            var addedChildNames = [];
            var index = 0;
            if (curNodePath) {
                curNodePath += '/';
            }
            Async.whilst(
                function() {
                    return index < childrenData.length;
                },
                function(callback) {
                    var theNodeName = _genChildName(childrenData[index], addedChildNames);
                    var childPath = curNodePath + theNodeName;
                    _createNodeGraph(null, childrenData[index], childPath, nodeSize, function(newNode) {
                        newNode.setName(theNodeName);
                        addedChildNames.push(theNodeName);
                        rootNode.addChild(newNode);
                        newNode.setPosition(_convertNodePos(newNode));
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
        retName = (nameInData + '_' + i);
        i++;
    }

    if (nameInData !== retName) {
        Editor.warn('The name of node "%s" was renamed to "%s".', nameInData, retName);
    }

    return retName;
}

function _genProperties(nodeData) {
    var properties = nodeData.properties;
    var ret = {};
    for (var i = 0, n = properties.length; i < n; i++) {
        var propInfo = properties[i];
        ret[propInfo.name] = {
            type : propInfo.type,
            value : propInfo.value
        }
    }

    return ret;
}

function _getProperty(props, key, defaultValue) {
    if (props[key]) {
        return props[key].value;
    }

    return defaultValue;
}

function _initNode(node, nodeData, parentSize, cb) {
    var nodeType = nodeData.baseClass;

    var props = _genProperties(nodeData);
    if (nodeType !== 'CCScrollView') {
        _initBaseProperties(node, props, parentSize);
    }

    // init the node with data of specified type
    if (nodeType && nodeImporters[nodeType]) {
        nodeImporters[nodeType](node, props, cb);
    } else {
        cb();
    }
}

function _convertNodePos(node, curPos) {
    if (!curPos) {
        curPos = node.getPosition();
    }

    var parent = node.getParent();
    if (!parent) {
        return curPos;
    }

    var parentAnchor = parent.getAnchorPoint();
    var parentSize = parent.getContentSize();
    var newX = curPos.x - parentSize.width * parentAnchor.x;
    var newY = curPos.y - parentSize.height * parentAnchor.y;
    return cc.p(newX, newY);
}

function _setPosAndSize(node, props, parentSize) {
    var posValue = _getProperty(props, 'position', [0, 0, 0]);
    var sizeValue = null;
    if (props.preferedSize) {
        sizeValue = _getProperty(props, 'preferedSize');
    }
    else if (props.dimensions) {
        sizeValue = _getProperty(props, 'dimensions');
    }
    else {
        sizeValue = _getProperty(props, 'contentSize', [ 0.0, 0.0, 0 ]);
    }

    // set content size
    var sizeType = sizeValue[2];
    var width = sizeValue[0];
    var height = sizeValue[1];
    switch(sizeType) {
        case 1: // PERCENT:
            width = parentSize.width * width / 100;
            height = parentSize.height * height / 100;
            break;
        case 2: // RELATIVE_CONTAINER:
            width = parentSize.width - width;
            height = parentSize.height - height;
            break;
        case 3: // HORIZONTAL_PERCENT:
            width = parentSize.width * width / 100;
            break;
        case 4: // VERTICAL_PERCENT:
            height = parentSize.height * height / 100;
            break;
        case 0: // ABSOLUTE:
        case 5: // MULTIPLY_RESOLUTION:
        default:
            break;
    }
    node.setContentSize(width, height);

    // set position
    var posType = posValue[2];
    var x = posValue[0];
    var y = posValue[1];

    switch(posType) {
        case 1: // RELATIVE_TOP_LEFT
            y = parentSize.height - y;
            break;
        case 2: // RELATIVE_TOP_RIGHT
            x = parentSize.width - x;
            y = parentSize.height - y;
            break;
        case 3: // RELATIVE_BOTTOM_RIGHT
            x = parentSize.width - x;
            break;
        case 4: // PERCENT
            x = parentSize.width * x / 100;
            y = parentSize.height * y / 100;
            break;
        case 0: // RELATIVE_BOTTOM_LEFT
        case 5: // MULTIPLY_RESOLUTION
        default:
            break;
    }
    node.setPosition(x, y);
}

function _initBaseProperties(node, props, parentSize) {
    node.active = _getProperty(props, 'visible', true);
    var anchorValue = _getProperty(props, 'anchorPoint', [ 0, 0 ]);
    var ignoreAnchor = _getProperty(props, 'ignoreAnchorPointForPosition', false);
    if (ignoreAnchor) {
        node.setAnchorPoint(0, 0);
    } else {
        node.setAnchorPoint(anchorValue[0], anchorValue[1]);
    }
    _setPosAndSize(node, props, parentSize);
    node.setRotation(_getProperty(props, 'rotation', 0));

    // init the scale value
    var flipValue = _getProperty(props, 'flip', [ false, false ]);
    var scaleValue = _getProperty(props, 'scale', [ 1.0, 1.0, false, 0 ]);
    var scaleX = flipValue[0] ? (scaleValue[0] * -1) : scaleValue[0];
    var scaleY = flipValue[1] ? (scaleValue[1] * -1) : scaleValue[1];
    node.setScale(scaleX, scaleY);

    // init the node color
    var colorValue = _getProperty(props, 'color', [ 255, 255, 255 ]);
    node.setColor(new cc.Color(colorValue[0], colorValue[1], colorValue[2]));
    var opacityValue = _getProperty(props, 'opacity', 255);
    node.setOpacity(opacityValue);
}

function _getSpriteFrame(frameData, defaultUrl) {
    var retUrl = '';
    if (!frameData || frameData.length < 2 ||
        (!frameData[0] && !frameData[1])) {
        // using default image
        retUrl = defaultUrl;
    } else {
        if (frameData[0]) {
            var plistUrl = Url.join(resRootUrl, frameData[0]);
            retUrl = Url.join(plistUrl, frameData[1]);
        } else {
            retUrl = Url.join(resRootUrl, frameData[1]);
            retUrl = Url.join(retUrl, Url.basenameNoExt(retUrl));
        }
    }

    if (retUrl) {
        var uuid = Editor.assetdb.remote.urlToUuid(retUrl);
        if (Editor.assetdb.remote.existsByUuid(uuid)) {
            var frame = new cc.SpriteFrame();
            frame._uuid = uuid;
            return frame;
        }
    }

    return null;
}

function _initSprite(node, props, cb) {
    _initSpriteWithSizeMode(node, props, 'displayFrame', cc.Sprite.SizeMode.RAW);
    cb();
}

function _initSpriteWithSizeMode(node, props, frameKey, sizeMode) {
    var sp = node.addComponent(cc.Sprite);
    if (!sp) {
        return;
    }

    // init blend function
    var blendValue = _getProperty(props, 'blendFunc', [ 770, 771 ]);
    sp.srcBlendFactor = (blendValue[0] === 1 ? 770 : blendValue[0]);
    sp.dstBlendFactor = blendValue[1];

    // init file data
    var frameData = _getProperty(props, frameKey, null);
    sp.sizeMode = sizeMode;
    sp.trim = false;
    sp.spriteFrame = _getSpriteFrame(frameData, '');
}

function _setScale9Properties(props, uuid, cb) {
    Editor.assetdb.queryMetaInfoByUuid(uuid, function(err,info) {
        if (!info) {
            return cb();
        }

        // modify the meta info
        var meta = JSON.parse(info.json);

        meta.trimThreshold = -1;
        meta.borderTop = _getProperty(props, 'insetTop', 0);
        meta.borderBottom = _getProperty(props, 'insetBottom', 0);
        meta.borderLeft = _getProperty(props, 'insetLeft', 0);
        meta.borderRight = _getProperty(props, 'insetRight', 0);

        var jsonString = JSON.stringify(meta);
        Editor.assetdb.saveMeta( uuid, jsonString );
        cb();
    });
}

function _initScale9Sprite(node, props, cb) {
    Async.waterfall([
        function(next) {
            _initSpriteWithSizeMode(node, props, 'spriteFrame', cc.Sprite.SizeMode.CUSTOM);
            next();
        },
        function(next) {
            var sp = node.getComponent(cc.Sprite);
            if (!sp) {
                next();
                return;
            }

            // refresh the contentSize of node
            var curSize = node.getContentSize();
            var preferedSize = _getProperty(props, 'preferedSize', [ curSize.width, curSize.height, 0 ]);
            node.setContentSize(preferedSize[0], preferedSize[1]);

            if (sp.spriteFrame) {
                sp.type = cc.Sprite.Type.SLICED;
                var uuid = sp.spriteFrame._uuid;
                _setScale9Properties(props, uuid, next);
            } else {
                next();
            }
        }
    ], cb);
}

function _initLayerColor(node, props, cb) {
    var sp = node.addComponent(cc.Sprite);
    if (!sp) {
        return cb();
    }

    // init file data
    sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
    sp.trim = false;
    sp.spriteFrame = new cc.SpriteFrame();
    sp.spriteFrame._uuid = Editor.assetdb.remote.urlToUuid(DEFAULT_SPLASH_SP_URL);
    cb();
}

function _initLabel(node, props, cb) {
    var label = node.addComponent(cc.Label);
    if (!label) {
        return cb();
    }

    var dimensions = _getProperty(props, 'dimensions', [ 0, 0, 0 ]);
    if (dimensions[0] === 0 || dimensions[1] === 0) {
        label.overflow = cc.Label.Overflow.NONE;
    } else {
        label.overflow = cc.Label.Overflow.CLAMP;
        label._useOriginalSize = false;
        node.setContentSize(dimensions[0], dimensions[1]);
    }

    // init text
    label.string = _getProperty(props, 'string', '');
    label.lineHeight = 0;

    // set the alignment
    label.horizontalAlign = _getProperty(props, 'horizontalAlignment', 0);
    label.verticalAlign = _getProperty(props, 'verticalAlignment', 0);

    var ttfCfg = _getProperty(props, 'fontName', '');
    var bmfntCfg = _getProperty(props, 'fntFile', '');
    Async.waterfall([
        function(next) {
            // init fnt properties
            if (bmfntCfg) {
                // BMFont
                _setFntFileForLabel(label, bmfntCfg, next);
            }
            else if (ttfCfg && Path.extname(ttfCfg) === '.ttf') {
                // ttf font
                _setFntFileForLabel(label, ttfCfg, next);
            } else {
                next();
            }
        },
        function(next) {
            var fontSize = _getProperty(props, 'fontSize', [ -1, 0 ]);
            if (fontSize[0] >= 0) {
                label.fontSize = fontSize[0];
                next();
            } else if (bmfntCfg) {
                cc.loader.load(Path.join(resTempPath, bmfntCfg), function(err, config) {
                    if (err) {
                        return next();
                    }

                    label.fontSize = config.fontSize;
                    next();
                });
            } else {
                next();
            }
        }
    ], cb);
}

function _setFntFileForLabel(label, fntCfg, cb) {
    if (!label || !fntCfg) {
        return cb();
    }

    var fntFileUrl = Url.join(resRootUrl, fntCfg);
    var needLoadFnt = false;
    if (fntFileUrl) {
        var fntUuid = Editor.assetdb.remote.urlToUuid(fntFileUrl);
        if (Editor.assetdb.remote.existsByUuid(fntUuid)) {
            needLoadFnt = true;
        }
    }

    if (needLoadFnt) {
        cc.AssetLibrary.loadAsset(fntUuid, function(err, res) {
            if (err) {
                return cb();
            }
            label.font = res;
            cb();
        });
    } else {
        cb();
    }
}

function _initButton(node, props, cb) {
    var btn = node.addComponent(cc.Button);
    var sp = node.addComponent(cc.Sprite);
    if (!btn) {
        return cb();
    }

    // init the property of sprite component
    sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
    sp.trim = false;

    // set the button enable/disable
    btn.interactable = _getProperty(props, 'isEnabled', true);

    // init the sprite frame
    btn.transition = cc.Button.Transition.SPRITE;
    var normalCfg = _getProperty(props, 'normalSpriteFrame', null);
    sp.spriteFrame = _getSpriteFrame(normalCfg, DEFAULT_BTN_NORMAL_URL);
    btn.normalSprite = _getSpriteFrame(normalCfg, DEFAULT_BTN_NORMAL_URL);
    btn.hoverSprite = _getSpriteFrame(normalCfg, DEFAULT_BTN_NORMAL_URL);

    var pressedCfg = _getProperty(props, 'selectedSpriteFrame', null);
    btn.pressedSprite = _getSpriteFrame(pressedCfg, DEFAULT_BTN_PRESSED_URL);

    var disabledCfg = _getProperty(props, 'disabledSpriteFrame', null);
    btn.disabledSprite = _getSpriteFrame(disabledCfg, DEFAULT_BTN_DISABLED_URL);
    cb();
}

function _initControlButton(node, props, cb) {
    var btn = node.addComponent(cc.Button);
    var sp = node.addComponent(cc.Sprite);
    if (!btn) {
        return cb();
    }

    var preferedSize = _getProperty(props, 'preferedSize', [ 0, 0, 0 ]);
    node.setContentSize(preferedSize[0], preferedSize[1]);

    // init the property of sprite component
    sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
    sp.type = cc.Sprite.Type.SLICED;
    sp.trim = false;

    // set the button enable/disable
    btn.interactable = _getProperty(props, 'enabled', true);

    // init the sprite frame
    btn.transition = cc.Button.Transition.SPRITE;
    var normalCfg = _getProperty(props, 'backgroundSpriteFrame|1', null);
    sp.spriteFrame = _getSpriteFrame(normalCfg, DEFAULT_BTN_NORMAL_URL);
    btn.normalSprite = _getSpriteFrame(normalCfg, DEFAULT_BTN_NORMAL_URL);
    btn.hoverSprite = _getSpriteFrame(normalCfg, DEFAULT_BTN_NORMAL_URL);

    var pressedCfg = _getProperty(props, 'backgroundSpriteFrame|2', null);
    btn.pressedSprite = _getSpriteFrame(pressedCfg, DEFAULT_BTN_PRESSED_URL);

    var disabledCfg = _getProperty(props, 'backgroundSpriteFrame|3', null);
    btn.disabledSprite = _getSpriteFrame(disabledCfg, DEFAULT_BTN_DISABLED_URL);

    // add label child
    var labelNode = new cc.Node('title');
    var labelAnchor = _getProperty(props, 'labelAnchorPoint', [ 0, 0 ]);
    labelNode.setAnchorPoint(labelAnchor[0], labelAnchor[1]);
    node.addChild(labelNode);
    _convertNodePos(labelNode, cc.p(node.getContentSize().width / 2, node.getContentSize().height / 2));

    var label = labelNode.addComponent(cc.Label);
    var fontSize = _getProperty(props, 'titleTTFSize|1', [ -1, 0 ]);
    var btnText = _getProperty(props, 'title|1', '');
    var txtColorValue = _getProperty(props, 'titleColor|1', [ 255, 255, 255 ]);
    var txtColor = new cc.Color(txtColorValue[0], txtColorValue[1], txtColorValue[2]);
    labelNode.setColor(txtColor);
    label.string = btnText;
    label.lineHeight = 0;
    if (fontSize[0] >= 0) {
        label.fontSize = fontSize[0];
    }

    var fntResCfg = _getProperty(props, 'titleTTF|1', '');
    if (fntResCfg && Path.extname(fntResCfg) === '.ttf') {
        _setFntFileForLabel(label, fntResCfg);
    }
    cb();
}

function _initParticle(node, props, cb) {
    var par = node.addComponent(cc.ParticleSystem);
    if (!par) {
        return cb();
    }
    par.custom = true;
    par.emitterMode = _getProperty(props, 'emitterMode', cc.ParticleSystem.EmitterMode.GRAVITY);
    par.emissionRate = _getProperty(props, 'emissionRate', 10);
    par.duration = _getProperty(props, 'duration', -1);
    par.totalParticles = _getProperty(props, 'totalParticles', 250);
    var lifeValue = _getProperty(props, 'life', [ 3, 0.25 ]);
    par.life = lifeValue[0];
    par.lifeVar = lifeValue[1];
    var startSizeValue = _getProperty(props, 'startSize', [ 0, 0 ]);
    par.startSize = startSizeValue[0];
    par.startSizeVar = startSizeValue[1];
    var endSizeValue = _getProperty(props, 'endSize', [ 0, 0 ]);
    par.endSize = endSizeValue[0];
    par.endSizeVar = endSizeValue[1];
    var startSpinValue = _getProperty(props, 'startSpin', [ 0, 0 ]);
    par.startSpin = startSpinValue[0];
    par.startSpinVar = startSpinValue[1];
    var endSpinValue = _getProperty(props, 'endSpin', [ 0, 0 ]);
    par.endSpin = endSpinValue[0];
    par.endSpinVar = endSpinValue[1];
    var angleValue = _getProperty(props, 'angle', [ 0, 0 ]);
    par.angle = angleValue[0];
    par.angleVar = angleValue[1];
    var startColorValue = _getProperty(props, 'startColor', [ [255, 255, 255, 255], [0, 0, 0, 0] ]);
    par.startColor = new cc.Color(_getColorValue(startColorValue[0][0]),
                                  _getColorValue(startColorValue[0][1]),
                                  _getColorValue(startColorValue[0][2]),
                                  _getColorValue(startColorValue[0][3]));
    par.startColorVar = new cc.Color(_getColorValue(startColorValue[1][0]),
                                     _getColorValue(startColorValue[1][1]),
                                     _getColorValue(startColorValue[1][2]),
                                     _getColorValue(startColorValue[1][3]));
    var endColorValue = _getProperty(props, 'endColor', [ [255, 255, 255, 255], [0, 0, 0, 0] ]);
    par.endColor = new cc.Color(_getColorValue(endColorValue[0][0]),
                                _getColorValue(endColorValue[0][1]),
                                _getColorValue(endColorValue[0][2]),
                                _getColorValue(endColorValue[0][3]));
    par.endColorVar = new cc.Color(_getColorValue(endColorValue[1][0]),
                                   _getColorValue(endColorValue[1][1]),
                                   _getColorValue(endColorValue[1][2]),
                                   _getColorValue(endColorValue[1][3]));

    var blendValue = _getProperty(props, 'blendFunc', [ 770, 771 ]);
    par.srcBlendFactor = blendValue[0];
    par.dstBlendFactor = blendValue[1];
    var posVarValue = _getProperty(props, 'posVar', [0,0]);
    par.posVar = cc.p(posVarValue[0], posVarValue[1]);

    if (par.emitterMode === cc.ParticleSystem.EmitterMode.GRAVITY) {
        var gravityValue = _getProperty(props, 'gravity', [ 0, 0 ]);
        par.gravity = cc.p(gravityValue[0], gravityValue[1]);
        var speedValue = _getProperty(props, 'speed', [ 0, 0 ]);
        par.speed = speedValue[0];
        par.speedVar = speedValue[1];

        var tangentValue = _getProperty(props, 'tangentialAccel', [ 0, 0 ]);
        par.tangentialAccel = tangentValue[0];
        par.tangentialAccelVar = tangentValue[1];
        var radialAccelValue = _getProperty(props, 'radialAccel', [ 0, 0 ]);
        par.radialAccel = radialAccelValue[0];
        par.radialAccelVar = radialAccelValue[1];
    } else {
        var startRadiusValue = _getProperty(props, 'startRadius', [0,0]);
        par.startRadius = startRadiusValue[0];
        par.startRadiusVar = startRadiusValue[1];
        var endRadiusValue = _getProperty(props, 'endRadius', [0,0]);
        par.endRadius = endRadiusValue[0];
        par.endRadiusVar = endRadiusValue[1];
        var rotatePerSecondValue = _getProperty(props, 'rotatePerSecond', [0,0]);
        par.rotatePerS = rotatePerSecondValue[0];
        par.rotatePerSVar = rotatePerSecondValue[1];
    }

    var textureFile = _getProperty(props, 'texture', null);
    if (textureFile) {
        var texUrl = Url.join(resRootUrl, textureFile);
        var uuid = Editor.assetdb.remote.urlToUuid(texUrl);
        if (Editor.assetdb.remote.existsByUuid(uuid)) {
            par.texture = Editor.assetdb.remote._fspath(texUrl);
        }
    }
    cb();
}

function _getColorValue(value) {
    if (value > 1) {
        return value;
    }

    return Math.round(value * 255);
}

function _createNodeWithCCBPath(filePath, cb) {
    var ccbPath = Path.join(ccbsTempPath, filePath);
    var newNode = null;
    var fileExisted = false;
    if (filePath && Fs.existsSync(ccbPath)) {
        fileExisted = true;
    }
    Async.waterfall([
        function(next) {
            if (!fileExisted) {
                return next();
            }

            // import the ccb file as a prefab
            _importCCBFile(ccbPath, next);
        },
        function(next) {
            if (!fileExisted) {
                return next();
            }

            // create a node with imported prefab
            var folderPath = Path.dirname(ccbPath);
            var relativePath = Path.relative(ccbsTempPath, folderPath);
            var ccbName = Path.basename(ccbPath, Path.extname(ccbPath));
            var prefabUrl = Url.join(resRootUrl, relativePath, ccbName + '.prefab');
            var uuid = Editor.assetdb.remote.urlToUuid(prefabUrl);
            cc.AssetLibrary.loadAsset(uuid, function (err, prefab) {
                if (err) {
                    next();
                } else {
                    newNode = cc.instantiate(prefab);
                    next();
                }
            });
        }
    ], function() {
        if (!newNode) {
            newNode = new cc.Node();
        }
        cb(newNode);
    });
}

function _createNodeFromCCB(nodeData, parentSize, cb) {
    var props = _genProperties(nodeData);
    var filePath = _getProperty(props, 'ccbFile', '');
    _createNodeWithCCBPath(filePath, cb);
}

function _createScrollView(nodeData, parentSize, cb) {
    var scrollNode = new cc.Node();
    var props = _genProperties(nodeData);
    _initBaseProperties(scrollNode, props, parentSize);
    var scroll = scrollNode.addComponent(cc.ScrollView);
    if (!scroll) {
        return cb(scrollNode);
    }

    scroll.inertia = _getProperty(props, 'bounces', true);
    var scrollDir = _getProperty(props, 'direction', 2);
    scroll.vertical = (scrollDir === 1 || scrollDir === 2);
    scroll.horizontal = (scrollDir === 0 || scrollDir === 2);

    // add Mask component if necessary
    var clipAble = _getProperty(props, 'clipsToBounds', true);
    if (clipAble) {
        var mask = scrollNode.addComponent(cc.Mask);
        mask.enabled = true;
    }

    // create content node
    var containerFile = _getProperty(props, 'container', '');
    var contentNode = null;
    Async.waterfall([
        function(next) {
            _createNodeWithCCBPath(containerFile, function(theNode) {
                contentNode = theNode;
                contentNode.setName('container');
                next();
            });
        },
        function(next) {
            // add content node
            scrollNode.addChild(contentNode);
            scroll.content = contentNode;

            // add scrollbar
            if (scroll.vertical) {
                var vScrollBarNode = _genScrollBar(cc.Scrollbar.Direction.VERTICAL, 'vScrollBar', scrollNode.getContentSize());
                scrollNode.addChild(vScrollBarNode);
                scroll.verticalScrollBar = vScrollBarNode.getComponent(cc.Scrollbar);
            }
            if (scroll.horizontal) {
                var hScrollBarNode = _genScrollBar(cc.Scrollbar.Direction.HORIZONTAL, 'hScrollBar', scrollNode.getContentSize());
                scrollNode.addChild(hScrollBarNode);
                scroll.horizontalScrollBar = hScrollBarNode.getComponent(cc.Scrollbar);
            }
            next();
        }
    ], function() {
        cb(contentNode, scrollNode);
    });
}

function _genScrollBar(direction, name, viewSize) {
    var retNode = new cc.Node(name);
    var scrollbar = retNode.addComponent(cc.Scrollbar);
    scrollbar.direction = direction;

    var widget = retNode.addComponent(cc.Widget);
    widget.isAlignRight = true;
    widget.isAlignBottom = true;
    widget.isAlignTop = (direction === cc.Scrollbar.Direction.VERTICAL);
    widget.isAlignLeft = (direction === cc.Scrollbar.Direction.HORIZONTAL);

    var barNode = new cc.Node('bar');
    retNode.addChild(barNode);
    var barSp = barNode.addComponent(cc.Sprite);
    barSp.type = cc.Sprite.Type.SLICED;
    barSp.trim = false;
    barSp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
    barSp.spriteFrame = new cc.SpriteFrame();
    if (direction === cc.Scrollbar.Direction.HORIZONTAL) {
        retNode.setContentSize(viewSize.width, 15);
        barNode.setContentSize(viewSize.width * 0.7, 15);
        barSp.spriteFrame._uuid = Editor.assetdb.remote.urlToUuid(DEFAULT_HSCROLLBAR_URL);
    } else {
        retNode.setContentSize(15, viewSize.height);
        barNode.setContentSize(15, viewSize.height * 0.7);
        barSp.spriteFrame._uuid = Editor.assetdb.remote.urlToUuid(DEFAULT_VSCROLLBAR_URL);
    }
    scrollbar.handle = barSp;

    return retNode;
}

module.exports = {
    importCCBFiles: importCCBFiles,
};
