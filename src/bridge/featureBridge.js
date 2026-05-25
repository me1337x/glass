// src/bridge/featureBridge.js
const { ipcMain, app } = require('electron');
const settingsService = require('../features/settings/settingsService');
const authService = require('../features/common/services/authService');
const whisperService = require('../features/common/services/whisperService');
const ollamaService = require('../features/common/services/ollamaService');
const modelStateService = require('../features/common/services/modelStateService');
const shortcutsService = require('../features/shortcuts/shortcutsService');
const presetRepository = require('../features/common/repositories/preset');

const askService = require('../features/ask/askService');
const listenService = require('../features/listen/listenService');
const permissionService = require('../features/common/services/permissionService');
const brainBridge = require('../brain-bridge'); // S3: fan out audio frames to brain

// --- S3 helpers: audio fan-out ----------------------------------------------

/** Pull the sample-rate hint out of a mime-type like "audio/pcm;rate=24000". */
function _parseSampleRate(mimeType, fallback = 24000) {
    const m = (mimeType || '').match(/rate=(\d+)/);
    return m ? parseInt(m[1], 10) : fallback;
}

/**
 * Drop counter — gets logged once per ~5 seconds so we don't spam stdout
 * at the audio cadence (~10 frames/sec * 2 sources = 20 drops/sec when the
 * brain is offline). Reset on a successful send.
 */
let _audioDropsSinceLastLog = 0;
let _lastDropLogTs = 0;

function _fanOutAudioFrameToBrain(source, data, mimeType) {
    if (!brainBridge.connected) {
        _audioDropsSinceLastLog++;
        const now = Date.now();
        if (now - _lastDropLogTs > 5000) {
            console.warn(
                `[FeatureBridge] dropped ${_audioDropsSinceLastLog} audio frames since last log ` +
                `(brain not connected); will keep dropping silently until it reconnects.`
            );
            _audioDropsSinceLastLog = 0;
            _lastDropLogTs = now;
        }
        return;
    }
    const sessionId = listenService.currentSessionId;
    if (!sessionId) {
        // No active listen session — frame would be unattributable. Skip.
        return;
    }
    if (_audioDropsSinceLastLog > 0) {
        _audioDropsSinceLastLog = 0; // reset on first successful send after a dry spell
    }
    brainBridge.send('audio.frame', {
        session_id: sessionId,
        source, // 'mic' | 'system'
        format: 'pcm_s16le',
        sample_rate: _parseSampleRate(mimeType),
        channels: 1,
        duration_ms: 100,
        payload_b64: data,
    });
}

