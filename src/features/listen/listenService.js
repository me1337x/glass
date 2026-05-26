const { BrowserWindow, app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const SttService = require('./stt/sttService');
const SummaryService = require('./summary/summaryService');
const authService = require('../common/services/authService');
const sessionRepository = require('../common/repositories/session');
const sttRepository = require('./stt/repositories');
const internalBridge = require('../../bridge/internalBridge');
const brainBridge = require('../../brain-bridge');
const projectFoldersStore = require('../settings/projectFoldersStore');
const { EVENTS } = internalBridge;

// 2026-05-26: per-session meeting-folder picker. The user picks where to
// save transcripts + agent outputs on each Listen click; we remember the
// last choice across launches. See docs/PROTOCOL.md (meetings_dir field
// on meeting.start) and docs/PROPOSAL-cowork-integration.md.
const LAST_MEETINGS_DIR_FILE = path.join(app.getPath('userData'), 'last-meetings-dir.txt');

function readLastMeetingsDir() {
    try {
        const p = fs.readFileSync(LAST_MEETINGS_DIR_FILE, 'utf-8').trim();
        return p && fs.existsSync(p) ? p : null;
    } catch (_) {
        return null;
    }
}

function writeLastMeetingsDir(dirPath) {
    try {
        fs.writeFileSync(LAST_MEETINGS_DIR_FILE, dirPath, 'utf-8');
    } catch (e) {
        console.warn('[ListenService] could not persist last meetings dir:', e.message);
    }
}

/**
 * Show an Electron folder picker. Returns the absolute path the user picked,
 * or null if they cancelled. Defaults to the last-used dir if any.
 */
async function pickMeetingsDir() {
    const lastDir = readLastMeetingsDir();
    const defaultPath = lastDir || app.getPath('documents');
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Choose folder for meeting transcripts',
        message: 'Pick a project folder. Meeting files (transcript, summary, actions) land in <folder>/meetings/<session>/.',
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Use this folder',
    });
    if (canceled || !filePaths || filePaths.length === 0) {
        return null;
    }
    const chosen = filePaths[0];
    writeLastMeetingsDir(chosen);
    return chosen;
}

class ListenService {
    constructor() {
        this.sttService = new SttService();
        this.summaryService = new SummaryService();
        this.currentSessionId = null;
        this.isInitializingSession = false;

        this.setupServiceCallbacks();
        console.log('[ListenService] Service instance created.');
    }

    setupServiceCallbacks() {
        // STT service callbacks
        this.sttService.setCallbacks({
            onTranscriptionComplete: (speaker, text) => {
                this.handleTranscriptionComplete(speaker, text);
            },
            onStatusUpdate: (status) => {
                this.sendToRenderer('update-status', status);
            }
        });

        // Summary service callbacks
        this.summaryService.setCallbacks({
            onAnalysisComplete: (data) => {
                console.log('📊 Analysis completed:', data);
            },
            onStatusUpdate: (status) => {
                this.sendToRenderer('update-status', status);
            }
        });
    }

    sendToRenderer(channel, data) {
        const { windowPool } = require('../../window/windowManager');
        const listenWindow = windowPool?.get('listen');
        
        if (listenWindow && !listenWindow.isDestroyed()) {
            listenWindow.webContents.send(channel, data);
        }
    }

    initialize() {
        this.setupIpcHandlers();
        console.log('[ListenService] Initialized and ready.');
    }

    async handleListenRequest(listenButtonText) {
        const { windowPool, updateLayout } = require('../../window/windowManager');
        const listenWindow = windowPool.get('listen');
        const header = windowPool.get('header');

        try {
            switch (listenButtonText) {
                case 'Listen':
                    console.log('[ListenService] changeSession to "Listen"');
                    listenWindow.show();
                    updateLayout();
                    listenWindow.webContents.send('window-show-animation');
                    await this.initializeSession();
                    listenWindow.webContents.send('session-state-changed', { isActive: true });
                    break;
        
                case 'Stop':
                    console.log('[ListenService] changeSession to "Stop"');
                    await this.closeSession();
                    listenWindow.webContents.send('session-state-changed', { isActive: false });
                    break;
        
                case 'Done':
                    console.log('[ListenService] changeSession to "Done"');
                    listenWindow.webContents.send('window-hide-animation');
                    listenWindow.webContents.send('session-state-changed', { isActive: false });
                    break;
        
                default:
                    throw new Error(`[ListenService] unknown listenButtonText: ${listenButtonText}`);
            }
            
            header.webContents.send('listen:changeSessionResult', { success: true });

        } catch (error) {
            console.error('[ListenService] error in handleListenRequest:', error);
            header.webContents.send('listen:changeSessionResult', { success: false });
            throw error; 
        }
    }

