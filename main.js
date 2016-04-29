'use strict';

module.exports = {
  load () {
    Editor.Ipc.sendToMain('project-importer:register-importer', 'Cocos Builder', 'ccbproj', 'packages://ccb-importer/core/ccbproj-importer');
  },

  unload () {
    Editor.Ipc.sendToMain('project-importer:unregister-importer', 'Cocos Builder');
  }
};
