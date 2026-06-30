import { ChangeDetectorRef, HostListener, OnDestroy, OnInit } from '@angular/core';

type SortField = 'createdAt' | 'updatedAt' | 'title';
type SortDirection = 'asc' | 'desc';
type SyncStatusTone = 'idle' | 'running' | 'success' | 'warning' | 'error';

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
    attachments?: any[];
}

interface FolderItem {
    id: string;
    label: string;
}

interface SortOption {
    value: string;
    label: string;
}

export class Component implements OnInit, OnDestroy {
    private storageKey = 'notedown.notes.v1';
    private activeNoteKey = 'notedown.activeNoteId.v1';
    private activeWorkspaceKey = 'notedown.activeWorkspace.v1';
    private foldersKey = 'notedown.folders.v1';
    private sortKey = 'notedown.sidebar.sort.v1';
    private settingsKey = 'notedown.settings.v1';
    private startupSyncResultKey = 'notedown.sync.startup.result.v1';
    private syncStatusHideTimeout: number | null = null;

    public query = '';
    public searchOpen = false;
    public sortOpen = false;
    public activeFolder = 'all';
    public activeNoteId = '';
    public workspaceOpen = true;
    public editingFolderId = '';
    public folderNameDraft = '';
    public folderContextMenuOpen = false;
    public folderContextFolderId = '';
    public folderContextMenuStyle: Record<string, string> = { left: '0px', top: '0px' };
    public folderExportBusy = false;
    public sortField: SortField = 'updatedAt';
    public sortDirection: SortDirection = 'desc';
    public sortOptions: SortOption[] = [
        { value: 'updatedAt:desc', label: '수정일 최신순' },
        { value: 'updatedAt:asc', label: '수정일 오래된순' },
        { value: 'createdAt:desc', label: '생성일 최신순' },
        { value: 'createdAt:asc', label: '생성일 오래된순' },
        { value: 'title:asc', label: '제목 오름차순' },
        { value: 'title:desc', label: '제목 내림차순' }
    ];
    public folders: FolderItem[] = [{ id: 'all', label: '모든 노트' }];
    public notes: NoteItem[] = [];
    public syncStatusVisible = false;
    public syncStatusLabel = '';
    public syncStatusDetail = '';
    public syncStatusTone: SyncStatusTone = 'idle';

    private handleNotesChanged = () => { void this.loadNotes().then(() => this.renderSoon()); };
    private handleNoteTitleChanged = (event: Event) => {
        const detail = (event as CustomEvent<{ noteId?: string; title?: string }>).detail || {};
        if (!detail.noteId) return;

        const title = String(detail.title || '').trim() || '제목 없음';
        const index = this.notes.findIndex(note => note.id === detail.noteId);
        if (index < 0 || this.notes[index].title === title) return;

        this.notes[index] = { ...this.notes[index], title };
        this.renderSoon();
    };
    private handleSelectNote = (event: Event) => {
        const noteId = (event as CustomEvent<string>).detail;
        if (!noteId) return;
        this.activeNoteId = noteId;
        localStorage.setItem(this.activeNoteKey, noteId);
        const note = this.notes.find(item => item.id === noteId);
        const noteFolder = note ? note.folder || 'memo' : '';
        if (noteFolder && this.activeFolder !== 'all' && this.activeFolder !== noteFolder) {
            this.activeFolder = noteFolder;
            localStorage.setItem(this.activeWorkspaceKey, this.activeFolder);
        }
        this.renderSoon();
    };
    private handleStartupSyncStatus = () => {
        this.loadStartupSyncStatus();
        this.renderSoon();
    };
    private handleSaveSyncStatus = (event: Event) => {
        const detail = (event as CustomEvent<any>).detail || {};
        this.showSaveSyncStatus(detail);
    };
    private handleWorkspaceChanged = (event: Event) => {
        const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId;
        if (!workspaceId) return;
        this.activeFolder = workspaceId;
        localStorage.setItem(this.activeWorkspaceKey, workspaceId);
        this.renderSoon();
    };
    private handleStorageChanged = (event: StorageEvent) => {
        if (event.key === this.startupSyncResultKey || event.key === this.settingsKey) this.loadStartupSyncStatus();
        if (event.key === this.activeWorkspaceKey) {
            this.activeFolder = localStorage.getItem(this.activeWorkspaceKey) || 'all';
        }
        if (event.key === this.sortKey) this.loadSortPreference();
        this.renderSoon();
    };

    constructor(private ref: ChangeDetectorRef) { }

