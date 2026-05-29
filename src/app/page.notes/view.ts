import { OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Converter } from 'showdown';
import { NuMonacoEditorEvent } from '@ng-util/monaco-editor';

type ViewMode = 'write' | 'split' | 'preview';

interface PreviewBlock {
    type: 'markdown' | 'code' | 'blank';
    lineIndex: number;
    lineEnd?: number;
    lineNumbers?: number[];
    variant?: 'quote' | 'table' | 'divider' | 'task' | 'heading' | 'list' | 'text';
    joinsPrevious?: boolean;
    joinsNext?: boolean;
    html?: SafeHtml;
    language?: string;
    code?: string;
    sectionStyle?: string;
    sectionClassName?: string;
    sectionHasTextStyle?: boolean;
}

interface NoteItem {
    id: string;
    icon: string;
    title: string;
    body: string;
    tags: string[];
    createdAt: string;
    createdAtMs: number;
    updatedAt: string;
    updatedAtMs: number;
    status: 'draft' | 'active' | 'archived';
    folder?: string;
    workspaceName?: string;
    fileName?: string;
    relativePath?: string;
}

interface DocumentSectionStyle {
    id: number;
    style: string;
    className: string;
    hasTextStyle: boolean;
}

interface StyledMarkdownLine {
    text: string;
    lineIndex: number;
    section?: DocumentSectionStyle;
}

interface ParsedDocumentStyles {
    lines: StyledMarkdownLine[];
    globalStyle: string;
    globalHasTextStyle: boolean;
    stylesheet: string;
}

interface StyleRule {
    selector: string;
    style: string;
}

interface ParsedStyleBlock {
    style: string;
    rules: StyleRule[];
    hasTextStyle: boolean;
}

export class Component implements OnInit, OnDestroy {
    private storageKey = 'notedown.notes.v1';
    private activeNoteKey = 'notedown.activeNoteId.v1';
    private converter = new Converter({ tables: true, tasklists: true, strikethrough: true, simpleLineBreaks: true });
    private editor: any;
    private completionDisposable: any;
    private foldingDisposable: any;
    private editorMouseMoveDisposable: any;
    private editorMouseLeaveDisposable: any;
    private styleFoldTimeout: number | null = null;
    private autoFoldedStyleNoteId = '';
    private hoveredLineDecorationIds: string[] = [];

    private settingsKey = 'notedown.settings.v1';
    public viewMode: ViewMode = 'split';
    public savedAt = '';
    public showLineNumbers = false;
    public notes: NoteItem[] = this.defaultNotes();
    public activeNote: NoteItem = this.notes[0];
    public editorOptions: any = this.createEditorOptions();
    public previewBlocks: PreviewBlock[] = [];
    public previewHoveredLine: number | null = null;
    public documentGlobalStyle = '';
    public documentGlobalHasTextStyle = false;
    public documentStyleCss = '';
    public editingTitle = false;
    public titleDraft = '';

    public get hasSelectedNote() {
        return Boolean(this.activeNote?.id);
    }

    public noteTitleLabel() {
        return this.activeNote?.title?.trim() || '제목 없음';
    }

    private handleSelectNote = (event: Event) => {
        const id = (event as CustomEvent<string>).detail;
        if (id) this.selectNoteById(id);
    };

    private handleNotesChanged = async (event: Event) => {
        const source = (event as CustomEvent<{ source?: string }>).detail?.source;
        if (source === 'page.notes') return;

        const activeId = this.activeNote?.id;
        await this.loadNotes(false);
        this.selectNoteById(localStorage.getItem(this.activeNoteKey) || activeId);
    };
    private handleSettingsChanged = () => {
        this.viewMode = this.settingsViewMode();
        this.refreshEditorOptions();
        this.focusEditorSoon();
    };

    constructor(private sanitizer: DomSanitizer) { }

    public async ngOnInit() {
        this.viewMode = this.settingsViewMode();
        this.editorOptions = this.createEditorOptions();
        await this.loadNotes(true);
        window.addEventListener('notedown:select-note', this.handleSelectNote);
        window.addEventListener('notedown:notes-changed', this.handleNotesChanged);
        window.addEventListener('notedown:settings-changed', this.handleSettingsChanged);
    }

    public ngOnDestroy() {
        window.removeEventListener('notedown:select-note', this.handleSelectNote);
        window.removeEventListener('notedown:notes-changed', this.handleNotesChanged);
        window.removeEventListener('notedown:settings-changed', this.handleSettingsChanged);
        if (this.completionDisposable) this.completionDisposable.dispose();
        if (this.foldingDisposable) this.foldingDisposable.dispose();
        this.clearScheduledStyleFold();
        this.disposeEditorHoverHandlers();
    }

    public createNote() {
        const now = Date.now();
        const note: NoteItem = {
            id: `note-${Date.now()}`,
            icon: 'N',
            title: '새 노트',
            tags: ['draft'],
            status: 'draft',
            folder: 'memo',
            createdAt: this.nowLabel(new Date(now)),
            createdAtMs: now,
            updatedAt: this.nowLabel(new Date(now)),
            updatedAtMs: now,
            body: '# 새 노트\n\n'
        };
        this.notes = [note, ...this.notes];
        this.activeNote = note;
        this.persist(true);
        this.refreshPreview();
        this.focusEditorSoon();
    }

    public handleBodyChange(nextBody: string) {
        if (!this.hasSelectedNote) return;

        const body = typeof nextBody === 'string' ? nextBody : '';
        if (this.activeNote.body === body) return;

        this.activeNote.body = body;
        this.touchNote();
    }

    public touchNote() {
        if (!this.hasSelectedNote) return;
        const now = Date.now();
        this.activeNote.updatedAt = this.nowLabel(new Date(now));
        this.activeNote.updatedAtMs = now;
        this.persist(true);
        this.refreshPreview();
    }

    public startTitleEdit() {
        if (!this.hasSelectedNote) return;
        this.titleDraft = this.activeNote.title || '';
        this.editingTitle = true;

        setTimeout(() => {
            const input = document.querySelector<HTMLInputElement>('[data-note-title-input="true"]');
            input?.focus();
            input?.select();
        });
    }

    public commitTitleEdit() {
        if (!this.editingTitle) return;
        this.editingTitle = false;
        if (!this.hasSelectedNote) return;

        const nextTitle = this.titleDraft;
        if ((this.activeNote.title || '') === nextTitle) return;

        this.activeNote.title = nextTitle;
        this.touchNote();
    }

    public cancelTitleEdit() {
        this.titleDraft = this.activeNote?.title || '';
        this.editingTitle = false;
    }

    public setMode(mode: ViewMode) {
        this.viewMode = mode;
        this.focusEditorSoon();
    }