    initialize() {
        this.setupIpcHandlers();
        console.log('[ListenService] Initialized and ready.');
    }

    async handleListenRequest(listenButtonText) {
        const { windowPool, updateLayout } = require('../../window/windowManager');
        const listenWindow = windowPool.get('listen');
        const header = windowPool.get('header');

        try {
            switch (listenButtonText) {
                case 'Listen':
                    console.log('[ListenService] changeSession to "Listen"');

                    // 2026-05-26: ask the user where to save this meeting's
                    // files BEFORE doing any state changes. Cancel = abort.
                    const meetingsDir = await pickMeetingsDir();
                    if (!meetingsDir) {
                        console.log('[ListenService] meetings-dir picker cancelled — aborting Listen');
                        header.webContents.send('listen:changeSessionResult', { success: false, reason: 'cancelled' });
                        return;
                    }
                    console.log(`[ListenService] meetings dir for this session: ${meetingsDir}`);

                    internalBridge.emit('request-window-visibility', { name: 'listen', visible: true });
                    await this.initializeSession();
                    listenWindow.webContents.send('session-state-changed', { isActive: true });

                    // 2026-05-26 — S4.7: detect whether the chosen folder lives
                    // under any registered parent project folder. If so, the
                    // meeting is "project-aware" — the brain stores
                    // project_root for this session so future agents can Grep
                    // across that root for cross-meeting context.
                    const projectCtx = projectFoldersStore.detectProjectContext(meetingsDir);
                    if (projectCtx.is_inside_project) {
                        console.log(
                            `[ListenService] meeting is project-aware — root: ${projectCtx.project_root}`,
                        );
                    }

                    // Always write sessions under a `meetings/` subfolder of
                    // the user's chosen path. This (a) keeps the project root
                    // clean (other project files live next to a single
                    // meetings/ subdir, not scattered with session subdirs),
                    // and (b) lets the HUD's path math always be
                    // <chosenRoot>/meetings/<id>/. The brain sees the path
                    // verbatim — it doesn't know or care about the convention.
                    const brainMeetingsDir = path.join(meetingsDir, 'meetings');

                    // Notify the brain of the per-session meetings_dir override
                    // plus the project_root if detected. Best-effort: if the
                    // brain isn't connected yet the message is dropped, Glass
                    // continues, and the brain falls back to its default
                    // MEETINGS_DIR with no project awareness for this session.
                    try {
                        brainBridge.send('meeting.start', {
                            session_id: this.currentSessionId,
                            meetings_dir: brainMeetingsDir,
                            project_root: projectCtx.project_root,
                            is_inside_project: projectCtx.is_inside_project,
                        });
                        console.log('[ListenService] sent meeting.start to brain (meetings_dir=' + brainMeetingsDir + ')');
                    } catch (e) {
                        console.warn('[ListenService] failed to send meeting.start to brain:', e.message);
                    }

                    // Tell the Insight HUD to switch its file watcher to the new dir.
                    // The HUD appends `/meetings` itself, so we pass the
                    // user-picked root (NOT brainMeetingsDir) here so both
                    // sides end up watching the same `<chosen>/meetings/` dir.
                    // Pass project_root so the HUD can surface it in the title bar.
                    const hudWindow = windowPool.get('insight-hud');
                    if (hudWindow && !hudWindow.isDestroyed()) {
                        hudWindow.webContents.send('hud:set-meetings-root', meetingsDir);
                        hudWindow.webContents.send(
                            'hud:set-project-root',
                            projectCtx.is_inside_project ? projectCtx.project_root : null,
                        );
                    }
                    break;

                case 'Stop':
                    console.log('[ListenService] changeSession to "Stop"');
                    // Inform brain so it can drop per-session state.
                    if (this.currentSessionId) {
                        try {
                            brainBridge.send('meeting.end', {
                                session_id: this.currentSessionId,
                                reason: 'user_stopped',
                            });
                        } catch (_) { /* best-effort */ }
                    }
                    // S6 (2026-05-27): tell the Listen renderer to stop its
                    // screen-capture loop. Best-effort — renderer ignores
                    // the signal if no capture is running.
                    if (listenWindow && !listenWindow.isDestroyed()) {
                        listenWindow.webContents.send('brain:stopScreenCapture');
                    }
                    await this.closeSession();
                    listenWindow.webContents.send('session-state-changed', { isActive: false });
                    break;

                case 'Done':
                    console.log('[ListenService] changeSession to "Done"');
                    internalBridge.emit('request-window-visibility', { name: 'listen', visible: false });
                    listenWindow.webContents.send('session-state-changed', { isActive: false });
                    break;

                default:
                    throw new Error(`[ListenService] unknown listenButtonText: ${listenButtonText}`);
            }

            header.webContents.send('listen:changeSessionResult', { success: true });

        } catch (error) {
            console.error('[ListenService] error in handleListenRequest:', error);
            header.webContents.send('listen:changeSessionResult', { success: false });
            throw error;
        }
    }

