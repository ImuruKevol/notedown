import { ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Converter } from 'showdown';
import { NuMonacoEditorEvent } from '@ng-util/monaco-editor';

type ViewMode = 'write' | 'split' | 'preview';
type SyncConflictResolution = 'server' | 'local';
type SyncConflictResolveTone = 'info' | 'success' | 'warning' | 'error';
type AttachmentPickerMode = 'file' | 'image';
type AttachmentMessageTone = 'info' | 'success' | 'warning' | 'error';
type PdfExportMode = 'markdown-images' | 'zip-with-attachments';
type MarkdownToolbarActionId = 'task' | 'bullet' | 'quote' | 'code' | 'link' | 'divider' | 'file' | 'image';
type HeadingLevel = 1 | 2 | 3 | 4;

interface MarkdownToolbarAction {
    id: MarkdownToolbarActionId;
    label: string;
    title: string;
}

interface PreviewBlock {
    type: 'markdown' | 'code' | 'blank';
    lineIndex: number;
    lineEnd?: number;
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
    attachments?: NoteAttachment[];
    titleManuallyEdited?: boolean;
}

interface NoteAttachment {
    id?: string;
    fileName: string;
    relativePath: string;
    noteRelativePath?: string;
    mimeType?: string;
    size?: number;
    contentHash?: string | null;
    updatedAtMs?: number | null;
    deleted?: boolean;
}

interface PdfExportAttachment {
    fileName: string;
    relativePath: string;
    mimeType?: string;
    size?: number;
}

interface AttachmentPickerItem {
    type: 'attachment' | 'upload';
    label: string;
    detail: string;
    attachment?: NoteAttachment;
}

interface EditorCursorPosition {
    lineNumber: number;
    column: number;
    visualLeft?: number;
    visualTop?: number;
    visualHeight?: number;
}

interface SyncConflict {
    relativePath: string;
    reason?: string;
    type?: string;
    clientRevision?: string;
    serverRevision?: string;
    serverFile?: any;
    serverNote?: any;
    clientNote?: any;
    clientWorkspace?: any;
    serverWorkspace?: any;
    clientAttachment?: any;
    serverAttachment?: any;
    serverAttachmentMetadata?: any;
}

interface SyncConflictDetail {
    relativePath?: string;
    serverContent?: string;
    localContent?: string;
    serverFile?: any;
    serverError?: string;
    localError?: string;
    localExists?: boolean;
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
    private activeWorkspaceKey = 'notedown.activeWorkspace.v1';
    private foldersKey = 'notedown.folders.v1';
    private startupSyncResultKey = 'notedown.sync.startup.result.v1';
    private converter = new Converter({
        tables: true,
        tasklists: true,
        strikethrough: true,
        simpleLineBreaks: true,
        disableForced4SpacesIndentedSublists: true
    });
    private editor: any;
    private diffEditor: any;
    private diffOriginalModel: any;
    private diffModifiedModel: any;
    private diffRenderTimeout: number | null = null;
    private completionDisposable: any;
    private foldingDisposable: any;
    private editorMouseMoveDisposable: any;
    private editorMouseLeaveDisposable: any;
    private attachmentCommandId = '';
    private attachmentInputMode: AttachmentPickerMode = 'file';
    private attachmentUploadFromPicker = false;
    private attachmentPickerAnchor: EditorCursorPosition | null = null;
    private attachmentDataUrlCache = new Map<string, string>();
    private attachmentPdfDataUrlCache = new Map<string, string>();
    private attachmentDataUrlLoading = new Set<string>();
    private styleFoldTimeout: number | null = null;
    private syncUploadTimeout: number | null = null;
    private readonly androidSplitMinWidth = 840;
    private autoFoldedStyleNoteId = '';
    private hoveredLineDecorationIds: string[] = [];

    private settingsKey = 'notedown.settings.v1';
    public viewMode: ViewMode = 'split';
    public savedAt = '';
    public notes: NoteItem[] = [];
    public activeNote: NoteItem = this.emptyNote();
    public editorOptions: any = this.createEditorOptions();
    public previewBlocks: PreviewBlock[] = [];
    public previewHoveredLine: number | null = null;
    public documentGlobalStyle = '';
    public documentGlobalHasTextStyle = false;
    public documentStyleCss = '';
    public editingTitle = false;
    public titleDraft = '';
    public hasUnsavedChanges = false;
    public saveBusy = false;
    public syncConflicts: SyncConflict[] = [];
    public selectedSyncConflictIndex = 0;
    public syncConflictDetail: SyncConflictDetail | null = null;
    public syncConflictBusy = false;
    public syncConflictDiffReady = false;
    public syncConflictResolveChoice: SyncConflictResolution = 'server';
    public syncConflictResolveBusy = false;
    public syncConflictResolveMessage = '';
    public syncConflictResolveTone: SyncConflictResolveTone = 'info';
    public hiddenMonacoOptions = this.createHiddenMonacoOptions();
    public monacoEditorsReady = false;
    public attachmentPanelOpen = false;
    public attachmentPickerOpen = false;
    public attachmentPickerMode: AttachmentPickerMode = 'file';
    public attachmentPickerItems: AttachmentPickerItem[] = [];
    public attachmentPickerIndex = 0;
    public attachmentPickerStyle: Record<string, string> = {
        left: '16px',
        top: '16px'
    };
    public attachmentInputAccept = '';
    public attachmentUploadBusy = false;
    public attachmentMessage = '';
    public attachmentMessageTone: AttachmentMessageTone = 'info';
    public pdfExportBusy = false;
    public pdfExportMessage = '';
    public pdfExportOptionsOpen = false;
    public headingMenuOpen = false;
    public readonly headingLevels: HeadingLevel[] = [1, 2, 3];
    public readonly markdownToolbarActions: MarkdownToolbarAction[] = [
        { id: 'task', label: '체크리스트', title: '체크리스트' },
        { id: 'bullet', label: '목록', title: '목록' },
        { id: 'quote', label: '인용', title: '인용' },
        { id: 'code', label: '코드', title: '코드' },
        { id: 'link', label: '링크', title: '링크' },
        { id: 'divider', label: '---', title: '구분선' },
        { id: 'image', label: '이미지', title: '이미지 첨부' },
        { id: 'file', label: '파일', title: '파일 첨부' }
    ];

    public get hasSelectedNote() {
        return Boolean(this.activeNote?.id);
    }

    public noteTitleLabel() {
        return this.activeNote?.title?.trim() || '제목 없음';
    }

    private handleSelectNote = (event: Event) => {
        const id = (event as CustomEvent<string>).detail;
        if (typeof id === 'string') {
            this.selectNoteById(id);
            this.requestViewUpdate();
        }
    };

    private handleNotesChanged = async (event: Event) => {
        const source = (event as CustomEvent<{ source?: string }>).detail?.source;
        if (source === 'page.notes') return;

        const activeId = this.activeNote?.id;
        const unsavedNote = this.hasUnsavedChanges && activeId ? { ...this.activeNote } : null;
        await this.loadNotes(false);
        if (unsavedNote?.id) {
            const index = this.notes.findIndex(note => note.id === unsavedNote.id);
            if (index >= 0) this.notes[index] = unsavedNote;
            else this.notes = [unsavedNote, ...this.notes];
        }
        this.selectNoteById(localStorage.getItem(this.activeNoteKey) || activeId);
        if (unsavedNote?.id && this.activeNote?.id === unsavedNote.id) this.hasUnsavedChanges = true;
        this.requestViewUpdate();
    };
    private handleSettingsChanged = () => {
        this.viewMode = this.settingsViewMode();
        this.refreshEditorOptions();
        if (this.showSyncConflictViewer()) {
            this.renderSyncConflictDiffSoon();
            this.requestViewUpdate();
            return;
        }
        this.refreshPreview();
        this.requestViewUpdate();
        this.focusEditorSoon();
    };
    private handleStartupSyncStatus = (event: Event) => {
        const detail = (event as CustomEvent<any>).detail;
        if (detail?.source === 'page.notes') return;
        this.applyStartupSyncConflict(detail);
        if ((detail?.ok || detail?.status === 'ok') && this.extractSyncConflicts(detail).length === 0) {
            void this.reloadNotesAfterStartupSync();
        }
    };
    private handleOpenSyncConflict = () => {
        this.applyStartupSyncConflict();
        this.renderSyncConflictDiffSoon();
    };
    private handleSaveShortcut = (event: KeyboardEvent) => {
        const key = String(event.key || '').toLowerCase();
        if (key !== 's' || (!event.metaKey && !event.ctrlKey) || event.altKey) return;
        event.preventDefault();
        if (this.showSyncConflictViewer()) return;
        void this.saveNow(true);
    };
    private handleAttachmentPickerKeydown = (event: KeyboardEvent) => {
        if (!this.attachmentPickerOpen) return;
        const key = event.key;
        if (key === 'ArrowDown') {
            event.preventDefault();
            this.moveAttachmentPickerSelection(1);
            return;
        }
        if (key === 'ArrowUp') {
            event.preventDefault();
            this.moveAttachmentPickerSelection(-1);
            return;
        }
        if (key === 'Enter') {
            event.preventDefault();
            this.chooseAttachmentPickerItem();
            return;
        }
        if (key === 'Escape') {
            event.preventDefault();
            this.closeAttachmentPicker();
        }
    };
    private handleAttachmentPickerReposition = () => {
        const viewModeChanged = this.normalizeAndroidViewMode();
        if (this.attachmentPickerOpen) this.updateAttachmentPickerPosition();
        if (viewModeChanged || this.attachmentPickerOpen) this.requestViewUpdate();
    };

    constructor(
        private sanitizer: DomSanitizer,
        private ref: ChangeDetectorRef
    ) { }

    public ngOnInit() {
        this.viewMode = this.settingsViewMode();
        this.editorOptions = this.createEditorOptions();
        this.loadCachedNotes(true);
        window.addEventListener('notedown:select-note', this.handleSelectNote);
        window.addEventListener('notedown:notes-changed', this.handleNotesChanged);
        window.addEventListener('notedown:settings-changed', this.handleSettingsChanged);
        window.addEventListener('notedown:startup-sync-status', this.handleStartupSyncStatus);
        window.addEventListener('notedown:open-sync-conflict', this.handleOpenSyncConflict);
        window.addEventListener('keydown', this.handleSaveShortcut, true);
        window.addEventListener('keydown', this.handleAttachmentPickerKeydown, true);
        window.addEventListener('resize', this.handleAttachmentPickerReposition);
        this.startDeferredStartupWork();
    }

    public ngOnDestroy() {
        window.removeEventListener('notedown:select-note', this.handleSelectNote);
        window.removeEventListener('notedown:notes-changed', this.handleNotesChanged);
        window.removeEventListener('notedown:settings-changed', this.handleSettingsChanged);
        window.removeEventListener('notedown:startup-sync-status', this.handleStartupSyncStatus);
        window.removeEventListener('notedown:open-sync-conflict', this.handleOpenSyncConflict);
        window.removeEventListener('keydown', this.handleSaveShortcut, true);
        window.removeEventListener('keydown', this.handleAttachmentPickerKeydown, true);
        window.removeEventListener('resize', this.handleAttachmentPickerReposition);
        if (this.completionDisposable) this.completionDisposable.dispose();
        if (this.foldingDisposable) this.foldingDisposable.dispose();
        this.clearScheduledStyleFold();
        this.clearScheduledSyncUpload();
        this.disposeEditorHoverHandlers();
        this.disposeDiffEditor();
    }

    public createNote() {
        const now = Date.now();
        const folder = this.newNoteFolder();
        const note: NoteItem = {
            id: `note-${Date.now()}`,
            icon: 'N',
            title: '새 노트',
            tags: ['draft'],
            status: 'draft',
            folder,
            workspaceName: this.workspaceLabel(folder),
            createdAt: this.nowLabel(new Date(now)),
            createdAtMs: now,
            updatedAt: this.nowLabel(new Date(now)),
            updatedAtMs: now,
            attachments: [],
            body: '# 새 노트\n\n'
        };
        this.notes = [note, ...this.notes];
        this.activeNote = note;
        this.persist(true);
        this.refreshPreview();
        if (this.isAndroidPlatform()) this.viewMode = 'preview';
        else if (!this.showSyncConflictViewer()) this.focusEditorSoon('first-line-end');
    }