    public toggleLineNumbers() {
        this.showLineNumbers = !this.showLineNumbers;
        this.editorOptions = this.createEditorOptions();
        if (this.editor) this.editor.updateOptions({ lineNumbers: this.showLineNumbers ? 'on' : 'off' });
    }

    public createdAtLabel() {
        const createdAtMs = this.activeNote?.createdAtMs;
        if (typeof createdAtMs === 'number' && Number.isFinite(createdAtMs) && createdAtMs > 0) {
            return this.nowLabel(new Date(createdAtMs));
        }

        return this.activeNote?.createdAt || '';
    }

    public lastSavedLabel() {
        const updatedAtMs = this.activeNote?.updatedAtMs;
        if (typeof updatedAtMs === 'number' && Number.isFinite(updatedAtMs) && updatedAtMs > 0) {
            return this.nowLabel(new Date(updatedAtMs));
        }

        return this.activeNote?.updatedAt || this.savedAt || '';
    }

    public async exportNotePdf() {
        if (!this.hasSelectedNote) return;

        const html = this.buildPdfDocumentHtml();
        const pdfApi = (window as any).notedown?.pdf;
        if (pdfApi?.saveNote) {
            try {
                const result = await pdfApi.saveNote({
                    title: this.activeNote.title || '제목 없음',
                    html
                });
                if (result?.ok || result?.canceled) return;
            } catch (error) {
                // Fall through to the browser print path when Electron PDF export is unavailable.
            }
        }

        this.openPdfPrintWindow(html);
    }

    public previewHtml(): SafeHtml {
        const html = this.converter.makeHtml(this.activeNote?.body || '');
        return this.sanitizer.bypassSecurityTrustHtml(html);
    }

    public handlePreviewClick(event: MouseEvent) {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const taskCheckbox = target.closest('input[data-task-line]') as HTMLInputElement | null;
        if (taskCheckbox) {
            const lineIndex = Number(taskCheckbox.dataset['taskLine']);
            if (Number.isFinite(lineIndex)) {
                event.preventDefault();
                this.toggleTaskLine(lineIndex, taskCheckbox.checked);
            }
            return;
        }

        const taskControl = target.closest('[data-task-line]') as HTMLElement | null;
        if (taskControl) {
            const lineIndex = Number(taskControl.dataset['taskLine']);
            if (Number.isFinite(lineIndex)) {
                event.preventDefault();
                this.toggleTaskLine(lineIndex, !this.isTaskLineChecked(lineIndex));
            }
            return;
        }

        const link = target.closest('a[href]') as HTMLAnchorElement | null;
        if (link) {
            event.preventDefault();
            window.open(link.href, '_blank', 'noopener,noreferrer');
        }
    }

    public handlePreviewMouseOver(event: MouseEvent) {
        const target = event.target as HTMLElement | null;
        const row = target?.closest('[data-preview-line]') as HTMLElement | null;
        if (!row) {
            this.clearSyncedLineHover();
            return;
        }

        const lineIndex = Number(row.dataset['previewLine']);
        if (Number.isFinite(lineIndex)) this.setSyncedLineHover(lineIndex, true);
    }

    public clearSyncedLineHover() {
        this.previewHoveredLine = null;
        this.clearEditorLineHover();
    }

    public onEditorEvent(event: NuMonacoEditorEvent) {
        if (event.type !== 'init' && event.type !== 're-init') return;
        this.editor = event.editor;
        this.configureMarkdownEditor();
    }

