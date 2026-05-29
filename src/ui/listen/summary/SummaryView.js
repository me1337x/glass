import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class SummaryView extends LitElement {
    static styles = css`
        :host {
            display: block;
            width: 100%;
        }

        /* Inherit font styles from parent */

        /* highlight.js 스타일 추가 */
        .insights-container pre {
            background: rgba(0, 0, 0, 0.4) !important;
            border-radius: 8px !important;
            padding: 12px !important;
            margin: 8px 0 !important;
            overflow-x: auto !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            white-space: pre !important;
            word-wrap: normal !important;
            word-break: normal !important;
        }

        .insights-container code {
            font-family: 'Monaco', 'Menlo', 'Consolas', monospace !important;
            font-size: 11px !important;
            background: transparent !important;
            white-space: pre !important;
            word-wrap: normal !important;
            word-break: normal !important;
        }

        .insights-container pre code {
            white-space: pre !important;
            word-wrap: normal !important;
            word-break: normal !important;
            display: block !important;
        }

        .insights-container p code {
            background: rgba(255, 255, 255, 0.1) !important;
            padding: 2px 4px !important;
            border-radius: 3px !important;
            color: #ffd700 !important;
        }

        .hljs-keyword {
            color: #ff79c6 !important;
        }
        .hljs-string {
            color: #f1fa8c !important;
        }
        .hljs-comment {
            color: #6272a4 !important;
        }
        .hljs-number {
            color: #bd93f9 !important;
        }
        .hljs-function {
            color: #50fa7b !important;
        }
        .hljs-variable {
            color: #8be9fd !important;
        }
        .hljs-built_in {
            color: #ffb86c !important;
        }
        .hljs-title {
            color: #50fa7b !important;
        }
        .hljs-attr {
            color: #50fa7b !important;
        }
        .hljs-tag {
            color: #ff79c6 !important;
        }

        .insights-container {
            overflow-y: auto;
            padding: 12px 16px 16px 16px;
            position: relative;
            z-index: 1;
            min-height: 150px;
            max-height: 600px;
            flex: 1;
        }

        /* Visibility handled by parent component */

        .insights-container::-webkit-scrollbar {
            width: 8px;
        }
        .insights-container::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.1);
            border-radius: 4px;
        }
        .insights-container::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.3);
            border-radius: 4px;
        }
        .insights-container::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.5);
        }

        insights-title {
            color: rgba(255, 255, 255, 0.8);
            font-size: 15px;
            font-weight: 500;
            font-family: 'Helvetica Neue', sans-serif;
            margin: 12px 0 8px 0;
            display: block;
        }

        .insights-container h4 {
            color: #ffffff;
            font-size: 12px;
            font-weight: 600;
            margin: 12px 0 8px 0;
            padding: 4px 8px;
            border-radius: 4px;
            background: transparent;
            cursor: default;
        }

        .insights-container h4:hover {
            background: transparent;
        }

        .insights-container h4:first-child {
            margin-top: 0;
        }

        .outline-item {
            color: #ffffff;
            font-size: 11px;
            line-height: 1.4;
            margin: 4px 0;
            padding: 6px 8px;
            border-radius: 4px;
            background: transparent;
            transition: background-color 0.15s ease;
            cursor: pointer;
            word-wrap: break-word;
        }

        .outline-item:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .request-item {
            color: #ffffff;
            font-size: 12px;
            line-height: 1.2;
            margin: 4px 0;
            padding: 6px 8px;
            border-radius: 4px;
            background: transparent;
            cursor: default;
            word-wrap: break-word;
            transition: background-color 0.15s ease;
        }

        .request-item.clickable {
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .request-item.clickable:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: translateX(2px);
        }

        /* 마크다운 렌더링된 콘텐츠 스타일 */
        .markdown-content {
            color: #ffffff;
            font-size: 11px;
            line-height: 1.4;
            margin: 4px 0;
            padding: 6px 8px;
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            word-wrap: break-word;
            transition: all 0.15s ease;
        }

        .markdown-content:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: translateX(2px);
        }

        /* S9: file sections are read-only (not click-to-Ask) — no hover affordance. */
        .file-section {
            cursor: default;
        }
        .file-section:hover {
            background: transparent;
            transform: none;
        }

        .markdown-content p {
            margin: 4px 0;
        }

        .markdown-content ul,
        .markdown-content ol {
            margin: 4px 0;
            padding-left: 16px;
        }

        .markdown-content li {
            margin: 2px 0;
        }

        .markdown-content a {
            color: #8be9fd;
            text-decoration: none;
        }

        .markdown-content a:hover {
            text-decoration: underline;
        }

        .markdown-content strong {
            font-weight: 600;
            color: #f8f8f2;
        }

        .markdown-content em {
            font-style: italic;
            color: #f1fa8c;
        }

        .empty-state {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100px;
            color: rgba(255, 255, 255, 0.6);
            font-size: 12px;
            font-style: italic;
        }
    `;

    static properties = {
        meetingFiles: { type: Object },
        isVisible: { type: Boolean },
        hasCompletedRecording: { type: Boolean },
    };

    // S9 (ADR-013): the brain's per-meeting files, in display order.
    // [stateKey, sectionTitle]; stateKey matches meetingFilesService keys.
    static SECTIONS = [
        ['summary', 'Summary'],
        ['actions', 'Action items'],
        ['decisions', 'Decisions'],
        ['timeline', 'Timeline'],
        ['suggestions', 'Suggestions'],
        ['roster', 'Speaker roster'],
        ['visualContext', 'Visual context'],
        ['advisor', 'Advisor'],
    ];

    constructor() {
        super();
        this.meetingFiles = {};
        this.meetingName = null;
        this.isVisible = true;
        this.hasCompletedRecording = false;

        // 마크다운 라이브러리 초기화
        this.marked = null;
        this.hljs = null;
        this.isLibrariesLoaded = false;
        this.DOMPurify = null;
        this.isDOMPurifyLoaded = false;

        this.loadLibraries();
    }

    connectedCallback() {
        super.connectedCallback();
        if (window.api) {
            // S9 (ADR-013): render the brain's per-meeting files pushed from
            // the main process (meetingFilesService) — not LLM analysis.
            window.api.summaryView.onMeetingFilesUpdate((event, data) => {
                this.meetingFiles = (data && data.files) || {};
                this.meetingName = (data && data.meetingName) || null;
                this.requestUpdate();
            });
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (window.api) {
            window.api.summaryView.removeAllMeetingFilesUpdateListeners();
        }
    }

    // Handle session reset from parent
    resetAnalysis() {
        this.meetingFiles = {};
        this.meetingName = null;
        this.requestUpdate();
    }

    async loadLibraries() {
        try {
            if (!window.marked) {
                await this.loadScript('../../../assets/marked-4.3.0.min.js');
            }

            if (!window.hljs) {
                await this.loadScript('../../../assets/highlight-11.9.0.min.js');
            }

            if (!window.DOMPurify) {
                await this.loadScript('../../../assets/dompurify-3.0.7.min.js');
            }

            this.marked = window.marked;
            this.hljs = window.hljs;
            this.DOMPurify = window.DOMPurify;

            if (this.marked && this.hljs) {
                this.marked.setOptions({
                    highlight: (code, lang) => {
                        if (lang && this.hljs.getLanguage(lang)) {
                            try {
                                return this.hljs.highlight(code, { language: lang }).value;
                            } catch (err) {
                                console.warn('Highlight error:', err);
                            }
                        }
                        try {
                            return this.hljs.highlightAuto(code).value;
                        } catch (err) {
                            console.warn('Auto highlight error:', err);
                        }
                        return code;
                    },
                    breaks: true,
                    gfm: true,
                    pedantic: false,
                    smartypants: false,
                    xhtml: false,
                });

                this.isLibrariesLoaded = true;
                console.log('Markdown libraries loaded successfully');
            }

            if (this.DOMPurify) {
                this.isDOMPurifyLoaded = true;
                console.log('DOMPurify loaded successfully in SummaryView');
            }
        } catch (error) {
            console.error('Failed to load libraries:', error);
        }
    }

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    parseMarkdown(text) {
        if (!text) return '';

        if (!this.isLibrariesLoaded || !this.marked) {
            return text;
        }

        try {
            return this.marked(text);
        } catch (error) {
            console.error('Markdown parsing error:', error);
            return text;
        }
    }

    handleMarkdownClick(originalText) {
        this.handleRequestClick(originalText);
    }

    renderMarkdownContent() {
        if (!this.isLibrariesLoaded || !this.marked) {
            return;
        }

        const markdownElements = this.shadowRoot.querySelectorAll('[data-markdown-id]');
        markdownElements.forEach(element => {
            const originalText = element.getAttribute('data-original-text');
            if (originalText) {
                try {
                    let parsedHTML = this.parseMarkdown(originalText);

                    if (this.isDOMPurifyLoaded && this.DOMPurify) {
                        parsedHTML = this.DOMPurify.sanitize(parsedHTML);

                        if (this.DOMPurify.removed && this.DOMPurify.removed.length > 0) {
                            console.warn('Unsafe content detected in insights, showing plain text');
                            element.textContent = '⚠️ ' + originalText;
                            return;
                        }
                    }

                    element.innerHTML = parsedHTML;
                } catch (error) {
                    console.error('Error rendering markdown for element:', error);
                    element.textContent = originalText;
                }
            }
        });
    }

    async handleRequestClick(requestText) {
        console.log('🔥 Analysis request clicked:', requestText);

        if (window.api) {
            try {
                const result = await window.api.summaryView.sendQuestionFromSummary(requestText);

                if (result.success) {
                    console.log('✅ Question sent to AskView successfully');
                } else {
                    console.error('❌ Failed to send question to AskView:', result.error);
                }
            } catch (error) {
                console.error('❌ Error in handleRequestClick:', error);
            }
        }
    }

    getSummaryText() {
        const files = this.meetingFiles || {};
        const sections = [];
        for (const [key, title] of SummaryView.SECTIONS) {
            const content = files[key];
            if (content && content.trim()) {
                sections.push(`## ${title}\n\n${content.trim()}`);
            }
        }
        return sections.join('\n\n').trim();
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        this.renderMarkdownContent();
    }

    render() {
        if (!this.isVisible) {
            return html`<div style="display: none;"></div>`;
        }

        const files = this.meetingFiles || {};
        const present = SummaryView.SECTIONS.filter(([key]) => files[key] && files[key].trim());

        return html`
            <div class="insights-container">
                ${present.length === 0
                    ? html`<div class="empty-state">No insights yet...</div>`
                    : present.map(
                          ([key, title]) => html`
                              <insights-title>${title}</insights-title>
                              <div
                                  class="markdown-content file-section"
                                  data-markdown-id="file-${key}"
                                  data-original-text="${files[key]}"
                              >
                                  ${files[key]}
                              </div>
                          `
                      )}
            </div>
        `;
    }
}

customElements.define('summary-view', SummaryView); 