'use strict';

const Async = require('async');
const Path = require('path');
const Fs = require('fire-fs');
const Plist = require('plist');
const Url = require('fire-url');
const CCBImporter = require('./ccb-importer');

const ResAutoFolderName = 'resources-auto';
const AssetsRootUrl = 'db://assets';
const TempFolderName = 'temp';

var tempResPath = '';
var tempCCBsPath = '';
var projectPath = '';
var newResourceUrl = '';
var projectName = '';

var resPaths = [];
var ccbFiles = [];

function importProject (projFile, cb) {
    Editor.log('Import Cocos Builder project %s', projFile);

    // parse the project information
    try {
        _parseProjectInfo(projFile);
    } catch (err) {
        return cb(new Error('Illegal format of project file.'));
    }

    if (resPaths.length === 0) {
        return cb(new Error('There is not any resources.'));
    }

    _createTempResPath();

    var i, n;
    for (i = 0, n = resPaths.length; i < n; i++) {
        _copyResources(resPaths[i], tempResPath, resPaths[i]);
    }

    Async.waterfall([
        function(next) {
            // import raw assets
            Editor.assetdb.import([tempResPath], AssetsRootUrl, false, function(err, results) {
                next();
            });
        },
        function(next) {
            CCBImporter.importCCBFiles(ccbFiles, tempResPath, tempCCBsPath, newResourceUrl, next);
        }
    ], function () {
        Editor.log('Import Cocos Builder project finished.');
        Editor.log('Resources are imported to folder : %s', newResourceUrl);

        _removeTempResPath();
        cb();
    });
}

function _removeTempResPath() {
    try {
        _rmdirRecursive(tempResPath);
        _rmdirRecursive(tempCCBsPath);
    } catch (err) {
        Editor.warn('Delete temp path %s failed, please delete it manually!', tempResPath);
    }
}

function _parseProjectInfo (projFile) {
    projectPath = Path.dirname(projFile);
    projectName = Path.basename(projFile, Path.extname(projFile));

    newResourceUrl = Url.join(AssetsRootUrl, projectName);
    var i = 1;
    while (Fs.existsSync(Editor.assetdb.remote._fspath(newResourceUrl))) {
        newResourceUrl = Url.join(AssetsRootUrl, projectName + '_' + i);
        i++;
    }

    var fileContent = Fs.readFileSync(projFile, 'utf8');
    var projObj = Plist.parse(fileContent);

    var n = projObj.resourcePaths.length;
    for (i = 0; i < n; i++) {
        var pathCfg = projObj.resourcePaths[i];
        var absPath = Path.normalize(Path.join(projectPath, pathCfg.path));
        resPaths.push(absPath);
    }
}

function _rmdirRecursive (path) {
    if( Fs.existsSync(path) ) {
        Fs.readdirSync(path).forEach(function(file){
            var curPath = Path.join(path, file);
            if(Fs.lstatSync(curPath).isDirectory()) { // recurse
                _rmdirRecursive(curPath);
            } else { // delete file
                Fs.unlinkSync(curPath);
            }
        });
        Fs.rmdirSync(path);
    }
}

function _createTempResPath() {
    // create a temp path for import project
    var folderName = Url.basename(newResourceUrl);
    tempResPath = Path.join(Editor.remote.projectPath, TempFolderName, folderName);
    if (Fs.existsSync(tempResPath)) {
        _rmdirRecursive(tempResPath);
    }

    Fs.mkdirsSync(tempResPath);

    // create a temp path for ccb files
    tempCCBsPath = tempResPath + '_ccbs';
    if (Fs.existsSync(tempCCBsPath)) {
        _rmdirRecursive(tempCCBsPath);
    }

    Fs.mkdirsSync(tempCCBsPath);
}

function _copyResources(srcPath, dstPath, resRoot) {
    if (! Fs.existsSync(srcPath)) {
        Editor.warn('%s is not found!', srcPath);
        return;
    }

    Fs.readdirSync(srcPath).forEach(function (file) {
        var absPath = Path.join(srcPath, file);
        var targetPath = Path.join(dstPath, file);
        if(Fs.lstatSync(absPath).isDirectory()) {
            if (file === ResAutoFolderName) {
                targetPath = dstPath;
            }

            if (!Fs.existsSync(targetPath)) {
                Fs.mkdirsSync(targetPath);
            }

            // recurse
            _copyResources(absPath, targetPath, resRoot);
        } else {
            var ext = Path.extname(absPath);
            if (ext === '.ccb') {
                targetPath = Path.join(tempCCBsPath, Path.relative(resRoot, absPath));
                Fs.copySync(absPath, targetPath);
                ccbFiles.push(targetPath);
            } else {
                if (!Fs.existsSync(targetPath)) {
                    Fs.copySync(absPath, targetPath);
                }
            }
        }
    });
}

module.exports = {
    importer: importProject
};