    public modeButtonClass(mode: ViewMode) {
        const base = 'flex size-8 items-center justify-center rounded-md transition-colors';
        if (this.viewMode === mode) return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public lineNumberButtonClass() {
        const base = 'flex size-9 items-center justify-center rounded-md transition-colors';
        if (this.showLineNumbers) return `${base} bg-stone-100 text-stone-950 dark:bg-zinc-800 dark:text-zinc-50`;
        return `${base} text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public codePreviewOptions(block: PreviewBlock) {
        const dark = document.documentElement.classList.contains('dark');
        return {
            language: block.language || 'plaintext',
            theme: dark ? 'vs-dark' : 'vs',
            readOnly: true,
            domReadOnly: true,
            automaticLayout: true,
            fontFamily: 'SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
            fontSize: 13,
            lineHeight: 20,
            minimap: { enabled: false },
            tabSize: this.editorTabSize(),
            insertSpaces: true,
            detectIndentation: false,
            lineNumbers: this.showLineNumbers
                ? ((lineNumber: number) => String(block.lineIndex + lineNumber + 1))
                : 'off',
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 2,
            glyphMargin: false,
            folding: false,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            padding: { top: 4, bottom: 4 },
            scrollbar: {
                vertical: 'hidden',
                horizontal: 'auto',
                verticalScrollbarSize: 0,
                horizontalScrollbarSize: 8
            }
        };
    }

    public codePreviewHeight(code?: string) {
        const lines = Math.max((code || '').split('\n').length, 1);
        return `${Math.min(Math.max(lines * 20 + 18, 42), 320)}px`;
    }

    public previewBlockClass(block: PreviewBlock) {
        const active = this.previewHoveredLine != null
            && this.previewHoveredLine >= block.lineIndex
            && this.previewHoveredLine <= (block.lineEnd ?? block.lineIndex);
        const classes = [
            'notedown-preview-row',
            this.previewCellClass(block),
            block.type === 'code' ? 'notedown-preview-code' : '',
            block.variant ? `is-${block.variant}` : '',
            block.variant === 'quote' && !block.joinsPrevious ? 'is-quote-start' : '',
            block.variant === 'quote' && !block.joinsNext ? 'is-quote-end' : '',
            block.sectionStyle ? 'has-section-style' : '',
            block.sectionClassName || '',
            block.sectionHasTextStyle ? 'has-text-style' : '',
            active ? 'is-synced-hover' : ''
        ].filter(Boolean);

        return classes.join(' ');
    }

    private previewCellClass(block: PreviewBlock) {
        if (block.type === 'blank') return 'cell-blank';
        if (block.type === 'code') return 'cell-code';
        if (block.variant) return `cell-${block.variant}`;
        return 'cell-text';
    }

    public previewLineNumberClass(block: PreviewBlock) {
        const base = 'notedown-preview-line-number';
        return block.lineNumbers && block.lineNumbers.length > 1 ? `${base} is-multi-line` : base;
    }

    public previewLineNumbers(block: PreviewBlock) {
        return block.lineNumbers && block.lineNumbers.length > 0 ? block.lineNumbers : [block.lineIndex];
    }

    private selectNoteById(id?: string | null) {
        const note = this.notes.find(item => item.id === id) || this.notes[0];
        if (!note) {
            this.activeNote = this.emptyNote();
            this.editingTitle = false;
            this.titleDraft = '';
            this.savedAt = '';
            localStorage.removeItem(this.activeNoteKey);
            this.clearSyncedLineHover();
            this.disposeEditorHoverHandlers();
            this.editor = null;
            this.autoFoldedStyleNoteId = '';
            this.refreshPreview();
            return;
        }
        this.activeNote = note;
        this.editingTitle = false;
        this.titleDraft = note.title || '';
        this.autoFoldedStyleNoteId = '';
        localStorage.setItem(this.activeNoteKey, note.id);
        this.refreshPreview();
        this.focusEditorSoon();
        this.scheduleFoldStyleBlocks();
    }

    private async loadNotes(selectStored: boolean) {
        const fileNotes = await this.loadFileNotes();
        if (fileNotes) {
            this.notes = fileNotes;
            if (selectStored) this.selectNoteById(localStorage.getItem(this.activeNoteKey));
            return;
        }

        try {
            const stored = localStorage.getItem(this.storageKey);
            this.notes = stored ? JSON.parse(stored) : this.defaultNotes();
            if (!Array.isArray(this.notes) || this.notes.length === 0) this.notes = [];
            this.notes = this.notes.map((note, index) => this.normalizeNote(note, index));
            if (!stored) this.persist(true);
        } catch (error) {
            this.notes = this.defaultNotes();
            this.persist(true);
        }

        if (selectStored) this.selectNoteById(localStorage.getItem(this.activeNoteKey));
    }

    private persist(emitChange: boolean) {
        localStorage.setItem(this.storageKey, JSON.stringify(this.notes));
        if (this.hasSelectedNote) {
            localStorage.setItem(this.activeNoteKey, this.activeNote.id);
        } else {
            localStorage.removeItem(this.activeNoteKey);
        }
        this.savedAt = this.nowLabel();
        const fileSave = this.persistFileNotes();
        if (emitChange) {
            if (fileSave) {
                fileSave.finally(() => this.emitNotesChanged());
            } else {
                this.emitNotesChanged();
            }
        }
    }

    private emitNotesChanged() {
        window.dispatchEvent(new CustomEvent('notedown:notes-changed', {
            detail: { source: 'page.notes' }
        }));
    }

    private async loadFileNotes() {
        const api = (window as any).notedown?.storage;
        const storagePath = this.storagePath();
        if (!api?.loadNotes || !storagePath) return null;

        try {
            const result = await api.loadNotes({ storagePath });
            if (!result?.ok || !Array.isArray(result.notes)) return null;
            if (result.notes.length === 0 && localStorage.getItem(this.storageKey)) return null;
            const notes = result.notes.map((note: any, index: number) => this.normalizeNote(note, index));
            localStorage.setItem(this.storageKey, JSON.stringify(notes));
            return notes;
        } catch (error) {
            return null;
        }
    }

    private persistFileNotes() {
        const api = (window as any).notedown?.storage;
        const storagePath = this.storagePath();
        if (!api?.saveNotes || !storagePath) return null;

        return api.saveNotes({ storagePath, notes: this.notes }).catch(() => null);
    }

    private storagePath() {
        try {
            const settings = JSON.parse(localStorage.getItem(this.settingsKey) || '{}');
            return settings.storagePath || '';
        } catch (error) {
            return '';
        }
    }

    private createEditorOptions() {
        const tabSize = this.editorTabSize();
        return {
            language: 'markdown',
            theme: 'vs',
            automaticLayout: true,
            fontFamily: 'SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
            fontSize: 15,
            lineHeight: 24,
            tabSize,
            insertSpaces: true,
            detectIndentation: false,
            tabCompletion: 'on',
            lineNumbers: this.showLineNumbers ? 'on' : 'off',
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 2,
            minimap: { enabled: false },
            wordWrap: 'on',
            wrappingIndent: 'same',
            scrollBeyondLastLine: false,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            folding: true,
            glyphMargin: false,
            quickSuggestions: { other: true, comments: false, strings: true },
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'on',
            snippetSuggestions: 'top',
            padding: { top: 4, bottom: 4 },
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8
            }
        };
    }

    private refreshEditorOptions() {
        this.editorOptions = this.createEditorOptions();
        if (this.editor) this.editor.updateOptions(this.editorOptions);
    }

    private editorTabSize() {
        const parsed = Number(this.readSettings().tabSize);
        if (!Number.isFinite(parsed)) return 2;
        return Math.min(8, Math.max(2, Math.round(parsed)));
    }

    private settingsViewMode(): ViewMode {
        const mode = this.readSettings().editorMode;
        if (mode === 'markdown') return 'write';
        if (mode === 'preview') return 'preview';
        return 'split';
    }

    private readSettings() {
        try {
            return JSON.parse(localStorage.getItem(this.settingsKey) || '{}') || {};
        } catch (error) {
            return {};
        }
    }

    private configureMarkdownEditor() {
        const monaco = (window as any).monaco;
        if (!monaco || !this.editor) return;

        this.editor.updateOptions(this.createEditorOptions());
        this.configureEditorLineHover(monaco);
        this.configureMarkdownFolding(monaco);
        this.scheduleFoldStyleBlocks();
        this.editor.addAction({
            id: 'notedown-open-slash-blocks',
            label: 'Open block menu',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
            run: (editor: any) => {
                const position = editor.getPosition();
                editor.trigger('keyboard', 'type', { text: '/' });
                if (position?.column === 1) editor.trigger('keyboard', 'editor.action.triggerSuggest', {});
            }
        });

        if (this.completionDisposable) return;

        this.completionDisposable = monaco.languages.registerCompletionItemProvider('markdown', {
            triggerCharacters: ['/'],
            provideCompletionItems: (model: any, position: any) => {
                const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
                const slashMatch = /^\/([\w가-힣-]*)$/.exec(linePrefix);
                if (!slashMatch) return { suggestions: [] };

                const typed = (slashMatch[1] || '').toLowerCase();
                const useEnglishFilter = /^[a-z0-9-]*$/.test(typed);
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: 1,
                    endColumn: position.column
                };

                const blocks = [
                    { ko: '제목 1', en: 'Heading 1', aliases: 'h1 title large', insertText: '# ${1:제목}', detail: 'Top-level heading' },
                    { ko: '제목 2', en: 'Heading 2', aliases: 'h2 subtitle medium', insertText: '## ${1:제목}', detail: 'Section heading' },
                    { ko: '제목 3', en: 'Heading 3', aliases: 'h3 small heading', insertText: '### ${1:제목}', detail: 'Small heading' },
                    { ko: '할 일', en: 'Todo', aliases: 'task checkbox check list', insertText: '- [ ] ${1:할 일}', detail: 'Checkbox task' },
                    { ko: '글머리 기호', en: 'Bulleted list', aliases: 'bullet unordered list ul', insertText: '- ${1:항목}', detail: 'Unordered list' },
                    { ko: '번호 목록', en: 'Numbered list', aliases: 'number ordered list ol', insertText: '1. ${1:항목}', detail: 'Ordered list' },
                    { ko: '인용', en: 'Quote', aliases: 'blockquote cite', insertText: '> ${1:인용}', detail: 'Quote block' },
                    { ko: '코드', en: 'Code', aliases: 'code block snippet', insertText: '```$1\n${2:code}\n```', detail: 'Code block' },
                    { ko: '표', en: 'Table', aliases: 'grid spreadsheet', insertText: '| ${1:Name} | ${2:Value} |\n| --- | --- |\n| ${3:Item} | ${4:Memo} |', detail: 'Markdown table' },
                    { ko: '글로벌 스타일', en: 'Global style', aliases: 'document theme global style', insertText: ':::global\n${1:color: #1c1917;\nbackground: #eff6ff;}\n:::', detail: 'Document style declarations' },
                    { ko: '구역 스타일', en: 'Section style', aliases: 'section divider block style', insertText: ':::\n${1:color: blue;\nborder-left: 2px solid #2563eb;}\n:::', detail: 'Style for the current divider section' },
                    { ko: '구분선', en: 'Divider', aliases: 'separator horizontal rule hr line', insertText: '---', detail: 'Horizontal rule' }
                ];

                return {
                    suggestions: blocks.map((block, index) => ({
                        label: `/${block.en}`,
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        detail: block.detail,
                        filterText: useEnglishFilter
                            ? `/${block.en.toLowerCase()} ${block.aliases} ${block.ko}`
                            : `/${block.ko} ${block.en.toLowerCase()} ${block.aliases}`,
                        sortText: String(index).padStart(2, '0'),
                        insertText: block.insertText,
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range
                    }))
                };
            }
        });
    }

    private configureMarkdownFolding(monaco: any) {
        if (this.foldingDisposable) return;

        this.foldingDisposable = monaco.languages.registerFoldingRangeProvider('markdown', {
            provideFoldingRanges: (model: any) => this.markdownFoldingRanges(model, monaco)
        });
    }

    private markdownFoldingRanges(model: any, monaco: any) {
        const ranges: any[] = [];
        const lineCount = model.getLineCount();

        for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
            const line = model.getLineContent(lineNumber);
            const trimmed = line.trim();

            if (/^```/.test(trimmed)) {
                const endLine = this.findFoldingEndLine(model, lineNumber + 1, /^```\s*$/);
                if (endLine) {
                    this.addFoldingRange(ranges, lineNumber, endLine, monaco);
                    lineNumber = endLine;
                }
                continue;
            }

            if (this.styleBlockType(line)) {
                const endLine = this.findFoldingEndLine(model, lineNumber + 1, /^:::\s*$/);
                if (endLine) {
                    this.addFoldingRange(ranges, lineNumber, endLine, monaco);
                    lineNumber = endLine;
                }
            }
        }

        return ranges;
    }

    private findFoldingEndLine(model: any, fromLineNumber: number, endPattern: RegExp) {
        for (let lineNumber = fromLineNumber; lineNumber <= model.getLineCount(); lineNumber++) {
            if (endPattern.test(model.getLineContent(lineNumber).trim())) return lineNumber;
        }

        return null;
    }

    private addFoldingRange(ranges: any[], start: number, end: number, monaco: any) {
        if (end <= start) return;
        const range: any = { start, end };
        const regionKind = monaco.languages.FoldingRangeKind?.Region;
        if (regionKind) range.kind = regionKind;
        ranges.push(range);
    }

    private scheduleFoldStyleBlocks() {
        if (!this.activeNote?.id) return;
        this.clearScheduledStyleFold();
        const noteId = this.activeNote.id;
        this.styleFoldTimeout = window.setTimeout(() => {
            this.styleFoldTimeout = null;
            this.foldStyleBlocksOnOpen(noteId);
        }, 150);
    }

    private clearScheduledStyleFold() {
        if (this.styleFoldTimeout == null) return;
        window.clearTimeout(this.styleFoldTimeout);
        this.styleFoldTimeout = null;
    }

    private foldStyleBlocksOnOpen(noteId: string) {
        if (!this.editor || this.activeNote?.id !== noteId || this.autoFoldedStyleNoteId === noteId) return;

        const model = this.editor.getModel?.();
        const action = this.editor.getAction?.('editor.fold');
        if (!model || !action) return;

        const styleStartLines = this.styleFoldingStartLines(model);
        this.autoFoldedStyleNoteId = noteId;
        if (styleStartLines.length === 0) return;

        const foldResult = action.run({
            selectionLines: styleStartLines.map(lineNumber => lineNumber - 1)
        });
        if (foldResult?.catch) foldResult.catch(() => null);
    }

    private styleFoldingStartLines(model: any) {
        const lineNumbers: number[] = [];
        let inCodeFence = false;

        for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
            const line = model.getLineContent(lineNumber);
            const trimmed = line.trim();

            if (/^```/.test(trimmed)) {
                inCodeFence = !inCodeFence;
                continue;
            }

            if (!inCodeFence && this.styleBlockType(line)) {
                const endLine = this.findFoldingEndLine(model, lineNumber + 1, /^:::\s*$/);
                if (endLine) {
                    lineNumbers.push(lineNumber);
                    lineNumber = endLine;
                }
            }
        }

        return lineNumbers;
    }