module.exports = {
  // Renderer로부터의 요청을 수신하고 서비스로 전달
  initialize() {
    // Settings Service
    ipcMain.handle('settings:getPresets', async () => await settingsService.getPresets());
    ipcMain.handle('settings:get-auto-update', async () => await settingsService.getAutoUpdateSetting());
    ipcMain.handle('settings:set-auto-update', async (event, isEnabled) => await settingsService.setAutoUpdateSetting(isEnabled));  
    ipcMain.handle('settings:get-model-settings', async () => await settingsService.getModelSettings());
    ipcMain.handle('settings:validate-and-save-key', async (e, { provider, key }) => await settingsService.validateAndSaveKey(provider, key));
    ipcMain.handle('settings:clear-api-key', async (e, { provider }) => await settingsService.clearApiKey(provider));
    ipcMain.handle('settings:set-selected-model', async (e, { type, modelId }) => await settingsService.setSelectedModel(type, modelId));    

    ipcMain.handle('settings:get-ollama-status', async () => await settingsService.getOllamaStatus());
    ipcMain.handle('settings:ensure-ollama-ready', async () => await settingsService.ensureOllamaReady());
    ipcMain.handle('settings:shutdown-ollama', async () => await settingsService.shutdownOllama());

    // Shortcuts
    ipcMain.handle('get-current-shortcuts', async () => await shortcutsService.loadKeybinds());
    ipcMain.handle('get-default-shortcuts', async () => await shortcutsService.handleRestoreDefaults());
    ipcMain.handle('save-shortcuts', async (event, newKeybinds) => await shortcutsService.handleSaveShortcuts(newKeybinds));

    // Permissions
    ipcMain.handle('check-system-permissions', async () => await permissionService.checkSystemPermissions());
    ipcMain.handle('request-microphone-permission', async () => await permissionService.requestMicrophonePermission());
    ipcMain.handle('open-system-preferences', async (event, section) => await permissionService.openSystemPreferences(section));
    ipcMain.handle('mark-permissions-completed', async () => await permissionService.markPermissionsAsCompleted());
    ipcMain.handle('check-permissions-completed', async () => await permissionService.checkPermissionsCompleted());

    // User/Auth
    ipcMain.handle('get-current-user', () => authService.getCurrentUser());
    ipcMain.handle('start-firebase-auth', async () => await authService.startFirebaseAuthFlow());
    ipcMain.handle('firebase-logout', async () => await authService.signOut());

    // App
    ipcMain.handle('quit-application', () => app.quit());

    // Whisper
    ipcMain.handle('whisper:download-model', async (event, modelId) => await whisperService.handleDownloadModel(modelId));
    ipcMain.handle('whisper:get-installed-models', async () => await whisperService.handleGetInstalledModels());
       
    // General
    ipcMain.handle('get-preset-templates', () => presetRepository.getPresetTemplates());
    ipcMain.handle('get-web-url', () => process.env.pickleglass_WEB_URL || 'http://localhost:3000');

    // Ollama
    ipcMain.handle('ollama:get-status', async () => await ollamaService.handleGetStatus());
    ipcMain.handle('ollama:install', async () => await ollamaService.handleInstall());
    ipcMain.handle('ollama:start-service', async () => await ollamaService.handleStartService());
    ipcMain.handle('ollama:ensure-ready', async () => await ollamaService.handleEnsureReady());
    ipcMain.handle('ollama:get-models', async () => await ollamaService.handleGetModels());
    ipcMain.handle('ollama:get-model-suggestions', async () => await ollamaService.handleGetModelSuggestions());
    ipcMain.handle('ollama:pull-model', async (event, modelName) => await ollamaService.handlePullModel(modelName));
    ipcMain.handle('ollama:is-model-installed', async (event, modelName) => await ollamaService.handleIsModelInstalled(modelName));
    ipcMain.handle('ollama:warm-up-model', async (event, modelName) => await ollamaService.handleWarmUpModel(modelName));
    ipcMain.handle('ollama:auto-warm-up', async () => await ollamaService.handleAutoWarmUp());
    ipcMain.handle('ollama:get-warm-up-status', async () => await ollamaService.handleGetWarmUpStatus());
    ipcMain.handle('ollama:shutdown', async (event, force = false) => await ollamaService.handleShutdown(force));

    // Ask
    ipcMain.handle('ask:sendQuestionFromAsk', async (event, userPrompt) => await askService.sendMessage(userPrompt));
    ipcMain.handle('ask:sendQuestionFromSummary', async (event, userPrompt) => await askService.sendMessage(userPrompt));
    ipcMain.handle('ask:toggleAskButton', async () => await askService.toggleAskButton());
    ipcMain.handle('ask:closeAskWindow',  async () => await askService.closeAskWindow());
    
    // Listen
    ipcMain.handle('listen:sendMicAudio', async (event, { data, mimeType }) => {
        // S3: fan out to the Python brain (best-effort; drops if brain offline).
        _fanOutAudioFrameToBrain('mic', data, mimeType);
        // Existing Glass STT path (kept as fallback / still drives the in-Glass UI).
        return await listenService.handleSendMicAudioContent(data, mimeType);
    });
    ipcMain.handle('listen:sendSystemAudio', async (event, { data, mimeType }) => {
        // S3: fan out to brain before the local STT path (which has known issues).
        _fanOutAudioFrameToBrain('system', data, mimeType);
        const result = await listenService.sttService.sendSystemAudioContent(data, mimeType);
        // S0-era Glass bug: result can be undefined when STT is unconfigured;
        // guard against the TypeError so we don't spam errors every ~100ms.
        if (result && result.success) {
            listenService.sendToRenderer('system-audio-data', { data });
        }
        return result;
    });
    ipcMain.handle('listen:startMacosSystemAudio', async () => await listenService.handleStartMacosAudio());
    ipcMain.handle('listen:stopMacosSystemAudio', async () => await listenService.handleStopMacosAudio());
    ipcMain.handle('update-google-search-setting', async (event, enabled) => await listenService.handleUpdateGoogleSearchSetting(enabled));
    ipcMain.handle('listen:changeSession', async (event, listenButtonText) => {
      console.log('[FeatureBridge] listen:changeSession from mainheader', listenButtonText);
      try {
        await listenService.handleListenRequest(listenButtonText);
        return { success: true };
      } catch (error) {
        console.error('[FeatureBridge] listen:changeSession failed', error.message);
        return { success: false, error: error.message };
      }
    });
    // Glass v0.2.4 bug fix: preload.js exposes is-session-active via ipcRenderer.invoke
    // but no main-side handler was registered. listenCapture.js:508 throws as a result,
    // killing Windows audio capture entirely. See Glass issues #201/#193/#165.
    ipcMain.handle('is-session-active', () => listenService.isSessionActive());

    // ModelStateService
    ipcMain.handle('model:validate-key', async (e, { provider, key }) => await modelStateService.handleValidateKey(provider, key));
    ipcMain.handle('model:get-all-keys', () => modelStateService.getAllApiKeys());
    ipcMain.handle('model:set-api-key', async (e, { provider, key }) => await modelStateService.setApiKey(provider, key));
    ipcMain.handle('model:remove-api-key', async (e, provider) => await modelStateService.handleRemoveApiKey(provider));
    ipcMain.handle('model:get-selected-models', () => modelStateService.getSelectedModels());
    ipcMain.handle('model:set-selected-model', async (e, { type, modelId }) => await modelStateService.handleSetSelectedModel(type, modelId));
    ipcMain.handle('model:get-available-models', (e, { type }) => modelStateService.getAvailableModels(type));
    ipcMain.handle('model:are-providers-configured', () => modelStateService.areProvidersConfigured());
    ipcMain.handle('model:get-provider-config', () => modelStateService.getProviderConfig());

    console.log('[FeatureBridge] Initialized with all feature handlers.');
  },

  // Renderer로 상태를 전송
  sendAskProgress(win, progress) {
    win.webContents.send('feature:ask:progress', progress);
  },
};