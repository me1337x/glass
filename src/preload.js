// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Platform information for renderer processes
  platform: {
    isLinux: process.platform === 'linux',
    isMacOS: process.platform === 'darwin',
    isWindows: process.platform === 'win32',
    platform: process.platform
  },
  
  // Common utilities used across multiple components
  common: {
    // User & Auth
    getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
    startFirebaseAuth: () => ipcRenderer.invoke('start-firebase-auth'),
    firebaseLogout: () => ipcRenderer.invoke('firebase-logout'),
    
    // App Control
      quitApplication: () => ipcRenderer.invoke('quit-application'),
      openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // User state listener (used by multiple components)
      onUserStateChanged: (callback) => ipcRenderer.on('user-state-changed', callback),
      removeOnUserStateChanged: (callback) => ipcRenderer.removeListener('user-state-changed', callback),
  },

  // UI Component specific namespaces
  // src/ui/app/ApiKeyHeader.js
  apiKeyHeader: {
    // Model & Provider Management
    getProviderConfig: () => ipcRenderer.invoke('model:get-provider-config'),
    getOllamaStatus: () => ipcRenderer.invoke('ollama:get-status'),
    getModelSuggestions: () => ipcRenderer.invoke('ollama:get-model-suggestions'),
    ensureOllamaReady: () => ipcRenderer.invoke('ollama:ensure-ready'),
    installOllama: () => ipcRenderer.invoke('ollama:install'),
    startOllamaService: () => ipcRenderer.invoke('ollama:start-service'),
    pullOllamaModel: (modelName) => ipcRenderer.invoke('ollama:pull-model', modelName),
    downloadWhisperModel: (modelId) => ipcRenderer.invoke('whisper:download-model', modelId),
    validateKey: (data) => ipcRenderer.invoke('model:validate-key', data),
    setSelectedModel: (data) => ipcRenderer.invoke('model:set-selected-model', data),
    areProvidersConfigured: () => ipcRenderer.invoke('model:are-providers-configured'),
    
    // Window Management
    getHeaderPosition: () => ipcRenderer.invoke('get-header-position'),
    moveHeaderTo: (x, y) => ipcRenderer.invoke('move-header-to', x, y),
    
    // Listeners
    onOllamaInstallProgress: (callback) => ipcRenderer.on('ollama:install-progress', callback),
    removeOnOllamaInstallProgress: (callback) => ipcRenderer.removeListener('ollama:install-progress', callback),
    onceOllamaInstallComplete: (callback) => ipcRenderer.once('ollama:install-complete', callback),
    removeOnceOllamaInstallComplete: (callback) => ipcRenderer.removeListener('ollama:install-complete', callback),
    onOllamaPullProgress: (callback) => ipcRenderer.on('ollama:pull-progress', callback),
    removeOnOllamaPullProgress: (callback) => ipcRenderer.removeListener('ollama:pull-progress', callback),
    onWhisperDownloadProgress: (callback) => ipcRenderer.on('whisper:download-progress', callback),
    removeOnWhisperDownloadProgress: (callback) => ipcRenderer.removeListener('whisper:download-progress', callback),

    // Remove all listeners (for cleanup)
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('whisper:download-progress');
      ipcRenderer.removeAllListeners('ollama:install-progress');
      ipcRenderer.removeAllListeners('ollama:pull-progress');
      ipcRenderer.removeAllListeners('ollama:install-complete');
    }
  },

  // src/ui/app/HeaderController.js
  headerController: {
    // State Management
    sendHeaderStateChanged: (state) => ipcRenderer.send('header-state-changed', state),
    
    // Window Management
    resizeHeaderWindow: (dimensions) => ipcRenderer.invoke('resize-header-window', dimensions),
    
    // Permissions
    checkSystemPermissions: () => ipcRenderer.invoke('check-system-permissions'),
    checkPermissionsCompleted: () => ipcRenderer.invoke('check-permissions-completed'),
    
    // Listeners
    onUserStateChanged: (callback) => ipcRenderer.on('user-state-changed', callback),
    removeOnUserStateChanged: (callback) => ipcRenderer.removeListener('user-state-changed', callback),
    onAuthFailed: (callback) => ipcRenderer.on('auth-failed', callback),
    removeOnAuthFailed: (callback) => ipcRenderer.removeListener('auth-failed', callback),
    onForceShowApiKeyHeader: (callback) => ipcRenderer.on('force-show-apikey-header', callback),
    removeOnForceShowApiKeyHeader: (callback) => ipcRenderer.removeListener('force-show-apikey-header', callback)
  },

  // src/ui/app/MainHeader.js
  mainHeader: {
    // Window Management
    getHeaderPosition: () => ipcRenderer.invoke('get-header-position'),
    moveHeaderTo: (x, y) => ipcRenderer.invoke('move-header-to', x, y),
    sendHeaderAnimationFinished: (state) => ipcRenderer.send('header-animation-finished', state),

    // Settings Window Management
    cancelHideSettingsWindow: () => ipcRenderer.send('cancel-hide-settings-window'),
    showSettingsWindow: (bounds) => ipcRenderer.send('show-settings-window', bounds),
    hideSettingsWindow: () => ipcRenderer.send('hide-settings-window'),
    
    // Generic invoke (for dynamic channel names)
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    
    // Listeners
    onListenChangeSessionResult: (callback) => ipcRenderer.on('listen:changeSessionResult', callback),
    removeOnListenChangeSessionResult: (callback) => ipcRenderer.removeListener('listen:changeSessionResult', callback),
    onShortcutsUpdated: (callback) => ipcRenderer.on('shortcuts-updated', callback),
    removeOnShortcutsUpdated: (callback) => ipcRenderer.removeListener('shortcuts-updated', callback)
  },

  // src/ui/app/PermissionHeader.js
  permissionHeader: {
    // Permission Management
    checkSystemPermissions: () => ipcRenderer.invoke('check-system-permissions'),
    requestMicrophonePermission: () => ipcRenderer.invoke('request-microphone-permission'),
    openSystemPreferences: (preference) => ipcRenderer.invoke('open-system-preferences', preference),
    markPermissionsCompleted: () => ipcRenderer.invoke('mark-permissions-completed')
  },

  // src/ui/app/PickleGlassApp.js
  pickleGlassApp: {
    // Listeners
    onClickThroughToggled: (callback) => ipcRenderer.on('click-through-toggled', callback),
    removeOnClickThroughToggled: (callback) => ipcRenderer.removeListener('click-through-toggled', callback),
    removeAllClickThroughListeners: () => ipcRenderer.removeAllListeners('click-through-toggled')
  },

  // src/ui/ask/AskView.js
  askView: {
    // Window Management
    closeAskWindow: () => ipcRenderer.invoke('ask:closeAskWindow'),
    adjustWindowHeight: (height) => ipcRenderer.invoke('adjust-window-height', height),
    
    // Message Handling
    sendMessage: (text) => ipcRenderer.invoke('ask:sendQuestionFromAsk', text),

    // Listeners
    onAskStateUpdate: (callback) => ipcRenderer.on('ask:stateUpdate', callback),
    removeOnAskStateUpdate: (callback) => ipcRenderer.removeListener('ask:stateUpdate', callback),

    onAskStreamError: (callback) => ipcRenderer.on('ask-response-stream-error', callback),
    removeOnAskStreamError: (callback) => ipcRenderer.removeListener('ask-response-stream-error', callback),

    // Listeners
    onShowTextInput: (callback) => ipcRenderer.on('ask:showTextInput', callback),
    removeOnShowTextInput: (callback) => ipcRenderer.removeListener('ask:showTextInput', callback),
    
    onScrollResponseUp: (callback) => ipcRenderer.on('aks:scrollResponseUp', callback),
    removeOnScrollResponseUp: (callback) => ipcRenderer.removeListener('aks:scrollResponseUp', callback),
    onScrollResponseDown: (callback) => ipcRenderer.on('aks:scrollResponseDown', callback),
    removeOnScrollResponseDown: (callback) => ipcRenderer.removeListener('aks:scrollResponseDown', callback)
  },

  // src/ui/listen/ListenView.js
  listenView: {
    // Window Management
    adjustWindowHeight: (height) => ipcRenderer.invoke('adjust-window-height', height),
    
    // Listeners
    onSessionStateChanged: (callback) => ipcRenderer.on('session-state-changed', callback),
    removeOnSessionStateChanged: (callback) => ipcRenderer.removeListener('session-state-changed', callback)
  },

  // src/ui/listen/stt/SttView.js
  sttView: {
    // Listeners
    onSttUpdate: (callback) => ipcRenderer.on('stt-update', callback),
    removeOnSttUpdate: (callback) => ipcRenderer.removeListener('stt-update', callback)
  },

  // src/ui/listen/summary/SummaryView.js
  summaryView: {
    // Message Handling
    sendQuestionFromSummary: (text) => ipcRenderer.invoke('ask:sendQuestionFromSummary', text),
    
    // Listeners
    onSummaryUpdate: (callback) => ipcRenderer.on('summary-update', callback),
    removeOnSummaryUpdate: (callback) => ipcRenderer.removeListener('summary-update', callback),
    removeAllSummaryUpdateListeners: () => ipcRenderer.removeAllListeners('summary-update')
  },

  // src/ui/settings/SettingsView.js
  settingsView: {
    // User & Auth
    getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
    openPersonalizePage: () => ipcRenderer.invoke('open-personalize-page'),
    firebaseLogout: () => ipcRenderer.invoke('firebase-logout'),
    startFirebaseAuth: () => ipcRenderer.invoke('start-firebase-auth'),

    // Model & Provider Management
    getModelSettings: () => ipcRenderer.invoke('settings:get-model-settings'), // Facade call
    getProviderConfig: () => ipcRenderer.invoke('model:get-provider-config'),
    getAllKeys: () => ipcRenderer.invoke('model:get-all-keys'),
    getAvailableModels: (type) => ipcRenderer.invoke('model:get-available-models', type),
    getSelectedModels: () => ipcRenderer.invoke('model:get-selected-models'),
    validateKey: (data) => ipcRenderer.invoke('model:validate-key', data),
    saveApiKey: (key) => ipcRenderer.invoke('model:save-api-key', key),
    removeApiKey: (provider) => ipcRenderer.invoke('model:remove-api-key', provider),
    setSelectedModel: (data) => ipcRenderer.invoke('model:set-selected-model', data),
    
    // Ollama Management
    getOllamaStatus: () => ipcRenderer.invoke('ollama:get-status'),
    ensureOllamaReady: () => ipcRenderer.invoke('ollama:ensure-ready'),
    shutdownOllama: (graceful) => ipcRenderer.invoke('ollama:shutdown', graceful),
    
    // Whisper Management
    getWhisperInstalledModels: () => ipcRenderer.invoke('whisper:get-installed-models'),
    downloadWhisperModel: (modelId) => ipcRenderer.invoke('whisper:download-model', modelId),
    
    // Settings Management
    getPresets: () => ipcRenderer.invoke('settings:getPresets'),
    getAutoUpdate: () => ipcRenderer.invoke('settings:get-auto-update'),
    setAutoUpdate: (isEnabled) => ipcRenderer.invoke('settings:set-auto-update', isEnabled),

    // 2026-05-26 — S4.7 — parent project folders. List + add (opens native
    // folder picker) + remove. Updates come back via the
    // settings:project-folders-updated event below.
    getProjectFolders:    ()        => ipcRenderer.invoke('settings:getProjectFolders'),
    addProjectFolder:     ()        => ipcRenderer.invoke('settings:addProjectFolder'),
    removeProjectFolder:  (dirPath) => ipcRenderer.invoke('settings:removeProjectFolder', dirPath),
    onProjectFoldersUpdated:        (cb) => ipcRenderer.on('settings:project-folders-updated', cb),
    removeOnProjectFoldersUpdated:  (cb) => ipcRenderer.removeListener('settings:project-folders-updated', cb),

    // 2026-05-26 — S4.9 — mic device selection. Only the chosen ID is
    // persisted; device enumeration is done in the renderer via
    // navigator.mediaDevices.enumerateDevices().
    getMicDeviceId:                ()         => ipcRenderer.invoke('settings:getMicDeviceId'),
    setMicDeviceId:                (deviceId) => ipcRenderer.invoke('settings:setMicDeviceId', deviceId),
    onAudioDevicesUpdated:         (cb)       => ipcRenderer.on('settings:audio-devices-updated', cb),
    removeOnAudioDevicesUpdated:   (cb)       => ipcRenderer.removeListener('settings:audio-devices-updated', cb),
    getContentProtectionStatus: () => ipcRenderer.invoke('get-content-protection-status'),
    toggleContentProtection: () => ipcRenderer.invoke('toggle-content-protection'),
    getCurrentShortcuts: () => ipcRenderer.invoke('get-current-shortcuts'),
    openShortcutEditor: () => ipcRenderer.invoke('open-shortcut-editor'),
    
    // Window Management
    moveWindowStep: (direction) => ipcRenderer.invoke('move-window-step', direction),
    cancelHideSettingsWindow: () => ipcRenderer.send('cancel-hide-settings-window'),
    hideSettingsWindow: () => ipcRenderer.send('hide-settings-window'),
    
    // App Control
    quitApplication: () => ipcRenderer.invoke('quit-application'),
    
    // Progress Tracking
    pullOllamaModel: (modelName) => ipcRenderer.invoke('ollama:pull-model', modelName),
    
    // Listeners
    onUserStateChanged: (callback) => ipcRenderer.on('user-state-changed', callback),
    removeOnUserStateChanged: (callback) => ipcRenderer.removeListener('user-state-changed', callback),
    onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', callback),
    removeOnSettingsUpdated: (callback) => ipcRenderer.removeListener('settings-updated', callback),
    onPresetsUpdated: (callback) => ipcRenderer.on('presets-updated', callback),
    removeOnPresetsUpdated: (callback) => ipcRenderer.removeListener('presets-updated', callback),
    onShortcutsUpdated: (callback) => ipcRenderer.on('shortcuts-updated', callback),
    removeOnShortcutsUpdated: (callback) => ipcRenderer.removeListener('shortcuts-updated', callback),
    onWhisperDownloadProgress: (callback) => ipcRenderer.on('whisper:download-progress', callback),
    removeOnWhisperDownloadProgress: (callback) => ipcRenderer.removeListener('whisper:download-progress', callback),
    onOllamaPullProgress: (callback) => ipcRenderer.on('ollama:pull-progress', callback),
    removeOnOllamaPullProgress: (callback) => ipcRenderer.removeListener('ollama:pull-progress', callback)
  },

  // src/ui/settings/ShortCutSettingsView.js
  shortcutSettingsView: {
    // Shortcut Management
    saveShortcuts: (shortcuts) => ipcRenderer.invoke('save-shortcuts', shortcuts),
    getDefaultShortcuts: () => ipcRenderer.invoke('get-default-shortcuts'),
    closeShortcutEditor: () => ipcRenderer.send('close-shortcut-editor'),
    
    // Listeners
    onLoadShortcuts: (callback) => ipcRenderer.on('load-shortcuts', callback),
    removeOnLoadShortcuts: (callback) => ipcRenderer.removeListener('load-shortcuts', callback)
  },

  // src/ui/app/content.html inline scripts
  content: {
    // Animation Management
    // sendAnimationFinished: () => ipcRenderer.send('animation-finished'),
    
    // Listeners
    onSettingsWindowHideAnimation: (callback) => ipcRenderer.on('settings-window-hide-animation', callback),
    removeOnSettingsWindowHideAnimation: (callback) => ipcRenderer.removeListener('settings-window-hide-animation', callback),    
  },

  // src/ui/listen/audioCore/listenCapture.js
  listenCapture: {
    // Audio Management
    sendMicAudioContent: (data) => ipcRenderer.invoke('listen:sendMicAudio', data),
    sendSystemAudioContent: (data) => ipcRenderer.invoke('listen:sendSystemAudio', data),
    startMacosSystemAudio: () => ipcRenderer.invoke('listen:startMacosSystemAudio'),
    stopMacosSystemAudio: () => ipcRenderer.invoke('listen:stopMacosSystemAudio'),

    // Session Management
    isSessionActive: () => ipcRenderer.invoke('is-session-active'),

    // Listeners
    onSystemAudioData: (callback) => ipcRenderer.on('system-audio-data', callback),
    removeOnSystemAudioData: (callback) => ipcRenderer.removeListener('system-audio-data', callback)
  },

  // src/features/listen/windowPickerService.js + brain frame fan-out (S6, 2026-05-27)
  brain: {
    listCaptureWindows: () => ipcRenderer.invoke('brain:listCaptureWindows'),
    sendScreenFrame: (data) => ipcRenderer.invoke('brain:sendScreenFrame', data),
    notifyWindowPicked: (data) => ipcRenderer.invoke('brain:notifyWindowPicked', data),
    onStopScreenCapture: (callback) => ipcRenderer.on('brain:stopScreenCapture', callback),
  },

  // src/ui/listen/audioCore/renderer.js
  renderer: {
    // Listeners
    onChangeListenCaptureState: (callback) => ipcRenderer.on('change-listen-capture-state', callback),
    removeOnChangeListenCaptureState: (callback) => ipcRenderer.removeListener('change-listen-capture-state', callback)
  }
});