    private configureEditorLineHover(monaco: any) {
        this.disposeEditorHoverHandlers();

        this.editorMouseMoveDisposable = this.editor.onMouseMove((event: any) => {
            const lineNumber = event?.target?.position?.lineNumber;
            if (!lineNumber) {
                this.clearSyncedLineHover();
                return;
            }

            this.previewHoveredLine = lineNumber - 1;
            this.setEditorLineHover(lineNumber, monaco);
        });

        this.editorMouseLeaveDisposable = this.editor.onMouseLeave(() => this.clearSyncedLineHover());
    }

    private setSyncedLineHover(lineIndex: number, syncEditor: boolean) {
        this.previewHoveredLine = lineIndex;
        if (!syncEditor || !this.editor) return;

        const monaco = (window as any).monaco;
        if (monaco) this.setEditorLineHover(lineIndex + 1, monaco);
    }

    private setEditorLineHover(lineNumber: number, monaco: any) {
        if (!this.editor || !monaco) return;

            this.hoveredLineDecorationIds = this.editor.deltaDecorations(this.hoveredLineDecorationIds, [{
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: 'notedown-editor-line-hover',
                    linesDecorationsClassName: 'notedown-editor-line-hover-gutter',
                    marginClassName: 'notedown-editor-line-hover-margin'
                }
            }]);
    }

    private clearEditorLineHover() {
        if (!this.editor || this.hoveredLineDecorationIds.length === 0) return;
        this.hoveredLineDecorationIds = this.editor.deltaDecorations(this.hoveredLineDecorationIds, []);
    }

    private disposeEditorHoverHandlers() {
        this.clearEditorLineHover();
        if (this.editorMouseMoveDisposable) this.editorMouseMoveDisposable.dispose();
        if (this.editorMouseLeaveDisposable) this.editorMouseLeaveDisposable.dispose();
        this.editorMouseMoveDisposable = null;
        this.editorMouseLeaveDisposable = null;
    }

    private refreshPreview() {
        if (!this.hasSelectedNote) {
            this.documentGlobalStyle = '';
            this.documentGlobalHasTextStyle = false;
            this.documentStyleCss = '';
            this.previewBlocks = [];
            return;
        }

        const parsed = this.parseDocumentStyles(this.activeNote.body);
        this.documentGlobalStyle = parsed.globalStyle;
        this.documentGlobalHasTextStyle = parsed.globalHasTextStyle;
        this.documentStyleCss = parsed.stylesheet;
        this.previewBlocks = this.buildPreviewBlocks(parsed.lines);
    }

    private buildPdfDocumentHtml() {
        const title = (this.activeNote?.title || '제목 없음').trim() || '제목 없음';
        const createdAt = this.createdAtLabel();
        const updatedAt = this.lastSavedLabel();
        const parsed = this.parseDocumentStyles(this.activeNote?.body || '');
        const bodyHtml = this.sanitizeExportHtml(this.buildExportBodyHtml(parsed.lines));
        const documentStyleAttribute = parsed.globalStyle ? ` style="${this.escapeHtml(parsed.globalStyle)}"` : '';
        const contentClass = parsed.globalHasTextStyle ? 'content has-text-style' : 'content';
        const documentCss = parsed.stylesheet ? `\n${parsed.stylesheet}` : '';

        return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${this.escapeHtml(title)}</title>
<style>
@page { margin: 18mm 16mm; }
* { box-sizing: border-box; }
body {
    margin: 0;
    color: #1c1917;
    background: #ffffff;
    font-family: SUIT, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.65;
}
main { max-width: 780px; margin: 0 auto; }
header {
    margin-bottom: 28px;
    padding-bottom: 16px;
    border-bottom: 1px solid #e7e5e4;
}
h1 { margin: 0; font-size: 28px; line-height: 1.25; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; color: #78716c; font-size: 12px; }
.content { font-size: 15px; line-height: 1.55; }
.content :where(h1, h2, h3) { margin: 1.2em 0 0.45em; line-height: 1.3; }
.content h1 { font-size: 24px; }
.content h2 { font-size: 20px; }
.content h3 { font-size: 17px; }
.content p { margin: 0.45em 0; }
.content .notedown-blank-line { display: block; height: 1.55em; min-height: 1.55em; margin: 0; }
.content a { color: #2563eb; text-decoration: underline; }
.content ul, .content ol { margin: 0.45em 0 0.45em 1.25em; padding: 0; }
.content .notedown-task-list { margin-left: 0; padding-left: 0; }
.content .task-list-item { display: flex; align-items: center; gap: 8px; margin: 0.2em 0; list-style: none; }
.content .task-list-item input[type="checkbox"] { flex: 0 0 auto; width: 1rem; height: 1rem; margin: 0 !important; accent-color: #2563eb; }
.content blockquote { margin: 0.65em 0; padding: 0.1em 0 0.1em 0.9em; border-left: 3px solid #d6d3d1; color: #57534e; font-style: normal; }
.content blockquote p { margin: 0.15em 0; }
.content pre {
    margin: 0.9em 0;
    padding: 12px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    border-radius: 0;
    background: #f5f5f4;
}
.content code {
    font-family: SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace;
    font-size: 0.92em;
}
.content table { width: 100%; border-collapse: collapse; margin: 0.9em 0; font-size: 0.95em; line-height: 1.45; }
.content th, .content td { border: 1px solid #e7e5e4; padding: 6px 8px; text-align: left; vertical-align: top; }
.content th { background: #f5f5f4; font-weight: 600; }
.content .notedown-doc-section { display: block; margin: 0.9em 0; }
.content .notedown-doc-section > :first-child { margin-top: 0; }
.content .notedown-doc-section > :last-child { margin-bottom: 0; }
.content.has-text-style :where(p, h1, h2, h3, h4, h5, h6, blockquote, li, th, td, a, strong, em, code, span, del),
.content .notedown-doc-section.has-text-style :where(p, h1, h2, h3, h4, h5, h6, blockquote, li, th, td, a, strong, em, code, span, del) { color: inherit !important; }
${documentCss}
</style>
</head>
<body>
<main>
    <header>
        <h1>${this.escapeHtml(title)}</h1>
        <div class="meta"><span>생성: ${this.escapeHtml(createdAt)}</span><span>마지막 저장: ${this.escapeHtml(updatedAt)}</span></div>
    </header>
    <section class="${contentClass}"${documentStyleAttribute}>${bodyHtml}</section>
</main>
</body>
</html>`;
    }

    private buildExportBodyHtml(lines: StyledMarkdownLine[]) {
        const chunks: string[] = [];
        let index = 0;

        while (index < lines.length) {
            if (this.isDividerLine(lines[index].text)) {
                chunks.push(this.addLinkTargets(this.converter.makeHtml(lines[index].text)));
                index++;
                continue;
            }

            const section = lines[index].section;
            const sectionId = section?.id;
            const chunkLines: StyledMarkdownLine[] = [];

            while (index < lines.length && !this.isDividerLine(lines[index].text) && lines[index].section?.id === sectionId) {
                chunkLines.push(lines[index]);
                index++;
            }

            const html = this.buildExportSectionHtml(chunkLines);
            if (!section) {
                chunks.push(html);
                continue;
            }

            const sectionClass = [
                'notedown-doc-section',
                section.className,
                section.hasTextStyle ? 'has-text-style' : ''
            ].filter(Boolean).join(' ');
            const styleAttribute = section.style ? ` style="${this.escapeHtml(section.style)}"` : '';
            chunks.push(`<section class="${sectionClass}"${styleAttribute}>${html}</section>`);
        }

        return chunks.join('\n');
    }

    private buildExportSectionHtml(lines: StyledMarkdownLine[]) {
        const chunks: string[] = [];
        const markdownLines: string[] = [];
        let inCodeFence = false;

        const flushMarkdown = () => {
            if (markdownLines.length === 0) return;
            chunks.push(this.addLinkTargets(this.converter.makeHtml(markdownLines.join('\n'))));
            markdownLines.length = 0;
        };

        lines.forEach(line => {
            const isCodeFence = /^```/.test(line.text.trim());
            if (!inCodeFence && line.text.trim() === '') {
                flushMarkdown();
                chunks.push(this.buildExportBlankLineHtml());
                return;
            }

            markdownLines.push(line.text);
            if (isCodeFence) inCodeFence = !inCodeFence;
        });

        flushMarkdown();
        return chunks.join('\n');
    }

    private buildExportBlankLineHtml() {
        return '<div class="notedown-blank-line cell-blank" aria-hidden="true"></div>';
    }

    private sanitizeExportHtml(html: string) {
        const documentForExport = document.implementation.createHTMLDocument('notedown-export');
        documentForExport.body.innerHTML = html;

        documentForExport.body.querySelectorAll('script, iframe, object, embed').forEach(element => element.remove());
        documentForExport.body.querySelectorAll('*').forEach(element => {
            for (const attribute of Array.from(element.attributes)) {
                const name = attribute.name.toLowerCase();
                const value = attribute.value.trim().toLowerCase();
                if (name === 'style') {
                    if (element.classList.contains('notedown-doc-section')) {
                        const style = this.sanitizeStyleDeclaration(attribute.value);
                        if (style) {
                            element.setAttribute(attribute.name, style);
                        } else {
                            element.removeAttribute(attribute.name);
                        }
                        continue;
                    }
                    element.removeAttribute(attribute.name);
                    continue;
                }

                if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
                    element.removeAttribute(attribute.name);
                }
            }
        });

        documentForExport.body.querySelectorAll('li.task-list-item').forEach(item => {
            const parent = item.parentElement;
            if (parent && (parent.tagName === 'UL' || parent.tagName === 'OL')) {
                parent.classList.add('notedown-task-list');
            }
        });

        documentForExport.body.querySelectorAll('table').forEach(element => element.classList.add('cell-table'));
        documentForExport.body.querySelectorAll('blockquote').forEach(element => element.classList.add('cell-quote'));
        documentForExport.body.querySelectorAll('pre').forEach(element => element.classList.add('cell-code'));
        documentForExport.body.querySelectorAll('hr').forEach(element => element.classList.add('cell-divider'));
        documentForExport.body.querySelectorAll('li.task-list-item, .notedown-task-list').forEach(element => element.classList.add('cell-task'));
        documentForExport.body.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(element => element.classList.add('cell-heading'));
        documentForExport.body.querySelectorAll('ul, ol').forEach(element => element.classList.add('cell-list'));
        documentForExport.body.querySelectorAll('p').forEach(element => element.classList.add('cell-text'));

        return documentForExport.body.innerHTML;
    }

    private openPdfPrintWindow(html: string) {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            window.alert('PDF 저장 창을 열 수 없습니다.');
            return;
        }

        printWindow.opener = null;
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.setTimeout(() => {
            printWindow.focus();
            printWindow.print();
        }, 250);
    }

    private buildPreviewBlocks(lines: StyledMarkdownLine[]): PreviewBlock[] {
        const blocks: PreviewBlock[] = [];

        for (let index = 0; index < lines.length; index++) {
            const sourceLine = lines[index];
            const fence = /^```(\S*)\s*$/.exec(sourceLine.text);
            if (!fence) {
                if (sourceLine.text.trim() === '') {
                    blocks.push(this.withSectionStyle({ type: 'blank', lineIndex: sourceLine.lineIndex }, sourceLine.section));
                    continue;
                }

                if (this.isDividerLine(sourceLine.text)) {
                    const html = this.addLinkTargets(this.converter.makeHtml(sourceLine.text));
                    blocks.push(this.withSectionStyle({
                        type: 'markdown',
                        lineIndex: sourceLine.lineIndex,
                        variant: 'divider',
                        html: this.sanitizer.bypassSecurityTrustHtml(html)
                    }, sourceLine.section));
                    continue;
                }

                if (this.isMarkdownTableStart(lines, index)) {
                    const tableStartLine = index;
                    const tableLines: StyledMarkdownLine[] = [];
                    while (index < lines.length && this.isMarkdownTableRow(lines[index].text)) {
                        tableLines.push(lines[index]);
                        index++;
                    }
                    index--;

                    const html = this.addLinkTargets(this.converter.makeHtml(tableLines.map(line => line.text).join('\n')));
                    const lineEnd = tableLines[tableLines.length - 1].lineIndex;
                    blocks.push(this.withSectionStyle({
                        type: 'markdown',
                        lineIndex: lines[tableStartLine].lineIndex,
                        lineEnd,
                        lineNumbers: tableLines.map(line => line.lineIndex),
                        variant: 'table',
                        html: this.sanitizer.bypassSecurityTrustHtml(html)
                    }, sourceLine.section));
                    continue;
                }

                const prepared = this.preparePreviewMarkdownLine(sourceLine.text, sourceLine.lineIndex);
                const html = this.addLinkTargets(this.converter.makeHtml(prepared));
                const isQuote = this.isQuoteLine(sourceLine.text);
                const variant = isQuote ? 'quote' : this.markdownCellVariant(sourceLine.text);
                blocks.push(this.withSectionStyle({
                    type: 'markdown',
                    lineIndex: sourceLine.lineIndex,
                    variant,
                    joinsPrevious: isQuote && index > 0 && this.isQuoteLine(lines[index - 1].text),
                    joinsNext: isQuote && index < lines.length - 1 && this.isQuoteLine(lines[index + 1].text),
                    html: this.sanitizer.bypassSecurityTrustHtml(html)
                }, sourceLine.section));
                continue;
            }

            const codeStartLine = sourceLine.lineIndex;
            const language = this.normalizeLanguage(fence[1]);
            const codeLines: string[] = [];
            index++;
            while (index < lines.length && !/^```\s*$/.test(lines[index].text)) {
                codeLines.push(lines[index].text);
                index++;
            }
            blocks.push(this.withSectionStyle({
                type: 'code',
                lineIndex: codeStartLine,
                lineEnd: lines[index]?.lineIndex ?? codeStartLine,
                language,
                code: codeLines.join('\n')
            }, sourceLine.section));
        }

        return blocks;
    }

    private withSectionStyle(block: PreviewBlock, section?: DocumentSectionStyle): PreviewBlock {
        if (!section) return block;
        return {
            ...block,
            sectionStyle: section.style,
            sectionClassName: section.className,
            sectionHasTextStyle: section.hasTextStyle
        };
    }

    private isQuoteLine(line: string) {
        return /^\s{0,3}>\s?/.test(line);
    }

    private markdownCellVariant(line: string): PreviewBlock['variant'] {
        if (/^\s*[-*]\s+\[[ xX]\]\s+/.test(line)) return 'task';
        if (/^\s{0,3}#{1,6}\s+/.test(line)) return 'heading';
        if (/^\s{0,3}(([-*+])|\d+\.)\s+/.test(line)) return 'list';
        return 'text';
    }

    private isMarkdownTableStart(lines: StyledMarkdownLine[], index: number) {
        return this.isMarkdownTableRow(lines[index].text)
            && index + 1 < lines.length
            && this.isMarkdownTableDelimiter(lines[index + 1].text);
    }

    private isMarkdownTableRow(line: string) {
        const cells = this.markdownTableCells(line);
        return line.trim() !== '' && line.includes('|') && cells.length >= 2;
    }

    private isMarkdownTableDelimiter(line: string) {
        const cells = this.markdownTableCells(line);
        return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
    }

    private markdownTableCells(line: string) {
        const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
        return trimmed.split('|').map(cell => cell.trim());
    }

    private preparePreviewMarkdownLine(line: string, lineIndex: number) {
        const task = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
        if (!task) return line;

        const checked = task[2].toLowerCase() === 'x';
        const label = this.escapeHtml(task[3]);
        const checkedAttribute = checked ? ' checked' : '';
        const checkedClass = checked ? ' is-checked' : '';
        return `<div class="notedown-task${checkedClass}" data-task-line="${lineIndex}"><input type="checkbox" aria-label="${label}" data-task-line="${lineIndex}"${checkedAttribute}> <span>${label}</span></div>`;
    }

    private toggleTaskLine(lineIndex: number, checked: boolean) {
        if (!this.activeNote?.id) return;
        const lines = this.activeNote.body.split('\n');
        if (!lines[lineIndex]) return;

        lines[lineIndex] = lines[lineIndex].replace(/^(\s*[-*]\s+\[)[ xX](\]\s+)/, `$1${checked ? 'x' : ' '}$2`);
        this.activeNote.body = lines.join('\n');
        this.touchNote();
    }

    private isTaskLineChecked(lineIndex: number) {
        const line = this.activeNote?.body.split('\n')[lineIndex] || '';
        const task = /^\s*[-*]\s+\[([ xX])\]\s+/.exec(line);
        return task ? task[1].toLowerCase() === 'x' : false;
    }

    private addLinkTargets(html: string) {
        return html.replace(/<a\s+([^>]*href=["'][^"']+["'][^>]*)>/gi, (match, attributes) => {
            if (/target=/i.test(attributes)) return match;
            return `<a ${attributes} target="_blank" rel="noopener noreferrer">`;
        });
    }

    private parseDocumentStyles(markdown: string): ParsedDocumentStyles {
        const sourceLines = markdown.split('\n');
        const lines: Array<StyledMarkdownLine & { sectionId: number }> = [];
        const sectionStyles = new Map<number, ParsedStyleBlock[]>();
        const globalStyles: ParsedStyleBlock[] = [];
        let currentSectionId = 1;
        let inCodeFence = false;

        const pushContentLine = (text: string, lineIndex: number) => {
            if (this.isDividerLine(text)) {
                lines.push({ text, lineIndex, sectionId: 0 });
                currentSectionId++;
                return;
            }

            lines.push({ text, lineIndex, sectionId: currentSectionId });
        };

        for (let index = 0; index < sourceLines.length; index++) {
            const line = sourceLines[index];
            const trimmed = line.trim();

            if (/^```/.test(trimmed)) {
                pushContentLine(line, index);
                inCodeFence = !inCodeFence;
                continue;
            }

            const styleBlockType = inCodeFence ? null : this.styleBlockType(line);
            if (styleBlockType) {
                const styleLines: string[] = [];
                index++;
                while (index < sourceLines.length && !/^:::\s*$/.test(sourceLines[index].trim())) {
                    styleLines.push(sourceLines[index]);
                    index++;
                }

                const styleBlock = this.parseStyleBlock(styleLines.join('\n'));
                if (styleBlock.style || styleBlock.rules.length > 0) {
                    if (styleBlockType === 'global') {
                        globalStyles.push(styleBlock);
                    } else {
                        sectionStyles.set(currentSectionId, [
                            ...(sectionStyles.get(currentSectionId) || []),
                            styleBlock
                        ]);
                    }
                }
                continue;
            }

            pushContentLine(line, index);
        }

        const globalStyle = this.joinStyleDeclarations(globalStyles.map(style => style.style));
        const stylesheet = [
            this.buildScopedStyleRules(
                globalStyles.flatMap(style => style.rules),
                ['.notedown-preview-document', '.content']
            ),
            ...Array.from(sectionStyles.entries()).map(([sectionId, styles]) => this.buildScopedStyleRules(
                styles.flatMap(style => style.rules),
                [`.notedown-preview-row.${this.sectionStyleClass(sectionId)}`, `.content .${this.sectionStyleClass(sectionId)}`]
            ))
        ].filter(Boolean).join('\n');

        return {
            lines: lines.map(line => {
                const styleBlocks = sectionStyles.get(line.sectionId) || [];
                const style = this.joinStyleDeclarations(styleBlocks.map(styleBlock => styleBlock.style));
                const { sectionId, ...contentLine } = line;
                if (sectionId === 0 || styleBlocks.length === 0) return contentLine;
                return {
                    ...contentLine,
                    section: {
                        id: sectionId,
                        style,
                        className: this.sectionStyleClass(sectionId),
                        hasTextStyle: this.hasTextColorDeclaration(style)
                    }
                };
            }),
            globalStyle,
            globalHasTextStyle: this.hasTextColorDeclaration(globalStyle),
            stylesheet
        };
    }

    private styleBlockType(line: string): 'global' | 'section' | null {
        const trimmed = line.trim();
        if (/^:::\s*global\s*$/i.test(trimmed) || /^:::global\s*$/i.test(trimmed)) return 'global';
        if (/^:::\s*$/.test(trimmed)) return 'section';
        return null;
    }

    private parseStyleBlock(style: string): ParsedStyleBlock {
        const cleaned = this.sanitizeStyleSource(style);
        const rootParts: string[] = [];
        const rules: StyleRule[] = [];
        let cursor = 0;

        while (cursor < cleaned.length) {
            const openIndex = cleaned.indexOf('{', cursor);
            if (openIndex < 0) break;

            const closeIndex = cleaned.indexOf('}', openIndex + 1);
            if (closeIndex < 0) break;

            const selectorStart = Math.max(
                cursor,
                cleaned.lastIndexOf(';', openIndex) + 1,
                cleaned.lastIndexOf('}', openIndex) + 1
            );
            rootParts.push(cleaned.slice(cursor, selectorStart));

            const selector = this.sanitizeStyleSelectorList(cleaned.slice(selectorStart, openIndex));
            const ruleStyle = this.normalizeStyleDeclarationList(cleaned.slice(openIndex + 1, closeIndex));
            if (selector && ruleStyle) rules.push({ selector, style: ruleStyle });

            cursor = closeIndex + 1;
        }

        rootParts.push(cleaned.slice(cursor));
        const rootStyle = this.normalizeStyleDeclarationList(rootParts.join('\n'));

        return {
            style: rootStyle,
            rules,
            hasTextStyle: this.hasTextColorDeclaration(rootStyle)
        };
    }

    private sanitizeStyleSource(style: string) {
        return (style || '')
            .replace(/<\/?style[^>]*>/gi, '')
            .replace(/<\/?script[^>]*>/gi, '')
            .replace(/@import\s+[^;]+;/gi, '')
            .replace(/expression\s*\(/gi, '')
            .replace(/url\s*\(\s*(['"]?)\s*javascript:[^)]+\)/gi, '')
            .trim();
    }

    private sanitizeStyleSelectorList(selectorText: string) {
        return selectorText
            .split(',')
            .map(selector => selector.trim().replace(/\s+/g, ' '))
            .filter(selector => selector && !selector.startsWith('@') && !/[{};]/.test(selector))
            .filter(selector => /^[&.#:[\]\w\s="'|^$*~>+(),-]+$/.test(selector))
            .join(', ');
    }

    private buildScopedStyleRules(rules: StyleRule[], scopes: string[]) {
        return rules.map(rule => {
            const selectors = rule.selector
                .split(',')
                .map(selector => selector.trim())
                .filter(Boolean)
                .flatMap(selector => scopes.map(scope => this.scopeStyleSelector(selector, scope)))
                .join(', ');

            if (!selectors) return '';

            const colorInheritance = this.hasTextColorDeclaration(rule.style)
                ? `\n${selectors} :where(p, h1, h2, h3, h4, h5, h6, blockquote, li, th, td, a, strong, em, code, span, del, .notedown-task) { color: inherit !important; }`
                : '';
            return `${selectors} { ${rule.style} }${colorInheritance}`;
        }).filter(Boolean).join('\n');
    }

    private scopeStyleSelector(selector: string, scope: string) {
        if (selector.includes('&')) return selector.replace(/&/g, scope);
        return `${scope} ${selector}`;
    }

    private sectionStyleClass(sectionId: number) {
        return `notedown-style-section-${sectionId}`;
    }

    private isDividerLine(line: string) {
        return /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
    }

    private sanitizeStyleDeclaration(style: string) {
        return this.normalizeStyleDeclarationList(this.sanitizeStyleSource(style));
    }

    private normalizeStyleDeclarationList(style: string) {
        return style
            .split(';')
            .map(declaration => {
                const trimmed = declaration.trim();
                if (!trimmed) return '';
                const declarationWithColon = trimmed.includes(':')
                    ? trimmed
                    : (() => {
                        const shorthand = /^(-{0,2}[a-zA-Z_][\w-]*)\s+(.+)$/.exec(trimmed);
                        return shorthand ? `${shorthand[1]}: ${shorthand[2]}` : '';
                    })();
                if (!declarationWithColon) return '';
                return /!important\s*$/i.test(declarationWithColon)
                    ? declarationWithColon
                    : `${declarationWithColon} !important`;
            })
            .filter(declaration => /^-{0,2}[a-zA-Z_][\w-]*\s*:/.test(declaration))
            .map(declaration => `${declaration};`)
            .join(' ');
    }

    private joinStyleDeclarations(styles: string[] = []) {
        return styles.filter(Boolean).join(' ').trim();
    }

    private hasTextColorDeclaration(style: string) {
        return /(^|;)\s*color\s*:/i.test(style || '');
    }

    private normalizeLanguage(language: string) {
        const normalized = (language || 'plaintext').trim().toLowerCase();
        if (!normalized) return 'plaintext';
        if (normalized === 'js') return 'javascript';
        if (normalized === 'ts') return 'typescript';
        if (normalized === 'sh' || normalized === 'shell') return 'bash';
        if (normalized === 'md') return 'markdown';
        return normalized;
    }

    private escapeHtml(value: string) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private focusEditorSoon() {
        if (!this.hasSelectedNote) return;
        window.setTimeout(() => {
            if (this.editor && this.viewMode !== 'preview') this.editor.focus();
        }, 0);
    }

    private defaultNotes(): NoteItem[] {
        const now = Date.now();
        return [
            {
                id: 'today-note',
                icon: 'N',
                title: '오늘의 노트',
                tags: ['daily', 'local'],
                status: 'active',
                folder: 'memo',
                createdAt: this.nowLabel(new Date(now - 600000)),
                createdAtMs: now - 600000,
                updatedAt: this.nowLabel(new Date(now - 120000)),
                updatedAtMs: now - 120000,
                body: '# 오늘의 노트\n\n- [ ] Electron 앱 셸 정리\n- [ ] 로컬 저장소 구조 설계\n- [ ] Markdown 편집 경험 다듬기\n\n## 메모\n\nNotion처럼 가볍게 열고, Markdown으로 빠르게 남기는 흐름을 기준으로 잡는다.'
            },
            {
                id: 'product-scope',
                icon: 'P',
                title: '제품 범위',
                tags: ['planning'],
                status: 'draft',
                folder: 'project',
                createdAt: this.nowLabel(new Date(now - 360000)),
                createdAtMs: now - 360000,
                updatedAt: this.nowLabel(new Date(now - 180000)),
                updatedAtMs: now - 180000,
                body: '# 제품 범위\n\n## 화면\n\n- 노트\n- 설정\n\n## 저장\n\n로컬 우선 저장을 기본값으로 둔다.'
            }
        ];
    }

    private emptyNote(): NoteItem {
        return {
            id: '',
            icon: 'N',
            title: '',
            tags: [],
            status: 'draft',
            folder: 'memo',
            createdAt: '',
            createdAtMs: 0,
            updatedAt: '',
            updatedAtMs: 0,
            body: ''
        };
    }

    private normalizeNote(note: any, index = 0): NoteItem {
        const fallbackTime = Date.now() - (index * 60000);
        const updatedAtMs = Number.isFinite(note?.updatedAtMs) ? Number(note.updatedAtMs) : fallbackTime;
        const createdAtMs = Number.isFinite(note?.createdAtMs) ? Number(note.createdAtMs) : updatedAtMs;

        return {
            id: note?.id || `note-${fallbackTime}`,
            icon: note?.icon || 'N',
            title: note?.title || '제목 없음',
            body: typeof note?.body === 'string' ? note.body : '',
            tags: Array.isArray(note?.tags) ? note.tags : [],
            status: note?.status || 'draft',
            folder: note?.folder || 'memo',
            workspaceName: note?.workspaceName,
            fileName: note?.fileName,
            relativePath: note?.relativePath,
            createdAt: note?.createdAt || this.nowLabel(new Date(createdAtMs)),
            createdAtMs,
            updatedAt: note?.updatedAt || this.nowLabel(new Date(updatedAtMs)),
            updatedAtMs
        };
    }

    private nowLabel(date = new Date()) {
        return new Intl.DateTimeFormat('ko-KR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(date);
    }
}