    public ngOnInit() {
        this.activeFolder = localStorage.getItem(this.activeWorkspaceKey) || this.activeFolder;
        this.loadSortPreference();
        this.workspaceOpen = true;
        this.emitWorkspaceState(true);
        this.loadStartupSyncStatus();
        void this.loadNotes().then(() => this.renderSoon());
        window.addEventListener('notedown:notes-changed', this.handleNotesChanged);
        window.addEventListener('notedown:note-title-changed', this.handleNoteTitleChanged);
        window.addEventListener('notedown:select-note', this.handleSelectNote);
        window.addEventListener('notedown:startup-sync-status', this.handleStartupSyncStatus);
        window.addEventListener('notedown:save-sync-status', this.handleSaveSyncStatus);
        window.addEventListener('notedown:workspace-changed', this.handleWorkspaceChanged);
        window.addEventListener('storage', this.handleStorageChanged);
    }

    public ngOnDestroy() {
        window.removeEventListener('notedown:notes-changed', this.handleNotesChanged);
        window.removeEventListener('notedown:note-title-changed', this.handleNoteTitleChanged);
        window.removeEventListener('notedown:select-note', this.handleSelectNote);
        window.removeEventListener('notedown:startup-sync-status', this.handleStartupSyncStatus);
        window.removeEventListener('notedown:save-sync-status', this.handleSaveSyncStatus);
        window.removeEventListener('notedown:workspace-changed', this.handleWorkspaceChanged);
        window.removeEventListener('storage', this.handleStorageChanged);
        this.clearSyncStatusTimer();
    }

    public get activeFolderLabel() {
        return this.folders.find(folder => folder.id === this.activeFolder)?.label || '노트';
    }

    public get sortValue() {
        return `${this.sortField}:${this.sortDirection}`;
    }

    public get currentSortLabel() {
        return this.sortOptions.find(option => option.value === this.sortValue)?.label || '정렬';
    }

    public get visibleNotes() {
        let list = this.notes;
        if (this.activeFolder !== 'all') {
            list = list.filter(note => (note.folder || 'memo') === this.activeFolder);
        }

        const keyword = this.query.trim().toLowerCase();
        if (keyword) {
            list = list.filter(note => {
                return note.title.toLowerCase().includes(keyword)
                    || note.body.toLowerCase().includes(keyword)
                    || note.tags.join(' ').toLowerCase().includes(keyword);
            });
        }

        return this.sortNotes(list);
    }

    public folderCount(folder: string) {
        if (folder === 'all') return this.notes.length;
        return this.notes.filter(note => (note.folder || 'memo') === folder).length;
    }

    public selectFolder(folder: string) {
        this.activeFolder = folder;
        localStorage.setItem(this.activeWorkspaceKey, folder);
        window.dispatchEvent(new CustomEvent('notedown:workspace-changed', { detail: { workspaceId: folder } }));
        const first = this.visibleNotes[0];
        if (first) {
            this.selectNote(first.id);
            return;
        }

        this.activeNoteId = '';
        localStorage.removeItem(this.activeNoteKey);
        window.dispatchEvent(new CustomEvent('notedown:select-note', { detail: '' }));
        this.renderSoon();
    }

    public selectNote(id: string) {
        this.activeNoteId = id;
        localStorage.setItem(this.activeNoteKey, id);
        window.dispatchEvent(new CustomEvent('notedown:select-note', { detail: id }));
    }

    public createFolder(event?: Event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const label = this.nextFolderLabel();
        const folder: FolderItem = {
            id: this.uniqueFolderId(this.folderIdFromLabel(label)),
            label
        };
        this.saveStoredFolders([...this.readStoredFolders(), folder]);
        this.syncFolders();
        this.selectFolder(folder.id);
        this.editingFolderId = folder.id;
        this.folderNameDraft = folder.label;
        window.dispatchEvent(new CustomEvent('notedown:notes-changed', { detail: { source: 'component.nav.sidebar', foldersChanged: true } }));
        this.renderSoon(() => this.focusFolderNameInput(folder.id));
        window.setTimeout(() => {
            if (this.editingFolderId !== folder.id) this.startFolderRename(folder.id);
            else this.focusFolderNameInput(folder.id);
        }, 80);
    }

    public startFolderRename(folderId: string, event?: Event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!folderId || folderId === 'all') return;

        const folder = this.folders.find(item => item.id === folderId);
        if (!folder) return;

