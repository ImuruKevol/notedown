import { HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Service } from '@wiz/libs/portal/season/service';
import { Subscription, filter } from 'rxjs';

type PaletteMode = 'notes' | 'workspaces' | 'commands';
type PaletteItemType = 'note-title' | 'note-body' | 'workspace' | 'command';
type ThemeMode = 'light' | 'dark' | 'system';
type EditorMode = 'markdown' | 'split' | 'preview';

interface NoteItem {
    id: string;
    title: string;
    body: string;
    tags?: string[];
    folder?: string;
    workspaceName?: string;
    updatedAt?: string;
    updatedAtMs?: number;
    attachments?: any[];
}

interface WorkspaceItem {
    id: string;
    label: string;
    count: number;
}

interface AppSettings {
    workspaceName: string;
    storagePath: string;
    theme: ThemeMode;
    editorMode: EditorMode;
    autoSave: boolean;
    keepInBackgroundOnClose: boolean;
    tabSize: number;
    syncServerUrl: string;
    syncUsername: string;
    syncToken: string;
    syncTokenType: string;
    syncClientId: string;
    syncAutoUpload: boolean;
}

interface PaletteCommand {
    id: string;
    title: string;
    subtitle: string;
    keywords: string;
    run: () => void;
}

interface PaletteItem {
    id: string;
    type: PaletteItemType;
    title: string;
    subtitle: string;
    note?: NoteItem;
    workspace?: WorkspaceItem;
    command?: PaletteCommand;
}

export class Component implements OnInit, OnDestroy {
    private notesKey = 'notedown.notes.v1';
    private activeNoteKey = 'notedown.activeNoteId.v1';
    private activeWorkspaceKey = 'notedown.activeWorkspace.v1';
    private foldersKey = 'notedown.folders.v1';
    private settingsKey = 'notedown.settings.v1';
    private routeSubscription?: Subscription;
    private handleWorkspacePanel = (event: Event) => {
        this.workspacePanelOpen = Boolean((event as CustomEvent<boolean>).detail);
        this.renderSoon();
    };
    private handleOpenCommandPalette = () => this.openPalette();
    private handleNotesChanged = () => this.refreshPaletteData();
    private handleWorkspaceChanged = (event: Event) => {
        const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId;
        if (workspaceId) {
            this.refreshPaletteData();
            this.activeWorkspaceId = workspaceId;
            localStorage.setItem(this.activeWorkspaceKey, workspaceId);
            this.renderSoon();
        }
    };
    private handleStorageChanged = (event: StorageEvent) => {
        if (event.key === this.notesKey || event.key === this.settingsKey || event.key === this.activeWorkspaceKey || event.key === this.foldersKey) {
            this.refreshPaletteData();
            this.renderSoon();
        }
    };
    private handlePaletteShortcut = (event: KeyboardEvent) => {
        const key = String(event.key || '').toLowerCase();
        const mod = event.metaKey || event.ctrlKey;
        if (!mod || event.altKey || key !== 'p') return;

        event.preventDefault();
        event.stopImmediatePropagation();
        this.openPalette(event.shiftKey ? '>' : '');
    };

    public mobileOpen = false;
    public isSettingsRoute = false;
    public workspacePanelOpen = false;
    public paletteOpen = false;
    public paletteQuery = '';
    public paletteIndex = 0;
    public notes: NoteItem[] = [];
    public workspaces: WorkspaceItem[] = [{ id: 'all', label: '모든 노트', count: 0 }];
    public activeWorkspaceId = 'all';
    public settings: AppSettings = this.defaultSettings();

    constructor(private router: Router, public service: Service) { }

    public async ngOnInit() {
        this.refreshPaletteData();
        this.syncRouteState();
        window.addEventListener('notedown:workspace-panel', this.handleWorkspacePanel);
        window.addEventListener('notedown:open-command-palette', this.handleOpenCommandPalette);
        window.addEventListener('notedown:notes-changed', this.handleNotesChanged);
        window.addEventListener('notedown:workspace-changed', this.handleWorkspaceChanged);
        window.addEventListener('storage', this.handleStorageChanged);
        window.addEventListener('keydown', this.handlePaletteShortcut, true);
        this.routeSubscription = this.router.events
            .pipe(filter(event => event instanceof NavigationEnd))
            .subscribe(() => this.syncRouteState());
        await this.service.render();
    }