    public handleBodyChange(nextBody: string) {
        if (!this.hasSelectedNote) return;

        const body = typeof nextBody === 'string' ? nextBody : '';
        if (this.activeNote.body === body) return;

        this.activeNote.body = body;
        this.syncDraftTitleFromFirstHeading();
        this.touchNote();
    }

    public handlePlainTextInput(event: Event) {
        const target = event.target as HTMLTextAreaElement | null;
        this.handleBodyChange(target?.value || '');
    }

    public touchNote(saveImmediately = false) {
        if (!this.hasSelectedNote) return;
        const now = Date.now();
        this.activeNote.updatedAt = this.nowLabel(new Date(now));
        this.activeNote.updatedAtMs = now;
        this.refreshPreview();
        this.hasUnsavedChanges = true;
        if (saveImmediately) {
            void this.saveNow(true);
            return;
        }
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
        this.activeNote.titleManuallyEdited = true;
        this.emitActiveNoteTitleChanged();
        this.touchNote();
    }

    public cancelTitleEdit() {
        this.titleDraft = this.activeNote?.title || '';
        this.editingTitle = false;
    }

    public async saveNow(emitChange = true) {
        if (!this.hasSelectedNote || this.saveBusy) return;
        this.saveBusy = true;
        this.requestViewUpdate();
        try {
            this.clearScheduledSyncUpload();
            this.markActiveNoteSaved();
            const syncNoteId = this.activeNote.id;
            const fileSave = this.persist(emitChange);
            if (fileSave) await fileSave;
            if (emitChange) await this.uploadNoteToSyncServer(syncNoteId);
        } finally {
            this.saveBusy = false;
            this.requestViewUpdate();
        }
    }

    public setMode(mode: ViewMode) {
        this.viewMode = this.normalizeViewModeForPlatform(mode);
        if (this.showSyncConflictViewer()) {
            this.renderSyncConflictDiffSoon();
            return;
        }
        if (!this.isAndroidPlatform()) this.focusEditorSoon();
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
        if (this.hasUnsavedChanges) return '저장 안 됨';
        return this.savedAt || this.activeNote?.updatedAt || '';
    }

    public openPdfExportOptionsOrExport() {
        if (!this.hasSelectedNote || this.pdfExportBusy) return;
        if (this.attachmentCount() > 0) {
            this.pdfExportOptionsOpen = true;
            this.closeAttachmentPicker();
            this.requestViewUpdate();
            return;
        }

        void this.exportNotePdf('markdown-images');
    }

    public closePdfExportOptions() {
        this.pdfExportOptionsOpen = false;
    }