    async handleTranscriptionComplete(speaker, text) {
        console.log(`[ListenService] Transcription complete: ${speaker} - ${text}`);
        
        // Save to database
        await this.saveConversationTurn(speaker, text);
        
        // Add to summary service for analysis
        this.summaryService.addConversationTurn(speaker, text);
    }

    async saveConversationTurn(speaker, transcription) {
        if (!this.currentSessionId) {
            console.error('[DB] Cannot save turn, no active session ID.');
            return;
        }
        if (transcription.trim() === '') return;

        try {
            await sessionRepository.touch(this.currentSessionId);
            await sttRepository.addTranscript({
                sessionId: this.currentSessionId,
                speaker: speaker,
                text: transcription.trim(),
            });
            console.log(`[DB] Saved transcript for session ${this.currentSessionId}: (${speaker})`);
        } catch (error) {
            console.error('Failed to save transcript to DB:', error);
        }
    }

    async initializeNewSession() {
        try {
            // The UID is no longer passed to the repository method directly.
            // The adapter layer handles UID injection. We just ensure a user is available.
            const user = authService.getCurrentUser();
            if (!user) {
                // This case should ideally not happen as authService initializes a default user.
                throw new Error("Cannot initialize session: auth service not ready.");
            }
            
            this.currentSessionId = await sessionRepository.getOrCreateActive('listen');
            console.log(`[DB] New listen session ensured: ${this.currentSessionId}`);

            // Set session ID for summary service
            this.summaryService.setSessionId(this.currentSessionId);
            
            // Reset conversation history
            this.summaryService.resetConversationHistory();

            console.log('New conversation session started:', this.currentSessionId);
            return true;
        } catch (error) {
            console.error('Failed to initialize new session in DB:', error);
            this.currentSessionId = null;
            return false;
        }
    }