        this.editingFolderId = folderId;
        this.folderNameDraft = folder.label;
        this.closeFolderContextMenu();
        this.renderSoon(() => this.focusFolderNameInput(folderId));
    }

    public cancelFolderRename() {
        this.editingFolderId = '';
        this.folderNameDraft = '';
        this.renderSoon();
    }

    public async commitFolderRename(folderId: string) {
        if (this.editingFolderId !== folderId || folderId === 'all') return;

        const current = this.folders.find(folder => folder.id === folderId);
        const nextLabel = this.uniqueFolderLabel(this.normalizeFolderLabel(this.folderNameDraft), folderId);
        const wasActive = this.activeFolder === folderId;
        this.editingFolderId = '';
        this.folderNameDraft = '';

        if (!current || !nextLabel || current.label === nextLabel) {
            this.renderSoon();
            return;
        }

        const storedFolders = this.readStoredFolders();
        const nextStoredFolders = storedFolders.some(folder => folder.id === folderId)
            ? storedFolders.map(folder => folder.id === folderId ? { ...folder, label: nextLabel } : folder)
            : [...storedFolders, { id: folderId, label: nextLabel }];
        this.saveStoredFolders(nextStoredFolders);
        this.notes = this.notes.map(note => (note.folder || 'memo') === folderId ? { ...note, workspaceName: nextLabel } : note);
        this.syncFolders();
        await this.persistNotes();
        window.dispatchEvent(new CustomEvent('notedown:notes-changed', { detail: { source: 'component.nav.sidebar', foldersChanged: true } }));
        if (wasActive) window.dispatchEvent(new CustomEvent('notedown:workspace-changed', { detail: { workspaceId: folderId } }));
        this.renderSoon();
    }

    public openFolderContextMenu(folderId: string, event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (!folderId || folderId === 'all') return;

        this.folderContextFolderId = folderId;
        this.folderContextMenuOpen = true;
        this.folderContextMenuStyle = {
            left: `${Math.min(event.clientX, window.innerWidth - 188)}px`,
            top: `${Math.min(event.clientY, window.innerHeight - 136)}px`
        };
        this.renderSoon();
    }

    public closeFolderContextMenu() {
        if (!this.folderContextMenuOpen) return;
        this.folderContextMenuOpen = false;
        this.folderContextFolderId = '';
        this.renderSoon();
    }

    public async deleteFolder(folderId: string, event?: Event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!folderId || folderId === 'all') return;

        const folder = this.folders.find(item => item.id === folderId);
        if (!folder) return;

        const notesToDelete = this.notes.filter(note => (note.folder || 'memo') === folderId);
        const countLabel = notesToDelete.length > 0 ? `와 노트 ${notesToDelete.length}개` : '';
        const confirmed = window.confirm(`'${folder.label}' 폴더${countLabel}를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`);
        if (!confirmed) return;

        const deletedActiveNote = notesToDelete.some(note => note.id === this.activeNoteId);
        this.closeFolderContextMenu();
        this.saveStoredFolders(this.readStoredFolders().filter(item => item.id !== folderId));
        this.notes = this.notes.filter(note => (note.folder || 'memo') !== folderId);
        if (this.activeFolder === folderId) {
            this.activeFolder = 'all';
            localStorage.setItem(this.activeWorkspaceKey, this.activeFolder);
            window.dispatchEvent(new CustomEvent('notedown:workspace-changed', { detail: { workspaceId: this.activeFolder } }));
        }
        this.syncFolders();
        await this.persistNotes();
        await Promise.all(notesToDelete.map(note => this.syncNoteWithServer(note, true)));

        const nextNote = deletedActiveNote ? (this.visibleNotes[0] || this.notes[0]) : null;
        if (nextNote) {
            this.activeNoteId = nextNote.id;
            localStorage.setItem(this.activeNoteKey, nextNote.id);
        } else if (deletedActiveNote) {
            this.activeNoteId = '';
            localStorage.removeItem(this.activeNoteKey);
        }

        window.dispatchEvent(new CustomEvent('notedown:notes-changed', { detail: { source: 'component.nav.sidebar', foldersChanged: true } }));
        if (deletedActiveNote) {
            window.dispatchEvent(new CustomEvent('notedown:select-note', { detail: nextNote?.id || '' }));
        }
        this.renderSoon();
    }

    public async exportFolderZip(folderId: string, event?: Event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (!folderId || folderId === 'all' || this.folderExportBusy) return;

        const folder = this.folders.find(item => item.id === folderId);
        if (!folder) return;

        const api = (window as any).notedown?.storage;
        const storagePath = this.storagePath();
        if (!api?.exportFolderZip || !storagePath) {
            window.alert('폴더 ZIP 내보내기는 Electron 저장소에서 사용할 수 있습니다.');
            this.closeFolderContextMenu();
            return;
        }

        this.folderExportBusy = true;
        this.renderSoon();
        try {
            const result = await api.exportFolderZip({
                storagePath,
                folderId,
                folderLabel: folder.label,
                notes: this.notes.filter(note => (note.folder || 'memo') === folderId)
            });
            if (!result?.ok && !result?.canceled) {
                window.alert(result?.error || '폴더 ZIP 내보내기에 실패했습니다.');
            }
        } catch (error) {
            window.alert(error instanceof Error ? error.message : '폴더 ZIP 내보내기에 실패했습니다.');
        } finally {
            this.folderExportBusy = false;
            this.closeFolderContextMenu();
            this.renderSoon();
        }
    }

    public async createNote() {
        const now = Date.now();
        const note: NoteItem = {
            id: `note-${now}`,
            icon: 'N',
            title: '새 노트',
            body: '# 새 노트\n\n',
            tags: ['draft'],
            status: 'draft',
            folder: this.activeFolder === 'all' ? 'memo' : this.activeFolder,
            workspaceName: this.activeFolder === 'all' ? '메모' : this.activeFolderLabel,
            createdAt: this.nowLabel(new Date(now)),
            createdAtMs: now,
            updatedAt: this.nowLabel(new Date(now)),
            updatedAtMs: now,
            attachments: []
        };
        this.notes = [note, ...this.notes];
        this.activeNoteId = note.id;
        localStorage.setItem(this.activeNoteKey, note.id);
        this.syncFolders();
        await this.persistNotes();
        window.dispatchEvent(new CustomEvent('notedown:notes-changed', { detail: { source: 'component.nav.sidebar' } }));
        this.renderSoon();
    }

    public async deleteNote(id: string, event?: Event) {
        if (event) event.stopPropagation();

        const index = this.notes.findIndex(note => note.id === id);
        if (index < 0) return;

        const note = this.notes[index];
        if (this.hasMeaningfulBody(note)) {
            const confirmed = window.confirm(`'${note.title || '제목 없음'}' 문서를 삭제할까요?`);
            if (!confirmed) return;
        }

        const wasActive = this.activeNoteId === id;
        this.notes = this.notes.filter(item => item.id !== id);
        this.syncFolders();
        await this.persistNotes();
        await this.syncNoteWithServer(note, true);

        if (!wasActive) {
            window.dispatchEvent(new CustomEvent('notedown:notes-changed'));
            return;
        }

        const nextNote = this.visibleNotes[0] || this.notes[0];
        this.activeNoteId = nextNote?.id || '';

        if (this.activeNoteId) {
            localStorage.setItem(this.activeNoteKey, this.activeNoteId);
        } else {
            localStorage.removeItem(this.activeNoteKey);
        }

        window.dispatchEvent(new CustomEvent('notedown:notes-changed'));
        if (nextNote) {
            window.dispatchEvent(new CustomEvent('notedown:select-note', { detail: nextNote.id }));
        }
    }

    public toggleWorkspace(event?: Event) {
        if (event) event.stopPropagation();
        this.workspaceOpen = !this.workspaceOpen;
        this.emitWorkspaceState(this.workspaceOpen);
    }

    public closeWorkspace() {
        if (!this.workspaceOpen) return;
        this.workspaceOpen = false;
        this.emitWorkspaceState(false);
    }

    public toggleSearch() {
        this.sortOpen = false;
        this.searchOpen = !this.searchOpen;
        if (!this.searchOpen) this.query = '';
    }

    public toggleSort(event?: Event) {
        if (event) event.stopPropagation();
        this.sortOpen = !this.sortOpen;
    }

    public selectSort(value: string) {
        this.setSortValue(value);
        this.sortOpen = false;
    }

    public setSortValue(value: string) {
        const [field, direction] = value.split(':') as [SortField, SortDirection];
        if (!['createdAt', 'updatedAt', 'title'].includes(field)) return;
        if (!['asc', 'desc'].includes(direction)) return;
        this.sortField = field;
        this.sortDirection = direction;
        localStorage.setItem(this.sortKey, this.sortValue);
    }

    public noteSummary(note: NoteItem) {
        return note.body
            .split('\n')
            .map(line => line.replace(/^#+\s*/, '').trim())
            .filter(line => line && line !== note.title)[0] || 'Markdown 노트';
    }

    public taskProgress(note: NoteItem) {
        const stats = this.taskStats(note);
        if (stats.total === 0) return null;
        return Math.round((stats.done / stats.total) * 100);
    }

    public workspacePanelClass() {
        return 'flex h-full w-[236px] shrink-0 flex-col border-r border-stone-300/70 bg-[#e8e6e1] px-3 pb-3 pt-3 transition-[width,opacity] duration-200 dark:border-zinc-800 dark:bg-zinc-900';
    }

    public folderRowClass(folder: string) {
        const base = 'group flex h-9 w-full min-w-0 items-center rounded-md transition-colors';
        if (this.activeFolder === folder) return `${base} bg-white/80 text-stone-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50`;
        return `${base} text-stone-600 hover:bg-white/55 hover:text-stone-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public folderSelectButtonClass(folder: string) {
        return 'flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-[13px] font-medium';
    }

    public folderEditButtonClass(folder: string) {
        const base = 'app-no-drag flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100';
        if (this.activeFolder === folder) return `${base} text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-50`;
        return `${base} text-stone-400 hover:bg-white/60 hover:text-stone-950 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public folderCountClass(folder: string) {
        return 'shrink-0 pr-3 text-[12px] text-stone-400 dark:text-zinc-500';
    }

    public noteRowClass(id: string) {
        const base = 'group flex h-8 items-center rounded-md transition-colors';
        if (this.activeNoteId === id) return `${base} bg-[#ffe99a] text-stone-950 shadow-sm dark:bg-amber-400/85 dark:text-zinc-950`;
        return `${base} text-stone-700 hover:bg-white/70 dark:text-zinc-300 dark:hover:bg-zinc-800`;
    }

    public noteTitleButtonClass(id: string) {
        return 'flex h-full min-w-0 flex-1 items-center truncate px-2.5 text-left text-[13px] font-medium leading-5';
    }

    public deleteButtonClass(id: string) {
        const base = 'mr-1 flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 transition group-hover:opacity-100 focus:opacity-100';
        if (this.activeNoteId === id) return `${base} text-stone-700 hover:bg-amber-200/70 hover:text-stone-950 dark:text-zinc-950 dark:hover:bg-amber-300/50`;
        return `${base} text-stone-400 hover:bg-stone-200/80 hover:text-stone-900 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-100`;
    }

    public searchButtonClass() {
        const base = 'flex size-7 shrink-0 items-center justify-center rounded-md transition';
        if (this.searchOpen) return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} text-stone-500 hover:bg-stone-200/70 hover:text-stone-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public sortButtonClass() {
        const base = 'flex size-7 shrink-0 items-center justify-center rounded-md transition';
        if (this.sortOpen) return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} text-stone-500 hover:bg-stone-200/70 hover:text-stone-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public sortOptionClass(value: string) {
        const base = 'flex h-8 w-full items-center justify-between rounded-md px-2.5 text-left text-[12px] font-medium transition-colors';
        if (this.sortValue === value) return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public syncStatusClass() {
        const base = 'group flex w-full min-w-0 items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2';
        const toneClass = {
            idle: 'border-transparent text-stone-500 hover:border-stone-200 hover:bg-white/60 hover:text-stone-700 focus-visible:ring-stone-300 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
            running: 'border-blue-200/70 bg-blue-50 text-blue-700 hover:bg-blue-100 focus-visible:ring-blue-300 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15',
            success: 'border-transparent text-emerald-700 hover:border-emerald-200 hover:bg-emerald-50 focus-visible:ring-emerald-300 dark:text-emerald-300 dark:hover:border-emerald-500/20 dark:hover:bg-emerald-500/10',
            warning: 'border-amber-300 bg-amber-100 text-amber-900 shadow-sm ring-1 ring-amber-200 hover:bg-amber-200 hover:underline focus-visible:ring-amber-400 dark:border-amber-400/50 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-400/20 dark:hover:bg-amber-500/25',
            error: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus-visible:ring-red-300 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15'
        }[this.syncStatusTone];
        return `${base} ${toneClass}`;
    }

    public isSyncConflictStatus() {
        return this.syncStatusVisible && this.syncStatusTone === 'warning';
    }

    public showSyncStatus() {
        return this.syncStatusVisible;
    }

    public openSyncConflict() {
        if (!this.isSyncConflictStatus()) return;
        window.dispatchEvent(new CustomEvent('notedown:open-sync-conflict'));
    }

    public syncStatusDotClass() {
        const toneClass = {
            idle: 'bg-stone-300 dark:bg-zinc-700',
            running: 'bg-blue-500',
            success: 'bg-emerald-500',
            warning: 'bg-amber-500',
            error: 'bg-red-500'
        }[this.syncStatusTone];
        return `inline-block size-2 shrink-0 rounded-full ${toneClass}`;
    }

    @HostListener('document:keydown.escape')
    public closeOnEscape() {
        this.closeFolderContextMenu();
        this.sortOpen = false;
        if (this.searchOpen && !this.query) this.searchOpen = false;
    }

    @HostListener('document:click')
    public closeFloatingMenus() {
        this.sortOpen = false;
        this.closeFolderContextMenu();
    }

    private loadSortPreference() {
        const value = localStorage.getItem(this.sortKey) || '';
        const [field, direction] = value.split(':') as [SortField, SortDirection];
        if (!['createdAt', 'updatedAt', 'title'].includes(field)) return;
        if (!['asc', 'desc'].includes(direction)) return;
        this.sortField = field;
        this.sortDirection = direction;
    }

    private loadStartupSyncStatus() {
        const settings = this.readSettings();
        if (!settings.syncToken || !settings.storagePath) {
            this.clearSyncStatus();
            return;
        }

        const result = this.readStartupSyncResult();
        if (!result?.syncedAtMs) {
            this.clearSyncStatus();
            return;
        }

        const elapsedMs = Date.now() - Number(result.syncedAtMs);
        if (result.status === 'running' && elapsedMs <= 5 * 60 * 1000) {
            this.setSyncStatus('동기화 중', '서버 메타데이터와 로컬 파일을 비교하는 중입니다.', 'running');
            return;
        }

        if (elapsedMs > 30 * 60 * 1000) {
            this.clearSyncStatus();
            return;
        }

        const conflictCount = this.startupConflictCount(result);
        if (result.status === 'conflict' || conflictCount > 0) {
            const conflicts = conflictCount || 1;
            this.setSyncStatus('동기화 충돌', `충돌 ${conflicts}건이 감지되었습니다.`, 'warning');
            return;
        }

        if (result.ok && conflictCount === 0) {
            if (elapsedMs <= 10 * 1000) {
                this.setSyncStatus('동기화 완료', this.syncResultDetail(result), 'success', 4000);
            } else {
                this.clearSyncStatus();
            }
            return;
        }

        if (elapsedMs <= 10 * 1000) {
            this.setSyncStatus('동기화 실패', result.error || '시작 동기화에 실패했습니다.', 'error', 5000);
        } else {
            this.clearSyncStatus();
        }
    }

    private showSaveSyncStatus(detail: any) {
        const label = String(detail?.label || '').trim();
        if (!label) return;
        const tone = this.normalizeSyncStatusTone(detail?.tone);
        const statusDetail = String(detail?.detail || label);
        const ttlMs = Number(detail?.ttlMs) || (tone === 'running' ? 0 : 4000);
        this.setSyncStatus(label, statusDetail, tone, ttlMs);
        this.renderSoon();
    }

    private readStartupSyncResult() {
        try {
            return JSON.parse(localStorage.getItem(this.startupSyncResultKey) || '{}') || {};
        } catch (error) {
            return {};
        }
    }

    private startupConflictCount(result: any) {
        return Number(result?.summary?.conflicts) || result?.conflicts?.length || 0;
    }

    private syncResultDetail(result: any) {
        const summary = result.summary || {};
        return [
            `업로드 ${summary.uploadFiles || 0}`,
            `다운로드 ${summary.downloadFiles || 0}`,
            `삭제 ${Number(summary.deleteServerFiles || 0) + Number(summary.deleteLocalFiles || 0)}`,
            `충돌 ${summary.conflicts || 0}`
        ].join(', ');
    }

    private setSyncStatus(label: string, detail: string, tone: SyncStatusTone, ttlMs = 0) {
        this.clearSyncStatusTimer();
        this.syncStatusLabel = label;
        this.syncStatusDetail = detail;
        this.syncStatusTone = tone;
        this.syncStatusVisible = true;
        if (ttlMs > 0) {
            this.syncStatusHideTimeout = window.setTimeout(() => {
                this.syncStatusHideTimeout = null;
                this.clearSyncStatus();
                this.renderSoon();
            }, ttlMs);
        }
    }

    private clearSyncStatus() {
        this.clearSyncStatusTimer();
        this.syncStatusVisible = false;
        this.syncStatusLabel = '';
        this.syncStatusDetail = '';
        this.syncStatusTone = 'idle';
    }

    private clearSyncStatusTimer() {
        if (this.syncStatusHideTimeout == null) return;
        window.clearTimeout(this.syncStatusHideTimeout);
        this.syncStatusHideTimeout = null;
    }

    private normalizeSyncStatusTone(tone: any): SyncStatusTone {
        if (tone === 'running' || tone === 'success' || tone === 'warning' || tone === 'error') return tone;
        return 'idle';
    }

    private async loadNotes() {
        const fallback = this.defaultNotes();
        const fileBacked = this.usesFileStorage();
        const fileNotes = await this.loadFileNotes();
        if (fileNotes) {
            this.notes = fileNotes;
            this.syncFolders();
            this.syncActiveNote();
            return;
        }

        try {
            const stored = localStorage.getItem(this.storageKey);
            this.notes = stored ? JSON.parse(stored) : (fileBacked ? [] : fallback);
            if (!Array.isArray(this.notes) || this.notes.length === 0) this.notes = [];
            this.notes = this.notes.map((note, index) => this.normalizeNote(note, index));
            if (!stored && !fileBacked) localStorage.setItem(this.storageKey, JSON.stringify(this.notes));
        } catch (error) {
            this.notes = fileBacked ? [] : fallback;
            if (!fileBacked) localStorage.setItem(this.storageKey, JSON.stringify(this.notes));
        }

        this.syncFolders();
        this.syncActiveNote();
    }

    private syncActiveNote() {
        this.activeNoteId = localStorage.getItem(this.activeNoteKey) || this.notes[0]?.id || '';
        if (this.activeNoteId && this.notes.find(note => note.id === this.activeNoteId) == null) {
            this.activeNoteId = this.notes[0]?.id || '';
        }
        if (this.activeNoteId) localStorage.setItem(this.activeNoteKey, this.activeNoteId);
    }

    private syncFolders() {
        const folders = new Map<string, string>();
        folders.set('all', '모든 노트');

        for (const folder of this.readStoredFolders()) {
            if (folder.id !== 'all') folders.set(folder.id, folder.label);
        }

        for (const note of this.notes) {
            const folder = note.folder || 'memo';
            if (!folders.has(folder)) folders.set(folder, note.workspaceName || this.defaultFolderLabel(folder));
        }

        this.folders = Array.from(folders.entries()).map(([id, label]) => ({ id, label }));
        if (!this.folders.some(folder => folder.id === this.activeFolder)) this.activeFolder = 'all';
    }

    private readStoredFolders(): FolderItem[] {
        try {
            const stored = JSON.parse(localStorage.getItem(this.foldersKey) || '[]');
            if (!Array.isArray(stored)) return [];
            const folders = stored
                .map(folder => ({
                    id: String(folder?.id || '').trim(),
                    label: this.normalizeFolderLabel(folder?.label)
                }))
                .filter(folder => folder.id && folder.id !== 'all' && folder.label);
            return this.dedupeFolders(folders);
        } catch (error) {
            return [];
        }
    }

    private saveStoredFolders(folders: FolderItem[]) {
        localStorage.setItem(this.foldersKey, JSON.stringify(this.dedupeFolders(folders)));
    }

    private dedupeFolders(folders: FolderItem[]) {
        const map = new Map<string, FolderItem>();
        for (const folder of folders) {
            if (!folder.id || folder.id === 'all' || !folder.label) continue;
            map.set(folder.id, folder);
        }
        return Array.from(map.values());
    }

    private normalizeFolderLabel(value: unknown) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    private nextFolderLabel() {
        const base = '새 폴더';
        const used = new Set(this.folders.concat(this.readStoredFolders()).map(folder => this.normalizeFolderLabel(folder.label)));
        if (!used.has(base)) return base;

        let suffix = 2;
        while (used.has(`${base} ${suffix}`)) suffix++;
        return `${base} ${suffix}`;
    }

    private uniqueFolderLabel(label: string, currentFolderId: string) {
        if (!label) return '';
        const used = new Set(this.folders
            .concat(this.readStoredFolders())
            .filter(folder => folder.id !== currentFolderId)
            .map(folder => this.normalizeFolderLabel(folder.label)));
        if (!used.has(label)) return label;

        let suffix = 2;
        while (used.has(`${label} ${suffix}`)) suffix++;
        return `${label} ${suffix}`;
    }

    private folderIdFromLabel(label: string) {
        const id = label
            .normalize('NFKC')
            .replace(/[/:\\?%*"<>|]+/g, ' ')
            .replace(/[^\p{L}\p{N}_-]+/gu, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
        return id && id !== 'all' ? id : `folder-${Date.now()}`;
    }

    private uniqueFolderId(baseId: string) {
        const used = new Set(this.folders.concat(this.readStoredFolders()).map(folder => folder.id));
        if (!used.has(baseId)) return baseId;

        let suffix = 2;
        while (used.has(`${baseId}-${suffix}`)) suffix++;
        return `${baseId}-${suffix}`;
    }

    private defaultFolderLabel(folder: string) {
        if (folder === 'memo') return '메모';
        if (folder === 'blog') return '블로그';
        if (folder === 'project') return '프로젝트';
        if (folder === 'unfiled') return '미지정 워크스페이스';
        if (folder === '_imported') return '가져온 문서';
        return folder;
    }

    private async persistNotes() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.notes));
        const api = (window as any).notedown?.storage;
        const storagePath = this.storagePath();
        if (!api?.saveNotes || !storagePath) return;

        try {
            await api.saveNotes({ storagePath, notes: this.notes });
        } catch (error) {
            // Keep localStorage as fallback when file persistence is unavailable.
        }
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

    private storagePath() {
        try {
            const settings = JSON.parse(localStorage.getItem(this.settingsKey) || '{}');
            return settings.storagePath || '~/Documents/Notedown Notes';
        } catch (error) {
            return '~/Documents/Notedown Notes';
        }
    }

    private usesFileStorage() {
        return Boolean((window as any).notedown?.storage?.loadNotes);
    }

    private async syncNoteWithServer(note: NoteItem, deleted = false) {
        const api = (window as any).notedown?.sync;
        const settings = this.readSettings();
        const storagePath = this.storagePath();
        if (!api?.uploadNote || !settings.syncToken || !storagePath) return;

        try {
            await api.uploadNote({
                serverUrl: settings.syncServerUrl,
                token: settings.syncToken,
                clientId: settings.syncClientId,
                storagePath,
                note,
                deleted
            });
        } catch (error) {
            // Local save remains authoritative when server sync is unavailable.
        }
    }

    private readSettings() {
        try {
            return JSON.parse(localStorage.getItem(this.settingsKey) || '{}') || {};
        } catch (error) {
            return {};
        }
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
            attachments: Array.isArray(note?.attachments) ? note.attachments : [],
            createdAt: note?.createdAt || this.nowLabel(new Date(createdAtMs)),
            createdAtMs,
            updatedAt: note?.updatedAt || this.nowLabel(new Date(updatedAtMs)),
            updatedAtMs
        };
    }

    private sortNotes(notes: NoteItem[]) {
        const direction = this.sortDirection === 'asc' ? 1 : -1;
        return [...notes].sort((left, right) => {
            if (this.sortField === 'title') {
                return direction * left.title.localeCompare(right.title, 'ko-KR', { numeric: true, sensitivity: 'base' });
            }

            const leftTime = this.sortField === 'createdAt' ? left.createdAtMs : left.updatedAtMs;
            const rightTime = this.sortField === 'createdAt' ? right.createdAtMs : right.updatedAtMs;
            return direction * ((leftTime || 0) - (rightTime || 0));
        });
    }

    private taskStats(note: NoteItem) {
        return (note.body || '').split('\n').reduce((stats, line) => {
            const task = /^\s*[-*]\s+\[([ xX])\]\s+/.exec(line);
            if (!task) return stats;

            stats.total += 1;
            if (task[1].toLowerCase() === 'x') stats.done += 1;
            return stats;
        }, { total: 0, done: 0 });
    }

    private hasMeaningfulBody(note: NoteItem) {
        const title = (note.title || '').trim();
        return (note.body || '')
            .split('\n')
            .map(line => line.replace(/^#+\s*/, '').trim())
            .some(line => line && line !== title);
    }

    private focusFolderNameInput(folderId: string) {
        const escapedFolderId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(folderId) : folderId.replace(/"/g, '\\"');
        const input = document.querySelector<HTMLInputElement>(`[data-folder-name-input="${escapedFolderId}"]`);
        input?.focus();
        input?.select();
    }

    private emitWorkspaceState(open: boolean) {
        window.dispatchEvent(new CustomEvent('notedown:workspace-panel', { detail: open }));
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

    private renderSoon(callback?: () => void) {
        window.setTimeout(() => {
            try {
                this.ref.detectChanges();
                if (callback) callback();
            } catch (error) {
                // The view may already be destroyed when an async storage callback settles.
            }
        }, 0);
    }
}
