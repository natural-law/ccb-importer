'use strict';

function importProject (projFile, cb) {
    Editor.log('importing %s', projFile);
    cb();
}

module.exports = {
    importer: importProject
};