    async initializeSession(language = 'en') {
        if (this.isInitializingSession) {
            console.log('Session initialization already in progress.');
            return false;
        }

        this.isInitializingSession = true;
        this.sendToRenderer('session-initializing', true);
        this.sendToRenderer('update-status', 'Initializing sessions...');

        try {
            // Initialize database session
            const sessionInitialized = await this.initializeNewSession();
            if (!sessionInitialized) {
                throw new Error('Failed to initialize database session');
            }

            /* ---------- STT Initialization Retry Logic ---------- */
            // 2026-05-26 — S4.8 — short-circuit when brain is connected.
            // Brain owns STT per ADR-012; Glass's local Whisper path is a
            // pre-existing fallback that's known-broken on Windows (EPERM
            // on whisper-tiny.bin + a CLI-arg bug invoking the `whisper`
            // CLI per audio chunk). Trying to init it produces ~120 lines
            // of noise per meeting for zero benefit. Skip if brain is up.
            let sttReady = false;
            if (brainBridge.connected) {
                console.log('[ListenService] Skipping local Whisper STT init — brain is connected and owns STT (ADR-012).');
                sttReady = true;
            } else {
                console.log('[ListenService] Brain not connected — falling back to local Whisper STT init.');
                const MAX_RETRY = 10;
                const RETRY_DELAY_MS = 300;   // 0.3 seconds

                for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
                    try {
                        await this.sttService.initializeSttSessions(language);
                        sttReady = true;
                        break;                         // Exit on success
                    } catch (err) {
                        console.warn(
                            `[ListenService] STT init attempt ${attempt} failed: ${err.message}`
                        );
                        if (attempt < MAX_RETRY) {
                            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                        }
                    }
                }
                if (!sttReady) throw new Error('STT init failed after retries');
            }
            /* ------------------------------------------- */

            console.log('✅ Listen service initialized successfully.');
            
            this.sendToRenderer('update-status', 'Connected. Ready to listen.');
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize listen service:', error);
            this.sendToRenderer('update-status', 'Initialization failed.');
            return false;
        } finally {
            this.isInitializingSession = false;
            this.sendToRenderer('session-initializing', false);
            this.sendToRenderer('change-listen-capture-state', { status: "start" });
        }
    }

    async sendMicAudioContent(data, mimeType) {
        return await this.sttService.sendMicAudioContent(data, mimeType);
    }

    async startMacOSAudioCapture() {
        if (process.platform !== 'darwin') {
            throw new Error('macOS audio capture only available on macOS');
        }
        return await this.sttService.startMacOSAudioCapture();
    }

    async stopMacOSAudioCapture() {
        this.sttService.stopMacOSAudioCapture();
    }

    isSessionActive() {
        // 2026-05-26 — S4.8 follow-up. When brain is connected, S4.8 skips
        // local STT init (mySttSession / theirSttSession stay null), so
        // sttService.isSessionActive() returns false. But the renderer-side
        // audio capture loop (listenCapture.js) checks this before starting
        // mic + system capture and refuses to proceed if false — meaning
        // audio never flows to the brain either. Treat brain-connected
        // sessions as active for capture-gating purposes; the brain's
        // transcript_sink is the source of truth for whether transcripts
        // actually land.
        if (brainBridge.connected && this.currentSessionId) {
            return true;
        }
        return this.sttService.isSessionActive();
    }

    async closeSession() {
        try {
            this.sendToRenderer('change-listen-capture-state', { status: "stop" });
            // Close STT sessions
            await this.sttService.closeSessions();

            await this.stopMacOSAudioCapture();

            // End database session
            if (this.currentSessionId) {
                await sessionRepository.end(this.currentSessionId);
                console.log(`[DB] Session ${this.currentSessionId} ended.`);
            }

            // Reset state
            this.currentSessionId = null;
            this.summaryService.resetConversationHistory();

            console.log('Listen service session closed.');
            return { success: true };
        } catch (error) {
            console.error('Error closing listen service session:', error);
            return { success: false, error: error.message };
        }
    }

    getCurrentSessionData() {
        return {
            sessionId: this.currentSessionId,
            conversationHistory: this.summaryService.getConversationHistory(),
            totalTexts: this.summaryService.getConversationHistory().length,
            analysisData: this.summaryService.getCurrentAnalysisData(),
        };
    }

    getConversationHistory() {
        return this.summaryService.getConversationHistory();
    }

    _createHandler(asyncFn, successMessage, errorMessage) {
        return async (...args) => {
            try {
                const result = await asyncFn.apply(this, args);
                if (successMessage) console.log(successMessage);
                // `startMacOSAudioCapture`는 성공 시 { success, error } 객체를 반환하지 않으므로,
                // 핸들러가 일관된 응답을 보내도록 여기서 success 객체를 반환합니다.
                // 다른 함수들은 이미 success 객체를 반환합니다.
                return result && typeof result.success !== 'undefined' ? result : { success: true };
            } catch (e) {
                console.error(errorMessage, e);
                return { success: false, error: e.message };
            }
        };
    }

    // `_createHandler`를 사용하여 핸들러들을 동적으로 생성합니다.
    handleSendMicAudioContent = this._createHandler(
        this.sendMicAudioContent,
        null,
        'Error sending user audio:'
    );

    handleStartMacosAudio = this._createHandler(
        async () => {
            if (process.platform !== 'darwin') {
                return { success: false, error: 'macOS audio capture only available on macOS' };
            }
            if (this.sttService.isMacOSAudioRunning?.()) {
                return { success: false, error: 'already_running' };
            }
            await this.startMacOSAudioCapture();
            return { success: true, error: null };
        },
        'macOS audio capture started.',
        'Error starting macOS audio capture:'
    );
    
    handleStopMacosAudio = this._createHandler(
        this.stopMacOSAudioCapture,
        'macOS audio capture stopped.',
        'Error stopping macOS audio capture:'
    );

    handleUpdateGoogleSearchSetting = this._createHandler(
        async (enabled) => {
            console.log('Google Search setting updated to:', enabled);
        },
        null,
        'Error updating Google Search setting:'
    );
}

const listenService = new ListenService();
module.exports = listenService;