    public ngOnDestroy() {
        window.removeEventListener('notedown:workspace-panel', this.handleWorkspacePanel);
        window.removeEventListener('notedown:open-command-palette', this.handleOpenCommandPalette);
        window.removeEventListener('notedown:notes-changed', this.handleNotesChanged);
        window.removeEventListener('notedown:workspace-changed', this.handleWorkspaceChanged);
        window.removeEventListener('storage', this.handleStorageChanged);
        window.removeEventListener('keydown', this.handlePaletteShortcut, true);
        this.routeSubscription?.unsubscribe();
    }

    public toggleSidebar(event?: Event) {
        if (event) event.stopPropagation();
        this.mobileOpen = !this.mobileOpen;
    }

    public closeSidebar() {
        this.mobileOpen = false;
    }

    public desktopSidebarClass() {
        const width = this.workspacePanelOpen ? 'lg:w-[492px]' : 'lg:w-[256px]';
        return `hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex ${width} lg:flex-col lg:border-r lg:border-stone-200 lg:bg-[#f6f5f1] lg:transition-[width] lg:duration-200 dark:lg:border-zinc-800 dark:lg:bg-zinc-950`;
    }

    public mobileSidebarClass() {
        return this.workspacePanelOpen
            ? 'relative flex h-full w-[min(94vw,492px)] flex-col border-r border-stone-200 bg-[#f6f5f1] shadow-2xl transition-[width] duration-200 dark:border-zinc-800 dark:bg-zinc-950'
            : 'relative flex h-full w-[min(92vw,320px)] flex-col border-r border-stone-200 bg-[#f6f5f1] shadow-2xl transition-[width] duration-200 dark:border-zinc-800 dark:bg-zinc-950';
    }

    public mainClass() {
        const base = 'overflow-hidden bg-white dark:bg-zinc-950';
        if (this.isSettingsRoute) return `h-full ${base}`;
        const padding = this.workspacePanelOpen ? 'lg:pl-[492px]' : 'lg:pl-[256px]';
        return `h-[calc(100%-3rem)] lg:h-full ${padding} lg:transition-[padding] lg:duration-200 ${base}`;
    }

    public openPalette(seed = '') {
        this.refreshPaletteData();
        this.paletteQuery = seed;
        this.paletteIndex = 0;
        this.paletteOpen = true;
        this.renderSoon(() => {
            this.focusPaletteSoon();
            this.scrollPaletteItemSoon();
        });
    }

    public closePalette() {
        this.paletteOpen = false;
        this.paletteQuery = '';
        this.paletteIndex = 0;
        this.renderSoon();
    }

    public onPaletteQueryChange(value: string) {
        this.paletteQuery = value;
        this.paletteIndex = 0;
        this.renderSoon(() => this.scrollPaletteItemSoon());
    }