    public async exportNotePdf(mode: PdfExportMode = 'markdown-images') {
        if (!this.hasSelectedNote || this.pdfExportBusy) return;

        let printHtml: string | null = null;
        this.pdfExportOptionsOpen = false;
        this.pdfExportBusy = true;
        this.pdfExportMessage = this.isAndroidPlatform()
            ? (mode === 'zip-with-attachments' ? 'PDF와 첨부 파일을 압축하는 중입니다.' : 'PDF 파일을 만드는 중입니다. 완료될 때까지 기다려 주세요.')
            : (mode === 'zip-with-attachments' ? 'PDF와 첨부 파일 압축을 준비하는 중입니다.' : 'PDF 저장을 준비하는 중입니다.');
        this.requestViewUpdate();

        try {
            const markdownImageAttachments = this.markdownImageAttachments();
            await this.preloadAndroidAttachmentDataUrls(markdownImageAttachments, true);
            const html = this.buildPdfDocumentHtml();
            const pdfApi = (window as any).notedown?.pdf;
            if (pdfApi?.saveNote) {
                try {
                    const result = await pdfApi.saveNote({
                        title: this.activeNote.title || '제목 없음',
                        html,
                        exportMode: mode,
                        storagePath: this.storagePath(),
                        attachments: mode === 'zip-with-attachments' ? this.pdfExportAttachments() : []
                    });
                    if (result?.ok || result?.canceled) return;
                    if (this.isAndroidPlatform() || mode === 'zip-with-attachments') {
                        window.alert(result?.error || (mode === 'zip-with-attachments' ? 'ZIP 저장에 실패했습니다.' : 'PDF 저장에 실패했습니다.'));
                        return;
                    }
                } catch (error) {
                    if (this.isAndroidPlatform() || mode === 'zip-with-attachments') {
                        window.alert(this.errorMessage(error, mode === 'zip-with-attachments' ? 'ZIP 저장에 실패했습니다.' : 'PDF 저장에 실패했습니다.'));
                        return;
                    }
                    // Fall through to the browser print path when Electron PDF export is unavailable.
                }
            }

            printHtml = html;
        } finally {
            this.pdfExportBusy = false;
            this.pdfExportMessage = '';
            this.requestViewUpdate();
        }

        if (printHtml) this.openPdfPrintWindow(printHtml);
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
            const attachment = this.attachmentForMarkdownPath(link.getAttribute('href') || '');
            if (attachment) {
                event.preventDefault();
                void this.openAttachment(attachment);
                return;
            }
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
        const base = 'flex size-7 items-center justify-center rounded-md transition-colors';
        if (this.viewMode === mode) return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public shouldShowSplitMode() {
        return this.canUseSplitMode();
    }

    public showHeaderModeButtons() {
        return !this.isAndroidPlatform();
    }

    public isSplitModeActive() {
        return this.viewMode === 'split' && this.canUseSplitMode();
    }

    public editorGridClass() {
        if (!this.isSplitModeActive()) return 'grid-cols-1';
        return this.isAndroidPlatform() ? 'grid-cols-2' : 'lg:grid-cols-2';
    }

    public previewPaneClass() {
        if (!this.isSplitModeActive()) return '';
        return this.isAndroidPlatform() ? 'border-l' : 'border-t lg:border-l lg:border-t-0';
    }

    public showMarkdownToolbar() {
        return this.isAndroidPlatform() && !this.showSyncConflictViewer() && this.viewMode !== 'preview';
    }

    public showAndroidViewToggle() {
        return this.isAndroidPlatform() && !this.showSyncConflictViewer() && this.hasSelectedNote;
    }

    public showAndroidSaveButton() {
        return this.isAndroidPlatform() && !this.showSyncConflictViewer() && this.hasSelectedNote;
    }

    public androidViewToggleButtonClass() {
        const base = 'absolute bottom-20 right-5 z-40 flex size-12 items-center justify-center rounded-full border shadow-xl transition-colors';
        if (this.viewMode === 'preview') return `${base} border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} border-stone-200 bg-white text-stone-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100`;
    }

    public androidSaveButtonClass() {
        const base = 'absolute bottom-5 right-5 z-50 flex size-12 items-center justify-center rounded-full border shadow-xl transition-colors disabled:cursor-wait disabled:opacity-70';
        if (this.hasUnsavedChanges) return `${base} border-emerald-700 bg-emerald-700 text-white dark:border-emerald-300 dark:bg-emerald-300 dark:text-zinc-950`;
        return `${base} border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950`;
    }

    public toggleAndroidPreviewMode() {
        if (!this.isAndroidPlatform()) return;
        this.headingMenuOpen = false;
        this.viewMode = this.viewMode === 'preview' ? 'write' : 'preview';
        this.requestViewUpdate();
    }

    public markdownToolbarButtonClass(actionId: MarkdownToolbarActionId) {
        const base = 'flex size-9 shrink-0 items-center justify-center rounded-md transition-colors';
        return `${base} text-stone-700 hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800`;
    }

    public headingToolbarButtonClass() {
        const base = 'flex h-9 min-w-10 shrink-0 items-center justify-center rounded-md px-2 text-[12px] font-semibold transition-colors';
        if (this.headingMenuOpen) return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} text-stone-700 hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800`;
    }

    public headingMenuItemClass(level: HeadingLevel) {
        const sizeClass = level === 1 ? 'text-[15px]' : level === 2 ? 'text-[14px]' : level === 3 ? 'text-[13px]' : 'text-[12px]';
        return `flex h-9 min-w-12 items-center justify-center rounded-md px-3 font-semibold text-stone-700 transition-colors hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800 ${sizeClass}`;
    }

    public toggleHeadingMenu() {
        if (!this.hasSelectedNote) return;
        this.headingMenuOpen = !this.headingMenuOpen;
        this.requestViewUpdate();
    }

    public applyHeadingLevel(level: HeadingLevel) {
        if (!this.hasSelectedNote) return;
        this.headingMenuOpen = false;
        this.prefixEditorLines(`${'#'.repeat(level)} `);
        this.requestViewUpdate();
    }

    public applyMarkdownToolbarAction(actionId: MarkdownToolbarActionId) {
        if (!this.hasSelectedNote) return;
        this.headingMenuOpen = false;
        this.requestViewUpdate();

        if (actionId === 'task') {
            this.prefixEditorLines('- [ ] ');
            return;
        }
        if (actionId === 'bullet') {
            this.prefixEditorLines('- ');
            return;
        }
        if (actionId === 'quote') {
            this.prefixEditorLines('> ');
            return;
        }
        if (actionId === 'code') {
            const selectedText = this.editorSelectedText();
            const code = selectedText || '';
            const text = `\n\`\`\`\n${code}\n\`\`\`\n`;
            this.replaceEditorSelection(text, selectedText ? text.length : '\n```\n'.length);
            return;
        }
        if (actionId === 'link') {
            const selectedText = this.editorSelectedText() || '링크';
            this.replaceEditorSelection(`[${selectedText}](https://)`, `[${selectedText}](https://`.length);
            return;
        }
        if (actionId === 'divider') {
            this.insertToolbarText('\n---\n');
            return;
        }
        if (actionId === 'image') {
            this.openAttachmentPicker('image');
            return;
        }
        if (actionId === 'file') {
            this.openAttachmentPicker('file');
        }
    }

    public usePlainTextEditor() {
        return this.isAndroidPlatform();
    }

    public attachmentButtonClass() {
        const base = 'inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-semibold transition-colors';
        if (this.attachmentPanelOpen) return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public attachmentCount(note = this.activeNote) {
        return this.noteAttachments(note).length;
    }

    public visibleAttachments(mode?: AttachmentPickerMode) {
        const attachments = this.noteAttachments();
        if (mode === 'image') return attachments.filter(attachment => this.isImageAttachment(attachment));
        return attachments;
    }

    public isImageAttachment(attachment?: NoteAttachment | null) {
        const mimeType = String(attachment?.mimeType || '').toLowerCase();
        if (mimeType.startsWith('image/')) return true;
        return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(attachment?.fileName || attachment?.relativePath || '');
    }

    public attachmentKindLabel(attachment?: NoteAttachment | null) {
        return this.isImageAttachment(attachment) ? '이미지' : '파일';
    }

    public attachmentSizeLabel(size?: number | null) {
        const value = Number(size) || 0;
        if (value <= 0) return '';
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
        return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    }

    public pdfAttachmentOptionDetail() {
        const count = this.attachmentCount();
        return count > 0 ? `첨부 ${count}개` : '첨부 없음';
    }

    public attachmentMessageClass() {
        const base = 'min-h-5 text-[12px]';
        if (this.attachmentMessageTone === 'success') return `${base} text-emerald-700 dark:text-emerald-300`;
        if (this.attachmentMessageTone === 'warning') return `${base} text-amber-700 dark:text-amber-300`;
        if (this.attachmentMessageTone === 'error') return `${base} text-red-600 dark:text-red-300`;
        return `${base} text-stone-500 dark:text-zinc-400`;
    }

    public attachmentPickerItemClass(index: number) {
        const base = 'flex w-full min-w-0 items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors';
        if (this.attachmentPickerIndex === index) return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} text-stone-700 hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800`;
    }

    public toggleAttachmentPanel() {
        if (!this.hasSelectedNote) return;
        this.attachmentPanelOpen = !this.attachmentPanelOpen;
        if (this.attachmentPanelOpen) this.closeAttachmentPicker();
    }

    public closeAttachmentPanel() {
        this.attachmentPanelOpen = false;
    }

    public openAttachmentPicker(mode: AttachmentPickerMode = 'file', anchor?: EditorCursorPosition) {
        if (!this.hasSelectedNote) return;
        this.attachmentPickerMode = mode;
        this.attachmentPanelOpen = false;
        this.attachmentPickerAnchor = this.normalizeEditorCursorPosition(anchor) || this.normalizeEditorCursorPosition(this.editor?.getPosition?.()) || null;
        this.updateAttachmentPickerPosition();
        this.rebuildAttachmentPickerItems();
        this.attachmentPickerOpen = true;
        this.attachmentPickerIndex = 0;
        this.requestViewUpdate();
        this.afterInitialRender(() => {
            this.updateAttachmentPickerPosition();
            this.requestViewUpdate();
        });
        this.scrollAttachmentPickerSelectionIntoView();
    }

    public closeAttachmentPicker() {
        this.attachmentPickerOpen = false;
        this.attachmentPickerItems = [];
        this.attachmentPickerIndex = 0;
        this.attachmentPickerAnchor = null;
    }

    private normalizeEditorCursorPosition(position: any): EditorCursorPosition | null {
        const lineNumber = Number(position?.lineNumber);
        const column = Number(position?.column);
        if (!Number.isFinite(lineNumber) || !Number.isFinite(column)) return null;
        const model = this.editor?.getModel?.();
        const lineCount = Number(model?.getLineCount?.());
        let safeLineNumber = Math.max(1, Math.round(lineNumber));
        if (Number.isFinite(lineCount) && lineCount > 0) {
            safeLineNumber = Math.min(safeLineNumber, lineCount);
        }
        const maxColumn = Number(model?.getLineMaxColumn?.(safeLineNumber));
        let safeColumn = Math.max(1, Math.round(column));
        if (Number.isFinite(maxColumn) && maxColumn > 0) {
            safeColumn = Math.min(safeColumn, maxColumn);
        }
        return {
            lineNumber: safeLineNumber,
            column: safeColumn,
            visualLeft: Number.isFinite(Number(position?.visualLeft)) ? Number(position.visualLeft) : undefined,
            visualTop: Number.isFinite(Number(position?.visualTop)) ? Number(position.visualTop) : undefined,
            visualHeight: Number.isFinite(Number(position?.visualHeight)) ? Number(position.visualHeight) : undefined
        };
    }

    private updateAttachmentPickerPosition() {
        const shell = document.querySelector<HTMLElement>('[data-note-editor-shell="true"]');
        const editorDom = this.editor?.getDomNode?.() as HTMLElement | null;
        const anchor = this.attachmentPickerAnchor || this.normalizeEditorCursorPosition(this.editor?.getPosition?.());
        const cursor = anchor ? this.attachmentPickerAnchorPixels(anchor) : null;
        const shellRect = shell?.getBoundingClientRect();
        const editorRect = editorDom?.getBoundingClientRect();

        if (!shellRect || !editorRect || !cursor) {
            this.attachmentPickerStyle = { left: '16px', top: '16px' };
            return;
        }

        const picker = document.querySelector<HTMLElement>('[data-attachment-picker="true"]');
        const pickerWidth = Math.min(picker?.offsetWidth || 380, Math.max(240, shellRect.width - 16));
        const pickerHeight = Math.min(picker?.offsetHeight || 320, Math.max(160, shellRect.height - 16));
        const gap = 8;
        const cursorLeft = editorRect.left + Math.max(0, Number(cursor.left) || 0);
        const cursorTop = editorRect.top + Math.max(0, Number(cursor.top) || 0);
        const cursorHeight = Math.max(18, Number(cursor.height) || 24);

        let left = cursorLeft - shellRect.left;
        let top = cursorTop + cursorHeight + gap - shellRect.top;

        if (top + pickerHeight > shellRect.height - gap) {
            top = cursorTop - shellRect.top - pickerHeight - gap;
        }

        left = this.clamp(left, gap, Math.max(gap, shellRect.width - pickerWidth - gap));
        top = this.clamp(top, gap, Math.max(gap, shellRect.height - pickerHeight - gap));

        this.attachmentPickerStyle = {
            left: `${Math.round(left)}px`,
            top: `${Math.round(top)}px`
        };
    }

    private clamp(value: number, min: number, max: number) {
        return Math.min(Math.max(value, min), max);
    }

    private attachmentPickerAnchorPixels(anchor: EditorCursorPosition) {
        if (Number.isFinite(anchor.visualLeft) && Number.isFinite(anchor.visualTop)) {
            return {
                left: anchor.visualLeft,
                top: anchor.visualTop,
                height: Number.isFinite(anchor.visualHeight) ? anchor.visualHeight : 24
            };
        }
        return this.editor?.getScrolledVisiblePosition?.(anchor);
    }

    public chooseAttachmentPickerItem(item = this.attachmentPickerItems[this.attachmentPickerIndex]) {
        if (!item) return;
        if (item.type === 'upload') {
            this.triggerAttachmentUpload(this.attachmentPickerMode);
            return;
        }
        if (item.attachment) this.insertAttachmentMarkdown(item.attachment, this.attachmentPickerMode);
    }

    public async triggerAttachmentUpload(mode: AttachmentPickerMode = 'file', insertAfterSave = false) {
        if (!this.hasSelectedNote || this.attachmentUploadBusy) return;
        this.attachmentInputMode = mode;
        this.attachmentInputAccept = mode === 'image' ? 'image/*' : '';
        this.attachmentUploadFromPicker = insertAfterSave || this.attachmentPickerOpen;
        this.requestViewUpdate();

        const api = (window as any).notedown?.storage;
        const storagePath = this.storagePath();
        if (api?.chooseAttachments && storagePath) {
            await this.chooseAttachmentsWithElectron(mode, this.attachmentUploadFromPicker);
            return;
        }

        window.setTimeout(() => {
            const input = document.querySelector<HTMLInputElement>('[data-note-attachment-input="true"]');
            input?.click();
        }, 0);
    }

    public async handleAttachmentInputChange(event: Event) {
        const input = event.target as HTMLInputElement | null;
        const files = Array.from(input?.files || []);
        if (input) input.value = '';
        if (files.length === 0) return;
        const insertAfterSave = this.attachmentUploadFromPicker;
        this.attachmentUploadFromPicker = false;
        await this.attachFiles(files, this.attachmentInputMode, insertAfterSave);
    }

    public async openAttachment(attachment: NoteAttachment, event?: Event) {
        if (event) event.stopPropagation();
        const api = (window as any).notedown?.storage;
        const storagePath = this.storagePath();
        if (!api?.openAttachment || !storagePath || !attachment?.relativePath) return;
        try {
            await api.openAttachment({ storagePath, relativePath: attachment.relativePath });
        } catch (error) {
            this.setAttachmentMessage(this.errorMessage(error, '첨부 파일을 열지 못했습니다.'), 'error');
        }
    }

    private async chooseAttachmentsWithElectron(mode: AttachmentPickerMode, insertAfterSave: boolean) {
        const api = (window as any).notedown?.storage;
        const storagePath = this.storagePath();
        if (!api?.chooseAttachments || !storagePath) return;

        this.attachmentUploadBusy = true;
        this.setAttachmentMessage('첨부 파일을 선택하는 중입니다...', 'info');
        this.requestViewUpdate();

        try {
            const fileSave = this.persistFileNotes();
            if (fileSave) await fileSave;

            const result = await api.chooseAttachments({
                storagePath,
                note: this.activeNote,
                mode
            });
            if (result?.canceled) return;
            if (!result?.ok) {
                throw new Error(result?.error || (mode === 'image' ? '선택한 이미지가 없습니다.' : '첨부 파일을 저장하지 못했습니다.'));
            }

            const attachments = Array.isArray(result.attachments)
                ? result.attachments.filter((attachment: NoteAttachment) => attachment?.relativePath)
                : (result.attachment ? [result.attachment] : []);
            this.finishSavedAttachments(attachments, mode, insertAfterSave);
        } catch (error) {
            this.setAttachmentMessage(this.errorMessage(error, '첨부 파일을 저장하지 못했습니다.'), 'error');
        } finally {
            this.attachmentUploadBusy = false;
            this.attachmentUploadFromPicker = false;
            this.requestViewUpdate();
        }
    }

    private async attachFiles(files: File[], mode: AttachmentPickerMode, insertAfterSave = false) {
        const api = (window as any).notedown?.storage;
        const storagePath = this.storagePath();
        if (!api?.saveAttachment || !storagePath) {
            this.setAttachmentMessage('첨부 파일 저장은 Electron 저장소에서 사용할 수 있습니다.', 'warning');
            return;
        }

        this.attachmentUploadBusy = true;
        this.setAttachmentMessage('첨부 파일을 저장하는 중입니다...', 'info');
        this.requestViewUpdate();

        try {
            const fileSave = this.persistFileNotes();
            if (fileSave) await fileSave;

            const savedAttachments: NoteAttachment[] = [];
            for (const file of files) {
                if (mode === 'image' && !this.fileLooksLikeImage(file)) continue;
                const content = await this.readFileAsBase64(file);
                const result = await api.saveAttachment({
                    storagePath,
                    note: this.activeNote,
                    fileName: file.name,
                    mimeType: file.type || this.mimeTypeFromName(file.name),
                    content,
                    contentEncoding: 'base64'
                });
                if (result?.ok && result.attachment) {
                    savedAttachments.push(result.attachment);
                } else if (result?.error) {
                    throw new Error(result.error);
                }
            }

            this.finishSavedAttachments(savedAttachments, mode, insertAfterSave);
        } catch (error) {
            this.setAttachmentMessage(this.errorMessage(error, '첨부 파일을 저장하지 못했습니다.'), 'error');
        } finally {
            this.attachmentUploadBusy = false;
            this.attachmentUploadFromPicker = false;
            this.requestViewUpdate();
        }
    }

    private readFileAsBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const value = String(reader.result || '');
                resolve(value.includes(',') ? value.split(',').pop() || '' : value);
            };
            reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
            reader.readAsDataURL(file);
        });
    }

    private fileLooksLikeImage(file: File) {
        return String(file.type || '').toLowerCase().startsWith('image/') || this.isImageAttachment({ fileName: file.name, relativePath: file.name });
    }

    private finishSavedAttachments(attachments: NoteAttachment[], mode: AttachmentPickerMode, insertAfterSave: boolean) {
        const savedAttachments = attachments
            .map(attachment => this.normalizeAttachment(attachment, this.activeNote?.relativePath || ''))
            .filter(attachment => attachment.relativePath && !attachment.deleted);

        if (savedAttachments.length === 0) {
            this.setAttachmentMessage(mode === 'image' ? '선택한 이미지가 없습니다.' : '저장한 첨부 파일이 없습니다.', 'warning');
            return;
        }

        for (const attachment of savedAttachments) {
            this.upsertActiveNoteAttachment(attachment);
        }

        this.touchNote(true);
        this.rebuildAttachmentPickerItems();
        this.setAttachmentMessage(`첨부 파일 ${savedAttachments.length}개를 저장했습니다.`, 'success');

        if (insertAfterSave) {
            this.insertAttachmentsMarkdown(savedAttachments, mode);
            return;
        }

        this.closeAttachmentPicker();
        this.attachmentPanelOpen = true;
    }

    private mimeTypeFromName(fileName: string) {
        const lower = fileName.toLowerCase();
        if (lower.endsWith('.png')) return 'image/png';
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
        if (lower.endsWith('.gif')) return 'image/gif';
        if (lower.endsWith('.webp')) return 'image/webp';
        if (lower.endsWith('.svg')) return 'image/svg+xml';
        if (lower.endsWith('.pdf')) return 'application/pdf';
        if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain';
        return 'application/octet-stream';
    }

    private upsertActiveNoteAttachment(attachment: NoteAttachment) {
        if (!attachment?.relativePath) return;
        const attachments = this.noteAttachments();
        const index = attachments.findIndex(item => item.relativePath === attachment.relativePath || (attachment.id && item.id === attachment.id));
        const nextAttachment = this.normalizeAttachment(attachment, this.activeNote?.relativePath || '');
        if (nextAttachment.relativePath) this.attachmentDataUrlCache.delete(nextAttachment.relativePath);
        if (nextAttachment.relativePath) this.attachmentPdfDataUrlCache.delete(nextAttachment.relativePath);
        if (index >= 0) {
            attachments[index] = { ...attachments[index], ...nextAttachment };
        } else {
            attachments.push(nextAttachment);
        }
        this.activeNote.attachments = attachments;
    }

    private noteAttachments(note = this.activeNote): NoteAttachment[] {
        if (!Array.isArray(note?.attachments)) return [];
        return note.attachments
            .map(attachment => this.normalizeAttachment(attachment, note?.relativePath || ''))
            .filter(attachment => attachment.relativePath && !attachment.deleted);
    }

    private pdfExportAttachments(): PdfExportAttachment[] {
        return this.noteAttachments().map(attachment => ({
            fileName: attachment.fileName || this.basename(attachment.relativePath),
            relativePath: attachment.relativePath,
            mimeType: attachment.mimeType || this.mimeTypeFromName(attachment.fileName || attachment.relativePath),
            size: attachment.size
        }));
    }

    private markdownImageAttachments() {
        const html = this.converter.makeHtml(this.activeNote?.body || '');
        const documentForImages = document.implementation.createHTMLDocument('notedown-markdown-images');
        documentForImages.body.innerHTML = html;

        const seen = new Set<string>();
        const attachments: NoteAttachment[] = [];
        documentForImages.body.querySelectorAll('img[src]').forEach(image => {
            const attachment = this.attachmentForMarkdownPath(image.getAttribute('src') || '');
            if (!attachment || seen.has(attachment.relativePath)) return;
            if (!this.isImageAttachment(attachment)) return;
            seen.add(attachment.relativePath);
            attachments.push(attachment);
        });
        return attachments;
    }

    private normalizeAttachment(attachment: any, noteRelativePath = ''): NoteAttachment {
        return {
            id: attachment?.id || attachment?.attachmentId || '',
            fileName: String(attachment?.fileName || this.basename(attachment?.relativePath || '첨부 파일')),
            relativePath: String(attachment?.relativePath || ''),
            noteRelativePath: attachment?.noteRelativePath || noteRelativePath || this.activeNote?.relativePath || '',
            mimeType: attachment?.mimeType || '',
            size: Number.isFinite(attachment?.size) ? Number(attachment.size) : undefined,
            contentHash: attachment?.contentHash || null,
            updatedAtMs: Number.isFinite(attachment?.updatedAtMs) ? Number(attachment.updatedAtMs) : null,
            deleted: Boolean(attachment?.deleted)
        };
    }

    private rebuildAttachmentPickerItems() {
        const attachments = this.visibleAttachments(this.attachmentPickerMode);
        const items: AttachmentPickerItem[] = attachments.map(attachment => ({
            type: 'attachment',
            label: attachment.fileName,
            detail: [this.attachmentKindLabel(attachment), this.attachmentSizeLabel(attachment.size)].filter(Boolean).join(' · '),
            attachment
        }));
        items.push({
            type: 'upload',
            label: this.attachmentPickerMode === 'image' ? '이미지 첨부...' : '파일 첨부...',
            detail: this.attachmentPickerMode === 'image' ? '새 이미지를 현재 노트에 추가' : '새 파일을 현재 노트에 추가'
        });
        this.attachmentPickerItems = items;
        if (this.attachmentPickerIndex >= items.length) this.attachmentPickerIndex = Math.max(0, items.length - 1);
    }

    private moveAttachmentPickerSelection(delta: number) {
        if (this.attachmentPickerItems.length === 0) return;
        const length = this.attachmentPickerItems.length;
        this.attachmentPickerIndex = (this.attachmentPickerIndex + delta + length) % length;
        this.requestViewUpdate();
        this.scrollAttachmentPickerSelectionIntoView();
    }

    private scrollAttachmentPickerSelectionIntoView() {
        window.setTimeout(() => {
            const element = document.querySelector<HTMLElement>(`[data-attachment-picker-index="${this.attachmentPickerIndex}"]`);
            element?.scrollIntoView({ block: 'nearest' });
        }, 0);
    }

    private insertAttachmentMarkdown(attachment: NoteAttachment, mode: AttachmentPickerMode) {
        if (!attachment?.relativePath) return;
        this.insertAttachmentsMarkdown([attachment], mode);
    }

    private insertAttachmentsMarkdown(attachments: NoteAttachment[], mode: AttachmentPickerMode) {
        const snippets = attachments
            .filter(attachment => attachment?.relativePath)
            .map(attachment => this.attachmentMarkdownText(attachment, mode));
        if (snippets.length === 0) return;
        const text = snippets.join('\n');
        this.insertEditorText(text);
        this.closeAttachmentPicker();
        this.focusEditorSoon();
        this.requestViewUpdate();
    }

    private attachmentMarkdownText(attachment: NoteAttachment, mode: AttachmentPickerMode) {
        const label = this.escapeMarkdownLabel(attachment.fileName || this.basename(attachment.relativePath));
        const url = this.markdownAttachmentUrl(attachment.relativePath);
        return mode === 'image' ? `![${label}](${url})` : `[${label}](${url})`;
    }

    private insertEditorText(text: string) {
        this.replaceEditorSelection(text, text.length);
    }

    private markdownAttachmentUrl(relativePath: string) {
        const encoded = String(relativePath || '')
            .split('/')
            .map(part => encodeURIComponent(part))
            .join('/');
        return encoded || relativePath;
    }

    private escapeMarkdownLabel(value: string) {
        return String(value || '첨부 파일').replace(/([\\[\\]])/g, '\\$1');
    }

    private basename(value: string) {
        return String(value || '').split('/').filter(Boolean).pop() || '첨부 파일';
    }

    private setAttachmentMessage(message: string, tone: AttachmentMessageTone) {
        this.attachmentMessage = message;
        this.attachmentMessageTone = tone;
    }

    public showSyncConflictViewer() {
        return this.syncConflicts.length > 0;
    }

    public selectedSyncConflict() {
        return this.syncConflicts[this.selectedSyncConflictIndex] || this.syncConflicts[0] || null;
    }

    public selectSyncConflict(index: number) {
        if (index < 0 || index >= this.syncConflicts.length) return;
        this.selectedSyncConflictIndex = index;
        this.syncConflictDetail = null;
        this.syncConflictDiffReady = false;
        this.syncConflictResolveMessage = '';
        this.renderSyncConflictDiffSoon();
        void this.loadSyncConflictDetail();
    }

    public syncConflictButtonClass(index: number) {
        const base = 'flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors';
        if (this.selectedSyncConflictIndex === index) return `${base} bg-amber-100 text-amber-950 dark:bg-amber-500/25 dark:text-amber-100`;
        return `${base} text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public syncConflictReason(conflict = this.selectedSyncConflict()) {
        const reason = conflict?.reason || '';
        if (reason === 'server_metadata_changed_after_local_edit') return '서버 변경과 로컬 편집이 겹쳤습니다.';
        if (reason === 'server_metadata_changed_without_sync_history') return '동기화 이력이 없어 자동 적용하지 않았습니다.';
        if (reason === 'server_metadata_removed_after_local_edit') return '서버 삭제와 로컬 편집이 겹쳤습니다.';
        if (reason === 'server_file_changed') return '서버 파일이 변경되었습니다.';
        if (reason === 'server_metadata_changed') return '서버 메타데이터가 변경되었습니다.';
        if (reason === 'conflict') return '서버와 로컬 버전이 충돌했습니다.';
        return reason || '서버와 로컬 버전을 수동으로 비교해야 합니다.';
    }

    public syncConflictPathLabel(conflict = this.selectedSyncConflict()) {
        return conflict?.relativePath || '충돌 상세 정보 없음';
    }

    public setSyncConflictResolveChoice(choice: SyncConflictResolution) {
        this.syncConflictResolveChoice = choice;
        this.syncConflictResolveMessage = '';
    }

    public syncConflictResolveChoiceButtonClass(choice: SyncConflictResolution) {
        const base = 'h-8 rounded-md px-3 text-[12px] font-semibold transition-colors';
        if (this.syncConflictResolveChoice === choice) {
            return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        }
        return `${base} text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public syncConflictApplyButtonClass() {
        return 'h-9 rounded-md bg-amber-500 px-3 text-[13px] font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-400 dark:text-zinc-950 dark:hover:bg-amber-300';
    }

    public syncConflictResolveMessageClass() {
        const base = 'min-h-5 truncate text-[12px]';
        if (this.syncConflictResolveTone === 'success') return `${base} text-emerald-700 dark:text-emerald-300`;
        if (this.syncConflictResolveTone === 'warning') return `${base} text-amber-700 dark:text-amber-300`;
        if (this.syncConflictResolveTone === 'error') return `${base} text-red-600 dark:text-red-300`;
        return `${base} text-stone-500 dark:text-zinc-400`;
    }

    public async resolveSelectedSyncConflict() {
        const conflict = this.selectedSyncConflict();
        const relativePath = conflict?.relativePath || '';
        const api = this.syncApi();
        if (!relativePath || this.syncConflictResolveBusy) return;
        if (!api?.resolveConflict) {
            this.setSyncConflictResolveMessage('충돌 적용은 Electron 앱에서 사용할 수 있습니다.', 'warning');
            return;
        }

        this.syncConflictResolveBusy = true;
        this.setSyncConflictResolveMessage(this.syncConflictResolveChoice === 'server'
            ? '서버 버전을 로컬 문서에 적용하는 중입니다...'
            : '로컬 버전을 서버에 적용하는 중입니다...', 'info');

        try {
            const result = await api.resolveConflict(this.syncPayload({
                relativePath,
                type: conflict.type || '',
                resolution: this.syncConflictResolveChoice,
                serverRevision: this.syncConflictServerRevision(conflict),
                serverFile: conflict.serverFile || this.syncConflictDetail?.serverFile || null,
                serverAttachment: conflict.serverAttachment || null,
                serverAttachmentMetadata: conflict.serverAttachmentMetadata || null,
                clientAttachment: conflict.clientAttachment || null,
                noteRelativePath: conflict.serverAttachmentMetadata?.noteRelativePath || conflict.clientAttachment?.noteRelativePath || '',
                serverNote: conflict.serverNote || null,
                serverWorkspace: conflict.serverWorkspace || null
            }));

            if (!result?.didApply && !result?.ok) {
                this.setSyncConflictResolveMessage(result?.error || '충돌을 적용하지 못했습니다.', 'error');
                if (result?.status === 'conflict' || result?.conflicts?.length) this.storeStartupSyncResult(result);
                return;
            }

            await this.reloadNotesAfterSyncResolution();
            this.storeStartupSyncResult(result);
            const remaining = this.startupSyncConflictCount(result);
            this.setSyncConflictResolveMessage(
                remaining > 0 ? `선택한 충돌을 적용했습니다. 남은 충돌 ${remaining}건` : '선택한 충돌을 적용하고 동기화했습니다.',
                remaining > 0 ? 'warning' : 'success'
            );
        } catch (error) {
            this.setSyncConflictResolveMessage(this.errorMessage(error, '충돌을 적용하지 못했습니다.'), 'error');
        } finally {
            this.syncConflictResolveBusy = false;
            this.renderSyncConflictDiffSoon();
        }
    }

    public syncConflictServerText() {
        const conflict = this.selectedSyncConflict();
        if (!conflict) return '';
        if (this.syncConflictBusy) return '서버 파일을 불러오는 중입니다...';
        if (this.syncConflictDetail?.serverError) return `서버 파일을 읽지 못했습니다.\n\n${this.syncConflictDetail.serverError}`;
        if (typeof this.syncConflictDetail?.serverContent === 'string') return this.syncConflictDetail.serverContent;
        return JSON.stringify(conflict.serverNote || conflict.serverFile || {}, null, 2);
    }

    public syncConflictLocalText() {
        const conflict = this.selectedSyncConflict();
        if (!conflict) return '';
        if (this.syncConflictBusy) return '로컬 파일을 불러오는 중입니다...';
        if (this.syncConflictDetail?.localError && !this.syncConflictDetail.localExists) {
            return `로컬 파일을 읽지 못했습니다.\n\n${this.syncConflictDetail.localError}`;
        }
        if (typeof this.syncConflictDetail?.localContent === 'string') return this.syncConflictDetail.localContent;
        return JSON.stringify(conflict.clientNote || {}, null, 2);
    }

    public onHiddenMonacoEvent(event: NuMonacoEditorEvent) {
        if (event.type !== 'init' && event.type !== 're-init') return;
        this.renderSyncConflictDiffSoon();
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
            lineNumbers: 'off',
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

    private syncDraftTitleFromFirstHeading() {
        if (!this.shouldSyncDraftTitleFromFirstHeading()) return;

        const title = this.firstMarkdownH1Title(this.activeNote.body);
        if (!title || this.activeNote.title === title) return;

        this.activeNote.title = title;
        this.titleDraft = title;
        this.emitActiveNoteTitleChanged();
    }

    private shouldSyncDraftTitleFromFirstHeading() {
        return this.hasSelectedNote
            && this.activeNote.status === 'draft'
            && !this.activeNote.titleManuallyEdited;
    }

    private firstMarkdownH1Title(body: string) {
        const line = String(body || '')
            .split('\n')
            .find(item => /^\s{0,3}#\s+/.test(item));
        if (!line) return '';

        const match = /^\s{0,3}#\s+(.+?)\s*$/.exec(line);
        return match ? match[1].replace(/\s+#+\s*$/, '').trim() : '';
    }

    private emitActiveNoteTitleChanged() {
        if (!this.hasSelectedNote) return;
        window.dispatchEvent(new CustomEvent('notedown:note-title-changed', {
            detail: {
                noteId: this.activeNote.id,
                title: this.activeNote.title || ''
            }
        }));
    }

    private markActiveNoteSaved() {
        if (!this.hasSelectedNote || this.activeNote.status !== 'draft') return;
        this.activeNote.status = 'active';
    }

    private selectNoteById(id?: string | null) {
        const note = id === '' ? null : (id ? this.notes.find(item => item.id === id) || this.notes[0] : this.notes[0]);
        if (!note) {
            this.activeNote = this.emptyNote();
            this.editingTitle = false;
            this.titleDraft = '';
            this.attachmentPanelOpen = false;
            this.closeAttachmentPicker();
            this.savedAt = '';
            this.hasUnsavedChanges = false;
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
        this.attachmentPanelOpen = false;
        this.closeAttachmentPicker();
        this.autoFoldedStyleNoteId = '';
        if (this.isAndroidPlatform()) this.viewMode = 'preview';
        localStorage.setItem(this.activeNoteKey, note.id);
        this.refreshPreview();
        if (this.showSyncConflictViewer()) {
            this.renderSyncConflictDiffSoon();
        } else {
            this.focusEditorSoon(this.shouldFocusFirstLineEnd(note) ? 'first-line-end' : 'default');
            this.scheduleFoldStyleBlocks();
        }
    }

    private loadCachedNotes(selectStored: boolean) {
        const fileBacked = this.usesFileStorage();
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const notes = JSON.parse(stored);
                if (Array.isArray(notes)) {
                    this.notes = notes.map((note, index) => this.normalizeNote(note, index));
                }
            }
        } catch (error) {
            this.notes = [];
        }

        if (fileBacked && this.isDefaultSeedCache(this.notes)) this.notes = [];
        if (!Array.isArray(this.notes) || this.notes.length === 0) this.notes = fileBacked ? [] : this.defaultNotes();
        if (selectStored) this.selectNoteById(localStorage.getItem(this.activeNoteKey));
    }

    private startDeferredStartupWork() {
        void this.refreshNotesFromStorage(true)
            .finally(() => { void this.runStartupSyncOrApplyStoredConflict(); });
        this.afterInitialRender(() => {
            this.monacoEditorsReady = true;
            this.requestViewUpdate();
        });
    }

    private async refreshNotesFromStorage(selectStored: boolean) {
        await this.loadNotes(selectStored);
        this.requestViewUpdate();
    }

    private async runStartupSyncOrApplyStoredConflict() {
        const didRun = await this.runStartupSync();
        if (!didRun) this.applyStartupSyncConflict();
        this.renderSyncConflictDiffSoon();
        this.requestViewUpdate();
    }

    private afterInitialRender(callback: () => void) {
        const run = () => window.setTimeout(callback, 0);
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => run());
            return;
        }
        run();
    }

    private requestViewUpdate() {
        window.setTimeout(() => {
            try {
                this.ref.detectChanges();
            } catch (error) {
                // The view may already be destroyed when a deferred sync callback settles.
            }
        }, 0);
    }

    private async loadNotes(selectStored: boolean) {
        const fileBacked = this.usesFileStorage();
        const fileNotes = await this.loadFileNotes();
        if (fileNotes) {
            this.notes = fileNotes;
            if (selectStored) this.selectNoteById(localStorage.getItem(this.activeNoteKey));
            return;
        }

        try {
            const stored = localStorage.getItem(this.storageKey);
            this.notes = stored ? JSON.parse(stored) : (fileBacked ? [] : this.defaultNotes());
            if (!Array.isArray(this.notes) || this.notes.length === 0) this.notes = [];
            this.notes = this.notes.map((note, index) => this.normalizeNote(note, index));
            if (!stored && !fileBacked) this.persist(true);
        } catch (error) {
            this.notes = fileBacked ? [] : this.defaultNotes();
            if (!fileBacked) this.persist(true);
        }

        if (selectStored) this.selectNoteById(localStorage.getItem(this.activeNoteKey));
    }

    private persist(emitChange: boolean) {
        localStorage.setItem(this.storageKey, JSON.stringify(this.notes));
        this.hasUnsavedChanges = false;
        if (this.hasSelectedNote) {
            localStorage.setItem(this.activeNoteKey, this.activeNote.id);
        } else {
            localStorage.removeItem(this.activeNoteKey);
        }
        this.savedAt = this.nowLabel();
        const fileSave = this.persistFileNotes();
        if (emitChange) {
            if (fileSave) {
                fileSave.finally(() => {
                    this.emitNotesChanged();
                });
            } else {
                this.emitNotesChanged();
            }
        }
        return fileSave;
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

    private clearScheduledSyncUpload() {
        if (this.syncUploadTimeout == null) return;
        window.clearTimeout(this.syncUploadTimeout);
        this.syncUploadTimeout = null;
    }

    private async uploadNoteToSyncServer(noteId: string) {
        const api = (window as any).notedown?.sync;
        const settings = this.readSettings();
        const note = this.notes.find(item => item.id === noteId);
        if (!api?.uploadNote || !note || !this.canRunSavedSync(settings)) return;

        this.emitSaveSyncStatus('동기화 중', this.saveSyncNoteDetail(note, '서버에 저장하는 중입니다.'), 'running');
        try {
            const result = await api.uploadNote({
                serverUrl: settings.syncServerUrl,
                token: settings.syncToken,
                clientId: settings.syncClientId,
                storagePath: settings.storagePath,
                note
            });
            const conflictCount = this.startupSyncConflictCount(result);
            if (result?.status === 'conflict' || conflictCount > 0) {
                this.storeStartupSyncResult(result);
                return;
            }
            if (result?.ok) {
                this.emitSaveSyncStatus('동기화 완료', this.saveSyncNoteDetail(note, '서버에 저장했습니다.'), 'success');
                return;
            }
            this.emitSaveSyncStatus('동기화 실패', result?.error || '문서 동기화에 실패했습니다.', 'error');
        } catch (error) {
            this.emitSaveSyncStatus('동기화 실패', this.errorMessage(error, '문서 동기화에 실패했습니다.'), 'error');
        }
    }

    private emitSaveSyncStatus(label: string, detail: string, tone: 'running' | 'success' | 'warning' | 'error') {
        window.dispatchEvent(new CustomEvent('notedown:save-sync-status', {
            detail: {
                label,
                detail,
                tone,
                source: 'page.notes',
                syncedAtMs: Date.now()
            }
        }));
    }

    private saveSyncNoteDetail(note: NoteItem, fallback: string) {
        const title = (note?.title || '').trim();
        return title ? `${title} - ${fallback}` : fallback;
    }

    private async runStartupSync() {
        const api = (window as any).notedown?.sync;
        const settings = this.readSettings();
        if (!api?.runFull || !this.canRunSavedSync(settings)) return false;

        const sessionKey = `notedown.sync.startup.${settings.syncServerUrl}.${settings.syncClientId}`;
        if (sessionStorage.getItem(sessionKey)) return false;
        sessionStorage.setItem(sessionKey, 'running');
        this.storeStartupSyncResult({ ok: false, status: 'running' });

        try {
            const result = await api.runFull({
                serverUrl: settings.syncServerUrl,
                token: settings.syncToken,
                clientId: settings.syncClientId,
                storagePath: settings.storagePath
            });
            this.storeStartupSyncResult(result);
            if (result?.ok || result?.status === 'conflict') {
                await this.reloadNotesAfterStartupSync();
            }
        } catch (error) {
            this.storeStartupSyncResult({ ok: false, status: 'error', error: this.errorMessage(error, '시작 동기화에 실패했습니다.') });
        } finally {
            sessionStorage.setItem(sessionKey, 'done');
        }

        return true;
    }

    private canRunSavedSync(settings: any) {
        return Boolean(settings?.syncServerUrl && settings.syncToken && settings.storagePath && settings.syncClientId);
    }

    private storeStartupSyncResult(result: any) {
        const conflicts = this.extractSyncConflicts(result);
        const rawSummary = result?.summary || {
            uploadFiles: 0,
            downloadFiles: 0,
            deleteServerFiles: 0,
            deleteLocalFiles: 0,
            conflicts: conflicts.length
        };
        const summary = {
            ...rawSummary,
            conflicts: conflicts.length
        };
        const hasConflicts = conflicts.length > 0;
        const status = result?.status === 'running'
            ? 'running'
            : hasConflicts
                ? 'conflict'
                : result?.status === 'conflict'
                    ? (result?.ok ? 'ok' : 'ok')
                    : result?.status || (result?.ok ? 'ok' : 'error');
        const payload = {
            status,
            ok: Boolean(result?.ok && !hasConflicts),
            summary,
            conflicts,
            error: result?.error || '',
            syncedAtMs: Date.now()
        };
        localStorage.setItem(this.startupSyncResultKey, JSON.stringify(payload));
        this.applyStartupSyncConflict(payload);
        window.dispatchEvent(new CustomEvent('notedown:startup-sync-status', {
            detail: { ...payload, source: 'page.notes' }
        }));
        this.requestViewUpdate();
    }

    private extractSyncConflicts(result: any) {
        const items = [
            ...(Array.isArray(result?.conflicts) ? result.conflicts : []),
            ...(Array.isArray(result?.plan?.conflicts) ? result.plan.conflicts : []),
            ...(Array.isArray(result?.operations?.conflicts) ? result.operations.conflicts : []),
            ...(Array.isArray(result?.attachmentConflicts) ? result.attachmentConflicts : []),
            ...(result?.file ? [result.file] : []),
            ...(result?.attachment ? [result.attachment] : [])
        ];
        const conflicts = new Map<string, any>();
        for (const rawItem of items) {
            const item = rawItem?.file || rawItem;
            const relativePath = item?.relativePath || item?.serverFile?.relativePath || '';
            if (!relativePath) continue;
            if (this.isSystemSyncPath(relativePath)) continue;
            conflicts.set(`${relativePath}:${item.reason || item.status || ''}`, this.compactSyncConflict(item));
        }
        return Array.from(conflicts.values());
    }

    private isSystemSyncPath(relativePath: string) {
        const firstPart = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/g, '').split('/').filter(Boolean)[0] || '';
        return firstPart === 'metadata.json' || firstPart === 'metadata.db' || firstPart === '.notedown-sync.json';
    }

    private compactSyncConflict(conflict: any) {
        return {
            relativePath: conflict.relativePath || conflict.serverFile?.relativePath || conflict.serverAttachment?.relativePath || '',
            reason: conflict.reason || conflict.status || '',
            type: conflict.type || '',
            clientRevision: conflict.clientRevision,
            serverRevision: conflict.serverRevision,
            serverFile: this.compactServerFile(conflict.serverFile),
            serverNote: conflict.serverNote || null,
            clientNote: conflict.clientNote || null,
            clientWorkspace: conflict.clientWorkspace || null,
            serverWorkspace: conflict.serverWorkspace || null,
            clientAttachment: conflict.clientAttachment || null,
            serverAttachment: this.compactServerFile(conflict.serverAttachment),
            serverAttachmentMetadata: conflict.serverAttachmentMetadata || null
        };
    }

    private compactServerFile(file: any) {
        if (!file) return null;
        const { content: _content, ...rest } = file;
        return rest;
    }

    private applyStartupSyncConflict(result = this.readStartupSyncResult()) {
        const isRecent = result?.syncedAtMs && Date.now() - Number(result.syncedAtMs) <= 30 * 60 * 1000;
        const conflicts = this.extractSyncConflicts(result) as SyncConflict[];
        if (!isRecent || conflicts.length === 0) {
            this.clearSyncConflictViewer();
            return;
        }

        this.syncConflicts = conflicts;
        if (this.selectedSyncConflictIndex >= this.syncConflicts.length) this.selectedSyncConflictIndex = 0;
        this.syncConflictDetail = null;
        this.syncConflictDiffReady = false;
        void this.loadSyncConflictDetail();
        this.renderSyncConflictDiffSoon();
        this.requestViewUpdate();
    }

    private clearSyncConflictViewer() {
        if (this.syncConflicts.length === 0) return;
        this.syncConflicts = [];
        this.selectedSyncConflictIndex = 0;
        this.syncConflictDetail = null;
        this.syncConflictBusy = false;
        this.syncConflictResolveBusy = false;
        this.syncConflictResolveMessage = '';
        this.disposeDiffEditor();
        this.requestViewUpdate();
    }

    private readStartupSyncResult() {
        try {
            return JSON.parse(localStorage.getItem(this.startupSyncResultKey) || '{}') || {};
        } catch (error) {
            return {};
        }
    }

    private startupSyncConflictCount(result: any) {
        return Number(result?.summary?.conflicts)
            || result?.conflicts?.length
            || result?.plan?.conflicts?.length
            || result?.operations?.conflicts?.length
            || result?.attachmentConflicts?.length
            || (result?.status === 'conflict' ? 1 : 0)
            || 0;
    }

    private syncConflictServerRevision(conflict = this.selectedSyncConflict()) {
        return Number(conflict?.serverRevision)
            || Number(conflict?.serverFile?.revision)
            || Number(conflict?.serverAttachment?.revision)
            || Number(this.syncConflictDetail?.serverFile?.revision)
            || 0;
    }

    private setSyncConflictResolveMessage(message: string, tone: SyncConflictResolveTone) {
        this.syncConflictResolveMessage = message;
        this.syncConflictResolveTone = tone;
    }

    private async reloadNotesAfterStartupSync() {
        const activeId = localStorage.getItem(this.activeNoteKey) || this.activeNote?.id || '';
        await this.loadNotes(false);
        this.selectNoteById(activeId);
        this.emitNotesChanged();
        this.requestViewUpdate();
    }

    private async reloadNotesAfterSyncResolution() {
        const activeId = localStorage.getItem(this.activeNoteKey) || this.activeNote?.id || '';
        await this.loadNotes(false);
        this.selectNoteById(activeId);
        this.emitNotesChanged();
    }

    private async loadSyncConflictDetail() {
        const conflict = this.selectedSyncConflict();
        const relativePath = conflict?.relativePath || '';
        const api = this.syncApi();
        if (!relativePath || !api?.readFile) {
            this.syncConflictDetail = null;
            this.renderSyncConflictDiffSoon();
            this.requestViewUpdate();
            return;
        }

        this.syncConflictBusy = true;
        this.syncConflictDiffReady = false;
        this.renderSyncConflictDiffSoon();
        this.requestViewUpdate();
        try {
            const result = await api.readFile(this.syncPayload({ relativePath, type: conflict.type || '' }));
            if (this.selectedSyncConflict()?.relativePath !== relativePath) return;
            if (result?.ok) {
                this.syncConflictDetail = result;
            } else {
                this.syncConflictDetail = {
                    relativePath,
                    serverError: result?.error || '충돌 파일을 읽지 못했습니다.'
                };
            }
        } catch (error) {
            if (this.selectedSyncConflict()?.relativePath !== relativePath) return;
            this.syncConflictDetail = {
                relativePath,
                serverError: this.errorMessage(error, '충돌 파일을 읽지 못했습니다.')
            };
        } finally {
            if (this.selectedSyncConflict()?.relativePath === relativePath) {
                this.syncConflictBusy = false;
                this.renderSyncConflictDiffSoon();
                this.requestViewUpdate();
            }
        }
    }

    private syncApi() {
        return (window as any).notedown?.sync;
    }

    private syncPayload(extra: Record<string, unknown> = {}) {
        const settings = this.readSettings();
        return {
            serverUrl: settings.syncServerUrl,
            username: settings.syncUsername,
            token: settings.syncToken,
            clientId: settings.syncClientId,
            storagePath: settings.storagePath,
            ...extra
        };
    }

    private renderSyncConflictDiffSoon(delay = 0) {
        if (this.diffRenderTimeout != null) window.clearTimeout(this.diffRenderTimeout);
        this.diffRenderTimeout = window.setTimeout(() => {
            this.diffRenderTimeout = null;
            this.renderSyncConflictDiff();
        }, delay);
    }

    private renderSyncConflictDiff() {
        if (!this.showSyncConflictViewer()) {
            this.disposeDiffEditor();
            return;
        }

        const monaco = (window as any).monaco;
        const host = document.getElementById('notedown-sync-conflict-diff');
        if (!monaco?.editor || !host) {
            this.syncConflictDiffReady = false;
            return;
        }
        if (host.clientWidth <= 0 || host.clientHeight <= 0) {
            this.syncConflictDiffReady = false;
            this.renderSyncConflictDiffSoon(50);
            return;
        }

        if (!this.diffEditor) {
            this.diffEditor = monaco.editor.createDiffEditor(host, this.createDiffEditorOptions());
        } else {
            this.diffEditor.updateOptions(this.createDiffEditorOptions());
        }

        this.disposeDiffModels();
        this.diffOriginalModel = monaco.editor.createModel(this.syncConflictServerText(), 'markdown');
        this.diffModifiedModel = monaco.editor.createModel(this.syncConflictLocalText(), 'markdown');
        this.diffEditor.setModel({
            original: this.diffOriginalModel,
            modified: this.diffModifiedModel
        });
        this.layoutSyncConflictDiff(host);
        this.syncConflictDiffReady = true;
        window.setTimeout(() => this.layoutSyncConflictDiff(host), 0);
        this.requestViewUpdate();
    }

    private createDiffEditorOptions() {
        const dark = document.documentElement.classList.contains('dark');
        return {
            theme: dark ? 'vs-dark' : 'vs',
            readOnly: true,
            originalEditable: false,
            renderSideBySide: true,
            useInlineViewWhenSpaceIsLimited: false,
            enableSplitViewResizing: true,
            automaticLayout: true,
            ignoreTrimWhitespace: false,
            wordWrap: 'on',
            diffWordWrap: 'on',
            fontFamily: 'SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace',
            fontSize: 13,
            lineHeight: 20,
            minimap: { enabled: false },
            scrollbar: {
                vertical: 'auto',
                horizontal: 'auto',
                alwaysConsumeMouseWheel: false,
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10
            },
            scrollBeyondLastLine: false,
            overviewRulerLanes: 0,
            renderOverviewRuler: false
        };
    }

    private layoutSyncConflictDiff(host = document.getElementById('notedown-sync-conflict-diff')) {
        if (!this.diffEditor || !host) return;
        const width = Math.max(0, Math.floor(host.clientWidth));
        const height = Math.max(0, Math.floor(host.clientHeight));
        if (width > 0 && height > 0) this.diffEditor.layout({ width, height });
    }

    private createHiddenMonacoOptions() {
        return {
            language: 'markdown',
            theme: 'vs',
            readOnly: true,
            minimap: { enabled: false },
            lineNumbers: 'off',
            automaticLayout: false
        };
    }

    private disposeDiffEditor() {
        if (this.diffRenderTimeout != null) {
            window.clearTimeout(this.diffRenderTimeout);
            this.diffRenderTimeout = null;
        }
        if (this.diffEditor) {
            this.diffEditor.setModel?.(null);
            this.diffEditor.dispose?.();
            this.diffEditor = null;
        }
        this.disposeDiffModels();
        this.syncConflictDiffReady = false;
    }

    private disposeDiffModels() {
        this.diffOriginalModel?.dispose?.();
        this.diffModifiedModel?.dispose?.();
        this.diffOriginalModel = null;
        this.diffModifiedModel = null;
    }

    private errorMessage(error: unknown, fallback: string) {
        return error instanceof Error && error.message ? error.message : fallback;
    }

    private storagePath() {
        try {
            const settings = JSON.parse(localStorage.getItem(this.settingsKey) || '{}');
            if (this.isAndroidPlatform()) return settings.storagePath || 'android-default';
            return settings.storagePath || '~/Documents/Notedown Notes';
        } catch (error) {
            return this.isAndroidPlatform() ? 'android-default' : '~/Documents/Notedown Notes';
        }
    }

    private usesFileStorage() {
        return Boolean((window as any).notedown?.storage?.loadNotes);
    }

    private isDefaultSeedCache(notes: NoteItem[]) {
        if (!Array.isArray(notes) || notes.length !== 2) return false;
        const ids = new Set(notes.map(note => note?.id));
        return ids.has('today-note') && ids.has('product-scope');
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
            lineNumbers: 'off',
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
        if (this.isAndroidPlatform()) return 'preview';
        const mode = this.readSettings().editorMode;
        if (mode === 'markdown') return this.normalizeViewModeForPlatform('write');
        if (mode === 'preview') return this.normalizeViewModeForPlatform('preview');
        return this.normalizeViewModeForPlatform('split');
    }

    private normalizeAndroidViewMode() {
        if (this.viewMode !== 'split' || this.canUseSplitMode()) return false;
        this.viewMode = 'write';
        return true;
    }

    private normalizeViewModeForPlatform(mode: ViewMode): ViewMode {
        if (mode === 'split' && !this.canUseSplitMode()) return 'write';
        return mode;
    }

    private canUseSplitMode() {
        if (this.isAndroidPlatform()) return false;
        if (!this.isAndroidPlatform()) return true;
        const width = Math.max(
            Number(window.innerWidth) || 0,
            Number(document.documentElement?.clientWidth) || 0
        );
        return width >= this.androidSplitMinWidth;
    }

    private isAndroidPlatform() {
        const notedownPlatform = String((window as any).notedown?.platform || '').toLowerCase();
        const capacitorPlatform = String((window as any).Capacitor?.getPlatform?.() || '').toLowerCase();
        return notedownPlatform === 'android' || capacitorPlatform === 'android' || /android/i.test(navigator.userAgent || '');
    }

    private readSettings() {
        try {
            return JSON.parse(localStorage.getItem(this.settingsKey) || '{}') || {};
        } catch (error) {
            return {};
        }
    }

    private editorSelectedText() {
        const textarea = this.plainTextEditorElement();
        if (textarea) {
            const start = textarea.selectionStart ?? textarea.value.length;
            const end = textarea.selectionEnd ?? start;
            return textarea.value.slice(Math.min(start, end), Math.max(start, end));
        }

        const selection = this.editor?.getSelection?.();
        const model = this.editor?.getModel?.();
        if (!selection || !model?.getValueInRange) return '';
        return model.getValueInRange(selection) || '';
    }

    private wrapEditorSelection(prefix: string, suffix: string, placeholder: string) {
        const selectedText = this.editorSelectedText();
        const body = selectedText || placeholder;
        this.replaceEditorSelection(`${prefix}${body}${suffix}`, prefix.length + body.length);
    }

    private prefixEditorLines(prefix: string) {
        if (this.prefixPlainEditorLines(prefix)) return;

        const editor = this.editor;
        const model = editor?.getModel?.();
        const selection = editor?.getSelection?.();
        const monaco = (window as any).monaco;
        if (!editor || !model || !selection || !monaco?.Range) {
            this.insertToolbarText(prefix);
            return;
        }

        let endLineNumber = Number(selection.endLineNumber) || Number(selection.startLineNumber) || 1;
        if (Number(selection.endColumn) === 1 && endLineNumber > Number(selection.startLineNumber)) endLineNumber -= 1;
        const startLineNumber = Number(selection.startLineNumber) || endLineNumber;
        const lines: string[] = [];
        for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber += 1) {
            const line = model.getLineContent(lineNumber) || '';
            lines.push(line.startsWith(prefix) ? line : `${prefix}${line}`);
        }

        const range = new monaco.Range(startLineNumber, 1, endLineNumber, model.getLineMaxColumn(endLineNumber));
        this.replaceEditorRange(range, lines.join('\n'), prefix.length);
    }

    private insertToolbarText(text: string) {
        this.replaceEditorSelection(text, text.length);
    }

    private replaceEditorSelection(text: string, cursorOffset = text.length) {
        if (this.replacePlainEditorSelection(text, cursorOffset)) return;

        const selection = this.editor?.getSelection?.();
        const monaco = (window as any).monaco;
        if (!selection || !monaco?.Range) {
            this.appendEditorFallback(text);
            return;
        }
        const range = new monaco.Range(
            selection.startLineNumber,
            selection.startColumn,
            selection.endLineNumber,
            selection.endColumn
        );
        this.replaceEditorRange(range, text, cursorOffset);
    }

    private replaceEditorRange(range: any, text: string, cursorOffset = text.length) {
        const editor = this.editor;
        const model = editor?.getModel?.();
        if (!editor || !model?.getOffsetAt || !model?.getPositionAt) {
            this.appendEditorFallback(text);
            return;
        }

        const startOffset = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
        editor.executeEdits('notedown-markdown-toolbar', [{ range, text, forceMoveMarkers: true }]);
        const cursorPosition = model.getPositionAt(startOffset + Math.max(0, Math.min(cursorOffset, text.length)));
        if (cursorPosition) editor.setPosition(cursorPosition);
        editor.focus?.();
        this.handleBodyChange(model.getValue());
    }

    private plainTextEditorElement() {
        if (!this.usePlainTextEditor()) return null;
        return document.querySelector<HTMLTextAreaElement>('[data-plain-markdown-editor="true"]');
    }

    private replacePlainEditorSelection(text: string, cursorOffset = text.length) {
        const textarea = this.plainTextEditorElement();
        if (!textarea) return false;

        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        const rangeStart = Math.min(start, end);
        const rangeEnd = Math.max(start, end);
        const nextValue = `${textarea.value.slice(0, rangeStart)}${text}${textarea.value.slice(rangeEnd)}`;
        const nextCursor = rangeStart + Math.max(0, Math.min(cursorOffset, text.length));
        textarea.value = nextValue;
        textarea.setSelectionRange(nextCursor, nextCursor);
        textarea.focus();
        this.handleBodyChange(nextValue);
        return true;
    }

    private prefixPlainEditorLines(prefix: string) {
        const textarea = this.plainTextEditorElement();
        if (!textarea) return false;

        const value = textarea.value;
        const selectionStart = textarea.selectionStart ?? value.length;
        const selectionEnd = textarea.selectionEnd ?? selectionStart;
        const rangeStart = Math.min(selectionStart, selectionEnd);
        const rangeEnd = Math.max(selectionStart, selectionEnd);
        const lineStart = value.lastIndexOf('\n', Math.max(0, rangeStart - 1)) + 1;
        const adjustedEnd = rangeEnd > rangeStart && value.charAt(rangeEnd - 1) === '\n' ? rangeEnd - 1 : rangeEnd;
        const nextNewline = value.indexOf('\n', adjustedEnd);
        const lineEnd = nextNewline >= 0 ? nextNewline : value.length;
        const block = value.slice(lineStart, lineEnd);
        const lines = block.split('\n').map(line => line.startsWith(prefix) ? line : `${prefix}${line}`);
        const replacement = lines.join('\n');
        const nextValue = `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`;
        const nextCursor = lineStart + prefix.length;
        textarea.value = nextValue;
        textarea.setSelectionRange(nextCursor, nextCursor);
        textarea.focus();
        this.handleBodyChange(nextValue);
        return true;
    }

    private appendEditorFallback(text: string) {
        const nextBody = `${this.activeNote?.body || ''}${text}`;
        this.handleBodyChange(nextBody);
        this.focusEditorSoon();
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
        this.editor.addAction({
            id: 'notedown-save-note',
            label: 'Save note',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
            run: () => {
                void this.saveNow(true);
            }
        });
        this.attachmentCommandId = this.editor.addCommand(0, (_accessor: any, mode: AttachmentPickerMode, anchor?: EditorCursorPosition) => {
            this.openAttachmentPicker(mode === 'image' ? 'image' : 'file', anchor);
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
                const visiblePosition = this.editor?.getScrolledVisiblePosition?.(position);

                const blocks = [
                    { ko: '파일', en: 'File', aliases: 'f file attachment attach document', insertText: '', detail: 'Insert attached file link', mode: 'file' as AttachmentPickerMode },
                    { ko: '이미지', en: 'Image', aliases: 'i img image picture photo attachment', insertText: '', detail: 'Insert attached image', mode: 'image' as AttachmentPickerMode },
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
                        insertTextRules: block.mode ? undefined : monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        command: block.mode && this.attachmentCommandId
                            ? {
                                id: this.attachmentCommandId,
                                title: block.detail,
                                arguments: [block.mode, {
                                    lineNumber: position.lineNumber,
                                    column: position.column,
                                    visualLeft: visiblePosition?.left,
                                    visualTop: visiblePosition?.top,
                                    visualHeight: visiblePosition?.height
                                }]
                            }
                            : undefined,
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
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
html { width: 100%; }
body {
    margin: 0;
    min-width: 0;
    color: #1c1917;
    background: #ffffff;
    font-family: SUIT, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 1.65;
}
@media screen {
    body {
        width: 595px;
        min-height: 842px;
        padding: 51px 45px;
    }
}
@media print {
    body {
        width: auto;
        min-height: 0;
        padding: 0;
    }
}
main { width: 100%; max-width: 100%; margin: 0 auto; }
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
.content :where(img, svg, video, canvas) {
    display: block;
    max-width: 100% !important;
    height: auto !important;
    margin: 0.75em auto;
    object-fit: contain;
    page-break-inside: avoid;
    break-inside: avoid;
}
.content ul, .content ol { margin: 0.45em 0 0.45em 1.25em; padding: 0; }
.content .notedown-task-list { margin-left: 0; padding-left: 0; }
.content .task-list-item { display: flex; align-items: center; gap: 8px; margin: 0.2em 0; list-style: none; }
.content .task-list-item input[type="checkbox"] { flex: 0 0 auto; width: 1rem; height: 1rem; margin: 0 !important; accent-color: #2563eb; }
.content blockquote { margin: 0.65em 0; padding: 0.1em 0 0.1em 0.9em; border-left: 3px solid #d6d3d1; color: #57534e; font-style: normal; }
.content blockquote p { margin: 0.15em 0; }
.content pre {
    margin: 0.9em 0;
    padding: 12px;
    max-width: 100%;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    border-radius: 0;
    background: #f5f5f4;
}
.content code {
    font-family: SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, monospace;
    font-size: 0.92em;
}
.content table { width: 100%; max-width: 100%; border-collapse: collapse; margin: 0.9em 0; font-size: 0.95em; line-height: 1.45; table-layout: fixed; }
.content th, .content td { border: 1px solid #e7e5e4; padding: 6px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
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
            chunks.push(this.renderMarkdownHtml(markdownLines.join('\n'), true, true));
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

                    const html = this.renderPreviewMarkdownLines(tableLines);
                    const lineEnd = tableLines[tableLines.length - 1].lineIndex;
                    blocks.push(this.withSectionStyle({
                        type: 'markdown',
                        lineIndex: lines[tableStartLine].lineIndex,
                        lineEnd,
                        variant: 'table',
                        html: this.sanitizer.bypassSecurityTrustHtml(html)
                    }, sourceLine.section));
                    continue;
                }

                if (this.isMarkdownListLine(sourceLine.text)) {
                    const listStartLine = index;
                    const listLines: StyledMarkdownLine[] = [];
                    while (index < lines.length && this.isMarkdownListBlockLine(lines, index, sourceLine.section)) {
                        listLines.push(lines[index]);
                        index++;
                    }
                    index--;

                    const html = this.renderPreviewMarkdownLines(listLines, true);
                    blocks.push(this.withSectionStyle({
                        type: 'markdown',
                        lineIndex: lines[listStartLine].lineIndex,
                        lineEnd: listLines[listLines.length - 1].lineIndex,
                        variant: 'list',
                        html: this.sanitizer.bypassSecurityTrustHtml(html)
                    }, sourceLine.section));
                    continue;
                }

                const html = this.renderPreviewMarkdownLines([sourceLine]);
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

    private renderPreviewMarkdownLines(lines: StyledMarkdownLine[], normalizeListIndent = false) {
        const html = this.renderMarkdownHtml(lines.map(line => line.text).join('\n'), normalizeListIndent);
        return this.decoratePreviewTaskListHtml(html, lines);
    }

    private renderMarkdownHtml(markdown: string, normalizeListIndent = false, pdfExport = false) {
        const prepared = normalizeListIndent ? this.normalizeMarkdownListIndent(markdown) : markdown;
        return this.addLinkTargets(this.converter.makeHtml(prepared), pdfExport);
    }

    private normalizeMarkdownListIndent(markdown: string) {
        const tabSize = this.editorTabSize();
        const sourceLines = markdown.split('\n');
        let inCodeFence = false;
        let inListBlock = false;

        return sourceLines.map(line => {
            const trimmed = line.trim();
            if (/^```/.test(trimmed)) {
                inCodeFence = !inCodeFence;
                inListBlock = false;
                return line;
            }

            if (inCodeFence || trimmed === '') {
                if (trimmed === '') inListBlock = false;
                return line;
            }

            const listIndent = this.markdownListIndent(line);
            if (listIndent !== null) {
                inListBlock = true;
                return this.normalizeMarkdownIndent(line, listIndent, tabSize);
            }

            if (inListBlock) {
                const continuationIndent = this.markdownIndentedContinuationIndent(line);
                if (continuationIndent !== null) {
                    return this.normalizeMarkdownIndent(line, continuationIndent, tabSize);
                }
            }

            inListBlock = false;
            return line;
        }).join('\n');
    }

    private normalizeMarkdownIndent(line: string, indent: string, tabSize: number) {
        const columns = this.leadingIndentColumns(indent, tabSize);
        const depth = Math.max(0, Math.floor(columns / tabSize));
        return `${' '.repeat(depth * 4)}${line.slice(indent.length)}`;
    }

    private leadingIndentColumns(indent: string, tabSize: number) {
        let columns = 0;
        for (const char of indent) {
            if (char === '\t') {
                const remainder = columns % tabSize;
                columns += remainder === 0 ? tabSize : tabSize - remainder;
            } else {
                columns++;
            }
        }
        return columns;
    }

    private markdownListIndent(line: string) {
        return /^([\t ]*)(?:[-*+]|\d+[.)])[\t ]+/.exec(line)?.[1] ?? null;
    }

    private markdownIndentedContinuationIndent(line: string) {
        return /^([\t ]{2,})\S/.exec(line)?.[1] ?? null;
    }

    private isMarkdownListBlockLine(lines: StyledMarkdownLine[], index: number, section?: DocumentSectionStyle) {
        const line = lines[index];
        if (!line || !this.sameDocumentSection(line.section, section)) return false;
        if (line.text.trim() === '') return false;
        if (this.isDividerLine(line.text) || this.isMarkdownTableStart(lines, index)) return false;
        if (this.isMarkdownListLine(line.text)) return true;
        return /^[\t ]{2,}\S/.test(line.text);
    }

    private sameDocumentSection(left?: DocumentSectionStyle, right?: DocumentSectionStyle) {
        return (left?.id || 0) === (right?.id || 0);
    }

    private isMarkdownListLine(line: string) {
        return /^[\t ]*(?:[-*+]|\d+[.)])[\t ]+/.test(line);
    }

    private decoratePreviewTaskListHtml(html: string, lines: StyledMarkdownLine[]) {
        const taskLines = lines.filter(line => this.markdownTaskLine(line.text));
        if (taskLines.length === 0 || typeof document === 'undefined') return html;

        const previewDocument = document.implementation.createHTMLDocument('notedown-preview');
        previewDocument.body.innerHTML = html;
        const taskItems = Array.from(previewDocument.body.querySelectorAll('li.task-list-item'));

        taskItems.forEach((item, index) => {
            const sourceLine = taskLines[index];
            if (!sourceLine) return;

            const lineIndex = String(sourceLine.lineIndex);
            item.setAttribute('data-task-line', lineIndex);

            const input = item.querySelector('input[type="checkbox"]');
            if (!input) return;

            input.removeAttribute('disabled');
            input.setAttribute('data-task-line', lineIndex);
            input.setAttribute('aria-label', this.markdownTaskLineLabel(sourceLine.text));
        });

        return previewDocument.body.innerHTML;
    }

    private markdownTaskLine(line: string) {
        return /^[\t ]*(?:[-*+]|\d+[.)])[\t ]+\[[ xX]\][\t ]+(.+)$/.exec(line);
    }

    private markdownTaskLineLabel(line: string) {
        return this.markdownTaskLine(line)?.[1] || 'Task';
    }

    private markdownCellVariant(line: string): PreviewBlock['variant'] {
        if (/^[\t ]*(?:[-*+]|\d+[.)])[\t ]+\[[ xX]\][\t ]+/.test(line)) return 'task';
        if (/^\s{0,3}#{1,6}\s+/.test(line)) return 'heading';
        if (/^[\t ]*(?:[-*+]|\d+[.)])[\t ]+/.test(line)) return 'list';
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

    private toggleTaskLine(lineIndex: number, checked: boolean) {
        if (!this.activeNote?.id) return;
        const lines = this.activeNote.body.split('\n');
        if (!lines[lineIndex]) return;

        lines[lineIndex] = lines[lineIndex].replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)[ xX](\]\s+)/, `$1${checked ? 'x' : ' '}$2`);
        this.activeNote.body = lines.join('\n');
        this.touchNote();
    }

    private isTaskLineChecked(lineIndex: number) {
        const line = this.activeNote?.body.split('\n')[lineIndex] || '';
        const task = /^[\t ]*(?:[-*+]|\d+[.)])[\t ]+\[([ xX])\][\t ]+/.exec(line);
        return task ? task[1].toLowerCase() === 'x' : false;
    }

    private addLinkTargets(html: string, pdfExport = false) {
        return this.rewriteAttachmentImageSources(html, pdfExport).replace(/<a\s+([^>]*href=["'][^"']+["'][^>]*)>/gi, (match, attributes) => {
            if (/target=/i.test(attributes)) return match;
            return `<a ${attributes} target="_blank" rel="noopener noreferrer">`;
        });
    }

    private rewriteAttachmentImageSources(html: string, pdfExport = false) {
        return html.replace(/\ssrc=(["'])([^"']+)\1/gi, (match, quote, rawPath) => {
            const attachment = this.attachmentForMarkdownPath(rawPath);
            if (!attachment) return match;
            const fileUrl = this.attachmentFileUrl(attachment.relativePath, pdfExport);
            return fileUrl ? ` src=${quote}${fileUrl}${quote}` : match;
        });
    }

    private attachmentForMarkdownPath(value: string) {
        const normalized = this.normalizeMarkdownAttachmentPath(value);
        if (!normalized) return null;
        return this.noteAttachments().find(attachment => attachment.relativePath === normalized) || null;
    }

    private normalizeMarkdownAttachmentPath(value: string) {
        const raw = String(value || '').trim();
        if (!raw || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(raw)) return '';
        try {
            return decodeURIComponent(raw).replace(/^\/+/g, '');
        } catch (error) {
            return raw.replace(/^\/+/g, '');
        }
    }

    private attachmentFileUrl(relativePath: string, pdfExport = false) {
        const storagePath = this.storagePath();
        if (!storagePath || !relativePath) return '';
        if (this.isAndroidPlatform()) {
            const cache = pdfExport ? this.attachmentPdfDataUrlCache : this.attachmentDataUrlCache;
            const cached = cache.get(relativePath);
            if (cached) return cached;
            const attachment = this.noteAttachments().find(item => item.relativePath === relativePath);
            if (attachment && this.isImageAttachment(attachment)) {
                void this.loadAndroidAttachmentDataUrl(attachment, !pdfExport, pdfExport);
            }
            return '';
        }
        const params = new URLSearchParams({
            storagePath,
            relativePath
        });
        return `notedown-attachment://file?${params.toString()}`;
    }

    private async preloadAndroidAttachmentDataUrls(attachments = this.noteAttachments(), pdfExport = false) {
        if (!this.isAndroidPlatform()) return;
        for (const attachment of attachments) {
            if (!this.isImageAttachment(attachment)) continue;
            await this.loadAndroidAttachmentDataUrl(attachment, false, pdfExport);
        }
    }

    private async loadAndroidAttachmentDataUrl(attachment: NoteAttachment, refreshAfterLoad = true, pdfExport = false) {
        const relativePath = attachment?.relativePath || '';
        const cache = pdfExport ? this.attachmentPdfDataUrlCache : this.attachmentDataUrlCache;
        const loadingKey = `${pdfExport ? 'pdf' : 'preview'}:${relativePath}`;
        if (!relativePath || cache.has(relativePath) || this.attachmentDataUrlLoading.has(loadingKey)) {
            return cache.get(relativePath) || '';
        }

        const api = (window as any).notedown?.storage;
        const storagePath = this.storagePath();
        if (!api?.readFile || !storagePath) return '';

        this.attachmentDataUrlLoading.add(loadingKey);
        try {
            const result = await api.readFile({ storagePath, relativePath });
            const contentBase64 = String(result?.contentBase64 || '');
            if (!result?.ok || !contentBase64) return '';
            const mimeType = result.mimeType || attachment.mimeType || this.mimeTypeFromName(attachment.fileName || relativePath);
            const rawDataUrl = `data:${mimeType || 'application/octet-stream'};base64,${contentBase64}`;
            const dataUrl = pdfExport
                ? await this.compactImageDataUrlForPdf(rawDataUrl, mimeType)
                : rawDataUrl;
            cache.set(relativePath, dataUrl);
            if (refreshAfterLoad && !pdfExport) {
                this.refreshPreview();
                this.requestViewUpdate();
            }
            return dataUrl;
        } catch (error) {
            return '';
        } finally {
            this.attachmentDataUrlLoading.delete(loadingKey);
        }
    }

    private async compactImageDataUrlForPdf(dataUrl: string, mimeType = '') {
        const lowerMimeType = String(mimeType || '').toLowerCase();
        if (!lowerMimeType.startsWith('image/') || lowerMimeType.includes('svg')) return dataUrl;

        try {
            const image = await this.loadImageElement(dataUrl);
            const maxWidth = 1400;
            const maxHeight = 2000;
            const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
            if (!Number.isFinite(scale) || scale >= 0.98) return dataUrl;

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext('2d');
            if (!context) return dataUrl;
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', 0.86);
        } catch (error) {
            return dataUrl;
        }
    }

    private loadImageElement(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('이미지를 PDF용으로 처리하지 못했습니다.'));
            image.src = src;
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

    private focusEditorSoon(position: 'default' | 'first-line-end' = 'default') {
        if (this.showSyncConflictViewer()) return;
        if (!this.hasSelectedNote) return;
        if (this.isAndroidPlatform()) return;
        window.setTimeout(() => {
            if (this.viewMode === 'preview') return;
            const offset = position === 'first-line-end' ? this.firstLineEndOffset() : null;
            const textarea = this.plainTextEditorElement();
            if (textarea) {
                textarea.focus();
                if (offset != null) textarea.setSelectionRange(offset, offset);
                return;
            }
            if (this.editor && this.viewMode !== 'preview') {
                if (offset != null) {
                    const column = offset + 1;
                    this.editor.setPosition?.({ lineNumber: 1, column });
                    this.editor.revealPositionInCenterIfOutsideViewport?.({ lineNumber: 1, column });
                }
                this.editor.focus();
            }
        }, 0);
    }

    private firstLineEndOffset() {
        return (this.activeNote?.body || '').split('\n')[0]?.length || 0;
    }

    private shouldFocusFirstLineEnd(note: NoteItem) {
        return note.status === 'draft'
            && (note.title || '') === '새 노트'
            && (note.body || '').startsWith('# 새 노트');
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
                attachments: [],
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
                attachments: [],
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
            attachments: [],
            body: ''
        };
    }

    private newNoteFolder() {
        const activeFolder = localStorage.getItem(this.activeWorkspaceKey) || 'memo';
        return activeFolder && activeFolder !== 'all' ? activeFolder : 'memo';
    }

    private workspaceLabel(folder: string) {
        return this.readStoredFolders().find(item => item.id === folder)?.label || this.defaultWorkspaceLabel(folder);
    }

    private readStoredFolders(): Array<{ id: string; label: string }> {
        try {
            const stored = JSON.parse(localStorage.getItem(this.foldersKey) || '[]');
            if (!Array.isArray(stored)) return [];
            return stored
                .map(folder => ({
                    id: String(folder?.id || '').trim(),
                    label: String(folder?.label || '').replace(/\s+/g, ' ').trim()
                }))
                .filter(folder => folder.id && folder.id !== 'all' && folder.label);
        } catch (error) {
            return [];
        }
    }

    private defaultWorkspaceLabel(folder: string) {
        if (folder === 'memo') return '메모';
        if (folder === 'blog') return '블로그';
        if (folder === 'project') return '프로젝트';
        if (folder === 'unfiled') return '미지정 워크스페이스';
        if (folder === '_imported') return '가져온 문서';
        return folder;
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
            titleManuallyEdited: Boolean(note?.titleManuallyEdited),
            attachments: Array.isArray(note?.attachments)
                ? note.attachments.map((attachment: any) => this.normalizeAttachment(attachment, note?.relativePath || '')).filter((attachment: NoteAttachment) => attachment.relativePath && !attachment.deleted)
                : [],
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
