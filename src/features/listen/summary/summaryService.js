// src/features/listen/summary/summaryService.js
//
// S9 (2026-05-30, ADR-013): the original Glass analysis pipeline called an LLM
// directly from this main-process module (createLLM -> llm.chat) to generate
// live summaries. That violates ADR-012 — no LLM in Glass JS; all intelligence
// runs as Claude Code subagents writing files the brain owns. Per ADR-013 the
// native "Live Insights" panel is now fed by meetingFilesService (which reads
// the brain's per-meeting markdown files), so the LLM path is removed.
//
// This stub remains only to preserve the small surface listenService still
// calls (conversation-history bookkeeping behind the session-data IPC getter).
// It performs NO analysis and contacts NO model.

class SummaryService {
    constructor() {
        this.conversationHistory = [];
        this.currentSessionId = null;
        this.onAnalysisComplete = null;
        this.onStatusUpdate = null;
    }

    setCallbacks({ onAnalysisComplete, onStatusUpdate } = {}) {
        this.onAnalysisComplete = onAnalysisComplete || null;
        this.onStatusUpdate = onStatusUpdate || null;
    }

    setSessionId(sessionId) {
        this.currentSessionId = sessionId;
    }

    addConversationTurn(speaker, text) {
        // Bookkeeping only — no LLM analysis (ADR-012 / ADR-013). The brain
        // owns transcription; the Live Insights panel renders brain files via
        // meetingFilesService.
        this.conversationHistory.push(`${String(speaker).toLowerCase()}: ${String(text).trim()}`);
    }

    getConversationHistory() {
        return this.conversationHistory;
    }

    resetConversationHistory() {
        this.conversationHistory = [];
    }

    getCurrentAnalysisData() {
        // Analysis is no longer produced in Glass; kept for API compatibility.
        return {
            previousResult: null,
            history: [],
            conversationLength: this.conversationHistory.length,
        };
    }
}

module.exports = SummaryService;