    public handlePaletteKeydown(event: KeyboardEvent) {
        const items = this.paletteItems;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.closePalette();
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.paletteIndex = items.length ? (this.paletteIndex + 1) % items.length : 0;
            this.renderSoon(() => this.scrollPaletteItemSoon());
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.paletteIndex = items.length ? (this.paletteIndex - 1 + items.length) % items.length : 0;
            this.renderSoon(() => this.scrollPaletteItemSoon());
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            this.paletteIndex = 0;
            this.renderSoon(() => this.scrollPaletteItemSoon());
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            this.paletteIndex = Math.max(0, items.length - 1);
            this.renderSoon(() => this.scrollPaletteItemSoon());
            return;
        }

        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            if (items[this.paletteIndex]) this.runPaletteItem(items[this.paletteIndex]);
        }
    }

    public get paletteItems(): PaletteItem[] {
        const mode = this.paletteMode();
        if (mode === 'workspaces') return this.workspacePaletteItems();
        if (mode === 'commands') return this.commandPaletteItems();
        return this.notePaletteItems();
    }

    public palettePlaceholder() {
        if (this.paletteMode() === 'workspaces') return '워크스페이스 선택';
        if (this.paletteMode() === 'commands') return '설정 명령 실행';
        const scope = this.activeWorkspaceLabel();
        return scope === '모든 노트' ? '노트 검색' : `${scope}에서 노트 검색`;
    }

    public paletteModeLabel() {
        const mode = this.paletteMode();
        if (mode === 'workspaces') return '워크스페이스';
        if (mode === 'commands') return '설정';
        return this.activeWorkspaceLabel();
    }

    public paletteHintLabel() {
        const mode = this.paletteMode();
        if (mode === 'workspaces') return 'Enter로 선택';
        if (mode === 'commands') return 'Enter로 실행';
        return '제목 우선, 내용 다음';
    }

    public paletteItemClass(index: number) {
        const base = 'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition';
        if (this.paletteIndex === index) return `${base} bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-950`;
        return `${base} text-stone-700 hover:bg-stone-100 dark:text-zinc-200 dark:hover:bg-zinc-800`;
    }

    public paletteIconClass(index: number) {
        const base = 'flex size-8 shrink-0 items-center justify-center rounded-md';
        if (this.paletteIndex === index) return `${base} bg-white/15 text-white dark:bg-zinc-950/10 dark:text-zinc-950`;
        return `${base} bg-stone-100 text-stone-500 dark:bg-zinc-800 dark:text-zinc-400`;
    }

    public paletteSubtitleClass(index: number) {
        if (this.paletteIndex === index) return 'mt-0.5 truncate text-[12px] text-white/70 dark:text-zinc-950/60';
        return 'mt-0.5 truncate text-[12px] text-stone-400 dark:text-zinc-500';
    }

    public paletteBadgeClass(index: number) {
        if (this.paletteIndex === index) return 'shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white/80 dark:bg-zinc-950/10 dark:text-zinc-950/70';
        return 'shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-400 dark:bg-zinc-800 dark:text-zinc-500';
    }

    public selectPaletteItem(item: PaletteItem, event?: Event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        this.runPaletteItem(item);
    }

    public selectPaletteItemByPointer(index: number) {
        if (this.paletteIndex === index) return;
        this.paletteIndex = index;
        this.renderSoon();
    }

    private runPaletteItem(item: PaletteItem) {
        if (item.type === 'workspace' && item.workspace) {
            this.selectPaletteWorkspace(item.workspace);
            return;
        }

        if ((item.type === 'note-title' || item.type === 'note-body') && item.note) {
            this.selectPaletteNote(item.note);
            return;
        }

        if (item.type === 'command' && item.command) {
            item.command.run();
            this.closePalette();
        }
    }

    @HostListener('document:keydown.escape')
    public closeOnEscape() {
        if (this.paletteOpen) return;
        this.closeSidebar();
    }

    private syncRouteState() {
        this.isSettingsRoute = this.router.url.startsWith('/settings');
        if (this.isSettingsRoute) {
            this.closeSidebar();
            this.workspacePanelOpen = false;
        }
    }

    private refreshPaletteData() {
        this.notes = this.readNotes();
        this.workspaces = this.buildWorkspaces(this.notes);
        this.settings = this.readSettings();
        this.activeWorkspaceId = localStorage.getItem(this.activeWorkspaceKey) || this.workspaceIdForActiveNote() || 'all';
        if (!this.workspaces.some(workspace => workspace.id === this.activeWorkspaceId)) this.activeWorkspaceId = 'all';
    }

    private readNotes(): NoteItem[] {
        try {
            const stored = JSON.parse(localStorage.getItem(this.notesKey) || '[]');
            if (!Array.isArray(stored)) return [];
            return stored.map((note, index) => this.normalizeNote(note, index));
        } catch (error) {
            return [];
        }
    }

    private normalizeNote(note: any, index: number): NoteItem {
        const fallbackTime = Date.now() - (index * 60000);
        return {
            id: String(note?.id || `note-${fallbackTime}`),
            title: String(note?.title || '제목 없음'),
            body: typeof note?.body === 'string' ? note.body : '',
            tags: Array.isArray(note?.tags) ? note.tags : [],
            folder: note?.folder || 'memo',
            workspaceName: typeof note?.workspaceName === 'string' ? note.workspaceName : undefined,
            updatedAt: typeof note?.updatedAt === 'string' ? note.updatedAt : '',
            updatedAtMs: Number.isFinite(note?.updatedAtMs) ? Number(note.updatedAtMs) : fallbackTime,
            attachments: Array.isArray(note?.attachments) ? note.attachments : []
        };
    }

    private buildWorkspaces(notes: NoteItem[]): WorkspaceItem[] {
        const folders = new Map<string, WorkspaceItem>();
        folders.set('all', { id: 'all', label: '모든 노트', count: notes.length });

        for (const folder of this.readStoredFolders()) {
            folders.set(folder.id, { id: folder.id, label: folder.label, count: 0 });
        }

        for (const note of notes) {
            const id = note.folder || 'memo';
            const current = folders.get(id);
            if (current) {
                current.count += 1;
                if (!current.label && note.workspaceName) current.label = note.workspaceName;
                continue;
            }
            folders.set(id, { id, label: note.workspaceName || this.defaultWorkspaceLabel(id), count: 1 });
        }

        return Array.from(folders.values());
    }

    private readStoredFolders(): WorkspaceItem[] {
        try {
            const stored = JSON.parse(localStorage.getItem(this.foldersKey) || '[]');
            if (!Array.isArray(stored)) return [];
            const folders = stored
                .map(folder => ({
                    id: String(folder?.id || '').trim(),
                    label: String(folder?.label || '').replace(/\s+/g, ' ').trim(),
                    count: 0
                }))
                .filter(folder => folder.id && folder.id !== 'all' && folder.label);
            return this.dedupeWorkspaces(folders);
        } catch (error) {
            return [];
        }
    }

    private dedupeWorkspaces(workspaces: WorkspaceItem[]) {
        const map = new Map<string, WorkspaceItem>();
        for (const workspace of workspaces) {
            if (!workspace.id || workspace.id === 'all' || !workspace.label) continue;
            map.set(workspace.id, workspace);
        }
        return Array.from(map.values());
    }

    private workspaceIdForActiveNote() {
        const activeNoteId = localStorage.getItem(this.activeNoteKey);
        return this.notes.find(note => note.id === activeNoteId)?.folder || '';
    }

    private paletteMode(): PaletteMode {
        if (this.paletteQuery.startsWith('@')) return 'workspaces';
        if (this.paletteQuery.startsWith('>')) return 'commands';
        return 'notes';
    }

    private workspacePaletteItems(): PaletteItem[] {
        const term = this.normalizeSearchText(this.paletteQuery.slice(1));
        return this.workspaces
            .filter(workspace => !term || this.normalizeSearchText(`${workspace.label} ${workspace.id}`).includes(term))
            .map(workspace => ({
                id: `workspace:${workspace.id}`,
                type: 'workspace',
                title: workspace.label,
                subtitle: workspace.id === 'all' ? '전체 워크스페이스에서 검색' : `${workspace.count}개 노트`,
                workspace
            }));
    }

    private notePaletteItems(): PaletteItem[] {
        const term = this.normalizeSearchText(this.paletteQuery);
        const scopedNotes = this.notesForActiveWorkspace();
        const sortedNotes = [...scopedNotes].sort((left, right) => Number(right.updatedAtMs || 0) - Number(left.updatedAtMs || 0));

        if (!term) {
            return sortedNotes.slice(0, 20).map(note => ({
                id: `note:${note.id}`,
                type: 'note-title',
                title: note.title,
                subtitle: `${this.workspaceLabelForNote(note)} · ${note.updatedAt || '최근 노트'}`,
                note
            }));
        }

        const titleMatches: PaletteItem[] = [];
        const bodyMatches: PaletteItem[] = [];

        for (const note of sortedNotes) {
            const title = this.normalizeSearchText(note.title);
            const body = this.normalizeSearchText(note.body);
            if (title.includes(term)) {
                titleMatches.push({
                    id: `note-title:${note.id}`,
                    type: 'note-title',
                    title: note.title,
                    subtitle: `${this.workspaceLabelForNote(note)} · 제목 일치`,
                    note
                });
                continue;
            }

            if (body.includes(term)) {
                bodyMatches.push({
                    id: `note-body:${note.id}`,
                    type: 'note-body',
                    title: note.title,
                    subtitle: this.bodySnippet(note.body, term),
                    note
                });
            }
        }

        return [...titleMatches, ...bodyMatches].slice(0, 40);
    }

    private commandPaletteItems(): PaletteItem[] {
        const term = this.normalizeSearchText(this.paletteQuery.slice(1));
        return this.settingsCommands()
            .filter(command => !term || this.normalizeSearchText(`${command.title} ${command.subtitle} ${command.keywords}`).includes(term))
            .map(command => ({
                id: `command:${command.id}`,
                type: 'command',
                title: command.title,
                subtitle: command.subtitle,
                command
            }));
    }

    private notesForActiveWorkspace() {
        if (this.activeWorkspaceId === 'all') return this.notes;
        return this.notes.filter(note => (note.folder || 'memo') === this.activeWorkspaceId);
    }

    private selectPaletteWorkspace(workspace: WorkspaceItem) {
        this.activeWorkspaceId = workspace.id;
        localStorage.setItem(this.activeWorkspaceKey, workspace.id);
        window.dispatchEvent(new CustomEvent('notedown:workspace-changed', { detail: { workspaceId: workspace.id } }));
        this.paletteQuery = '';
        this.paletteIndex = 0;
        this.renderSoon(() => {
            this.focusPaletteSoon();
            this.scrollPaletteItemSoon();
        });
    }

    private selectPaletteNote(note: NoteItem) {
        const workspaceId = note.folder || 'memo';
        this.activeWorkspaceId = workspaceId;
        localStorage.setItem(this.activeWorkspaceKey, workspaceId);
        localStorage.setItem(this.activeNoteKey, note.id);
        window.dispatchEvent(new CustomEvent('notedown:workspace-changed', { detail: { workspaceId } }));

        const dispatchSelect = () => {
            window.dispatchEvent(new CustomEvent('notedown:select-note', { detail: note.id }));
        };
        if (this.router.url.startsWith('/notes')) {
            dispatchSelect();
        } else {
            void this.router.navigateByUrl('/notes').then(() => window.setTimeout(dispatchSelect, 0));
        }
        this.closePalette();
        this.closeSidebar();
    }

    private settingsCommands(): PaletteCommand[] {
        const themeLabel = { light: 'Light', dark: 'Dark', system: 'System' }[this.settings.theme];
        const editorLabel = { markdown: '작성', split: '분할', preview: '미리보기' }[this.settings.editorMode];
        return [
            {
                id: 'open-settings',
                title: '설정 열기',
                subtitle: '설정 화면으로 이동',
                keywords: 'settings preferences option general',
                run: () => { void this.router.navigateByUrl('/settings'); }
            },
            ...(['light', 'dark', 'system'] as ThemeMode[]).map(theme => ({
                id: `theme-${theme}`,
                title: `테마: ${theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'}`,
                subtitle: this.settings.theme === theme ? '현재 선택됨' : `현재 ${themeLabel}`,
                keywords: `theme color ${theme} 테마 화면`,
                run: () => this.updateSettings({ theme })
            })),
            ...(['markdown', 'split', 'preview'] as EditorMode[]).map(mode => ({
                id: `editor-${mode}`,
                title: `편집 모드: ${mode === 'markdown' ? '작성' : mode === 'split' ? '분할' : '미리보기'}`,
                subtitle: this.settings.editorMode === mode ? '현재 선택됨' : `현재 ${editorLabel}`,
                keywords: `editor mode ${mode} 편집 작성 분할 미리보기`,
                run: () => this.updateSettings({ editorMode: mode })
            })),
            {
                id: 'auto-save',
                title: `자동 저장 ${this.settings.autoSave ? '끄기' : '켜기'}`,
                subtitle: this.settings.autoSave ? '현재 켜짐' : '현재 꺼짐',
                keywords: 'auto save autosave 자동 저장',
                run: () => this.updateSettings({ autoSave: !this.settings.autoSave })
            },
            {
                id: 'keep-background',
                title: `닫을 때 백그라운드 유지 ${this.settings.keepInBackgroundOnClose ? '끄기' : '켜기'}`,
                subtitle: this.settings.keepInBackgroundOnClose ? '현재 켜짐' : '현재 꺼짐',
                keywords: 'background close tray keep 백그라운드 트레이 종료',
                run: () => this.updateSettings({ keepInBackgroundOnClose: !this.settings.keepInBackgroundOnClose })
            },
            ...([2, 4, 8] as number[]).map(size => ({
                id: `tab-size-${size}`,
                title: `탭 크기: ${size}`,
                subtitle: this.settings.tabSize === size ? '현재 선택됨' : `현재 ${this.settings.tabSize}`,
                keywords: `tab size indent ${size} 탭 들여쓰기`,
                run: () => this.updateSettings({ tabSize: size })
            }))
        ];
    }

    private updateSettings(updates: Partial<AppSettings>) {
        const settings = { ...this.defaultSettings(), ...this.readSettings(), ...updates };
        settings.theme = this.normalizeTheme(settings.theme);
        settings.editorMode = this.normalizeEditorMode(settings.editorMode);
        settings.tabSize = this.normalizeTabSize(settings.tabSize);
        this.settings = settings;
        localStorage.setItem(this.settingsKey, JSON.stringify(settings));
        this.applyTheme();
        this.syncAppPreferences(settings);
        window.dispatchEvent(new CustomEvent('notedown:settings-changed', { detail: settings }));
    }

    private readSettings(): AppSettings {
        try {
            return { ...this.defaultSettings(), ...JSON.parse(localStorage.getItem(this.settingsKey) || '{}') };
        } catch (error) {
            return this.defaultSettings();
        }
    }

    private defaultSettings(): AppSettings {
        return {
            workspaceName: 'Notedown',
            storagePath: '~/Documents/Notedown Notes',
            theme: 'light',
            editorMode: 'split',
            autoSave: true,
            keepInBackgroundOnClose: true,
            tabSize: 2,
            syncServerUrl: 'http://172.16.0.143:5500',
            syncUsername: '',
            syncToken: '',
            syncTokenType: '',
            syncClientId: '',
            syncAutoUpload: false
        };
    }

    private normalizeTheme(value: unknown): ThemeMode {
        return value === 'dark' || value === 'system' || value === 'light' ? value : 'light';
    }

    private normalizeEditorMode(value: unknown): EditorMode {
        return value === 'markdown' || value === 'preview' || value === 'split' ? value : 'split';
    }

    private normalizeTabSize(value: unknown) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 2;
        return Math.min(8, Math.max(2, Math.round(parsed)));
    }

    private applyTheme() {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const dark = this.settings.theme === 'dark' || (this.settings.theme === 'system' && prefersDark);
        document.documentElement.classList.toggle('dark', dark);
    }

    private syncAppPreferences(settings: AppSettings) {
        const api = (window as any).notedown?.app;
        if (!api?.setPreferences) return;
        void api.setPreferences({ keepInBackgroundOnClose: settings.keepInBackgroundOnClose !== false }).catch(() => { });
    }

    private activeWorkspaceLabel() {
        return this.workspaces.find(workspace => workspace.id === this.activeWorkspaceId)?.label || '모든 노트';
    }

    private workspaceLabelForNote(note: NoteItem) {
        const id = note.folder || 'memo';
        return this.workspaces.find(workspace => workspace.id === id)?.label || note.workspaceName || this.defaultWorkspaceLabel(id);
    }

    private defaultWorkspaceLabel(workspaceId: string) {
        if (workspaceId === 'memo') return '메모';
        if (workspaceId === 'blog') return '블로그';
        if (workspaceId === 'project') return '프로젝트';
        if (workspaceId === 'unfiled') return '미지정 워크스페이스';
        if (workspaceId === '_imported') return '가져온 문서';
        return workspaceId;
    }

    private normalizeSearchText(value: string) {
        return String(value || '').trim().toLowerCase();
    }

    private bodySnippet(body: string, term: string) {
        const text = String(body || '')
            .replace(/^#+\s*/gm, '')
            .replace(/[`*_>#-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const index = this.normalizeSearchText(text).indexOf(term);
        if (index < 0) return '내용 일치';
        const start = Math.max(0, index - 26);
        const snippet = text.slice(start, start + 72).trim();
        return `${start > 0 ? '...' : ''}${snippet}`;
    }

    private focusPaletteSoon() {
        window.setTimeout(() => {
            const input = document.querySelector<HTMLInputElement>('[data-command-palette-input="true"]');
            input?.focus();
            input?.select();
        }, 0);
    }

    private scrollPaletteItemSoon() {
        window.setTimeout(() => {
            const list = document.querySelector<HTMLElement>('[data-command-palette-list="true"]');
            const item = list?.querySelector<HTMLElement>(`[data-command-palette-index="${this.paletteIndex}"]`);
            item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }, 0);
    }

    private renderSoon(afterRender?: () => void) {
        void this.service.render().then(() => {
            if (afterRender) afterRender();
        }).catch(() => {
            if (afterRender) afterRender();
        });
    }
}
