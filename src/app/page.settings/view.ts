import { OnInit } from '@angular/core';
import { Service } from '@wiz/libs/portal/season/service';

type ThemeMode = 'light' | 'dark' | 'system';
type EditorMode = 'markdown' | 'split' | 'preview';
type ToggleKey = 'autoSave';
type StorageAction = '' | 'choose' | 'refresh' | 'initialize' | 'import';
type StorageMessageTone = 'info' | 'success' | 'warning' | 'error';

interface AppSettings {
    workspaceName: string;
    storagePath: string;
    theme: ThemeMode;
    editorMode: EditorMode;
    autoSave: boolean;
    tabSize: number;
}

interface StorageInfo {
    storagePath?: string;
    metadataPath?: string;
    metadataExists?: boolean;
    notes?: number;
    workspaces?: number;
    shallowMarkdownCount?: number;
    deepMarkdownCount?: number;
    rootMarkdownCount?: number;
    copiedDeepCount?: number;
}

export class Component implements OnInit {
    private storageKey = 'notedown.settings.v1';
    private notesKey = 'notedown.notes.v1';

    public activeSection = 'general';
    public savedAt = '';
    public storageBusy = false;
    public storageAction: StorageAction = '';
    public storageMessage = '';
    public storageMessageTone: StorageMessageTone = 'info';
    public storageInfo: StorageInfo = {};
    public sections = [
        { id: 'general', label: '일반' },
        { id: 'storage', label: '저장소' }
    ];
    public settings: AppSettings = this.defaultSettings();

    constructor(public service: Service) { }

    public async ngOnInit() {
        this.loadSettings();
        await this.ensureDefaultStoragePath();
        await this.refreshStorageInfo();
        this.applyTheme();
    }

    public setSection(id: string) {
        this.activeSection = id;
    }

    public setTheme(theme: ThemeMode) {
        this.settings.theme = theme;
        this.applyTheme();
        this.saveSettings();
    }

    public setEditorMode(mode: EditorMode) {
        this.settings.editorMode = mode;
        this.saveSettings();
    }

    public setTabSize(value: number | string) {
        this.settings.tabSize = this.normalizeTabSize(value);
        this.saveSettings();
    }

    public toggle(key: ToggleKey) {
        this.settings[key] = !this.settings[key];
        this.saveSettings();
    }

    public saveSettings() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
        this.savedAt = this.nowLabel();
        window.dispatchEvent(new CustomEvent('notedown:settings-changed', { detail: this.settings }));
    }

    public resetSettings() {
        localStorage.removeItem(this.storageKey);
        this.settings = this.defaultSettings();
        this.applyTheme();
        this.saveSettings();
    }

    public async chooseStoragePath() {
        const api = this.storageApi();
        if (!api?.chooseDirectory) {
            this.applyStorageFallback('디렉토리 선택은 Electron 앱에서 사용할 수 있습니다.', 'warning');
            await this.service.render();
            return;
        }

        if (this.storageBusy) return;
        let shouldRefresh = false;
        this.storageBusy = true;
        this.storageAction = 'choose';
        this.setStorageMessage('디렉토리 선택 창을 열었습니다.', 'info');
        await this.service.render();
        try {
            const result = await api.chooseDirectory();
            if (result?.canceled) {
                this.setStorageMessage('디렉토리 선택을 취소했습니다.', 'info');
                return;
            }
            if (!result?.ok || !result.storagePath) {
                this.setStorageMessage('디렉토리를 선택하지 못했습니다.', 'error');
                return;
            }
            this.settings.storagePath = result.storagePath;
            this.saveSettings();
            shouldRefresh = true;
        } catch (error) {
            this.setStorageMessage(this.errorMessage(error, '디렉토리 선택 중 오류가 발생했습니다.'), 'error');
        } finally {
            this.storageAction = '';
            this.storageBusy = false;
            await this.service.render();
        }

        if (shouldRefresh) await this.refreshStorageInfo();
    }

    public async refreshStorageInfo() {
        const api = this.storageApi();
        if (!api?.info) {
            this.applyStorageFallback('브라우저 미리보기에서는 로컬 디렉토리 상태를 읽을 수 없습니다. Electron 앱에서 확인하세요.', 'warning');
            await this.service.render();
            return;
        }

        await this.runStorageAction('refresh', '저장소 상태를 확인하는 중입니다...', async () => {
            const result = await api.info({ storagePath: this.settings.storagePath });
            if (result?.ok) {
                this.storageInfo = result;
                this.settings.storagePath = result.storagePath || this.settings.storagePath;
                this.setStorageMessage(
                    result.metadataExists
                        ? 'metadata.json을 확인했습니다.'
                        : 'metadata.json이 아직 없습니다. 초기화를 실행하세요.',
                    result.metadataExists ? 'success' : 'warning'
                );
                this.saveSettings();
                return;
            }

            this.setStorageMessage('저장소 상태를 확인하지 못했습니다.', 'error');
        });
    }

    public async initializeStorage() {
        const api = this.storageApi();
        if (!api?.initialize) {
            this.applyStorageFallback('metadata.json 생성은 Electron 앱에서 로컬 디렉토리를 선택한 뒤 사용할 수 있습니다.', 'warning');
            await this.service.render();
            return;
        }

        await this.runStorageAction('initialize', 'metadata.json을 생성/갱신하는 중입니다...', async () => {
            const result = await api.initialize({
                storagePath: this.settings.storagePath,
                importDeepMarkdown: false
            });
            if (result?.ok) {
                this.storageInfo = { ...result, metadataExists: true };
                this.setStorageMessage(`${result.workspaces}개 작업공간, ${result.notes}개 문서를 metadata.json으로 정리했습니다.`, 'success');
                window.dispatchEvent(new CustomEvent('notedown:notes-changed'));
                return;
            }

            this.setStorageMessage('metadata.json을 생성/갱신하지 못했습니다.', 'error');
        });
    }

    public async importDeepMarkdown() {
        const api = this.storageApi();
        if (!api?.initialize) {
            this.applyStorageFallback('깊은 문서 가져오기는 Electron 앱에서 사용할 수 있습니다.', 'warning');
            await this.service.render();
            return;
        }

        await this.runStorageAction('import', '깊은 경로의 Markdown을 가져오는 중입니다...', async () => {
            const result = await api.initialize({
                storagePath: this.settings.storagePath,
                importDeepMarkdown: true
            });
            if (result?.ok) {
                this.storageInfo = { ...result, metadataExists: true };
                this.setStorageMessage(`깊은 경로의 Markdown ${result.copiedDeepCount || 0}개를 복사해 가져왔습니다.`, 'success');
                window.dispatchEvent(new CustomEvent('notedown:notes-changed'));
                return;
            }

            this.setStorageMessage('깊은 경로의 Markdown을 가져오지 못했습니다.', 'error');
        });
    }

    public sectionButtonClass(id: string) {
        const base = 'flex h-9 w-full items-center rounded-md px-3 text-left text-[13px] font-medium transition-colors';
        if (this.activeSection === id) return `${base} bg-stone-200/80 text-stone-950 dark:bg-zinc-800 dark:text-zinc-50`;
        return `${base} text-stone-500 hover:bg-stone-200/60 hover:text-stone-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50`;
    }

    public optionClass(active: boolean) {
        const base = 'h-9 rounded-md px-3 text-[13px] font-medium transition-colors';
        if (active) return `${base} bg-white text-stone-950 shadow-sm dark:bg-zinc-700 dark:text-white`;
        return `${base} text-stone-500 hover:text-stone-950 dark:text-zinc-400 dark:hover:text-zinc-100`;
    }

    public toggleTrackClass(active: boolean) {
        const base = 'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-stone-300 dark:focus:ring-zinc-700';
        return active ? `${base} bg-stone-900 dark:bg-zinc-100` : `${base} bg-stone-200 dark:bg-zinc-800`;
    }

    public toggleKnobClass(active: boolean) {
        const base = 'inline-block size-5 rounded-full bg-white shadow transition-transform dark:bg-zinc-950';
        return active ? `${base} translate-x-5` : `${base} translate-x-1`;
    }

    public storageStatusClass() {
        const base = 'inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold';
        return this.storageInfo.metadataExists
            ? `${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300`
            : `${base} bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300`;
    }

    public storageMessageClass() {
        const base = 'mt-2 min-h-5 text-[12px]';
        if (this.storageMessageTone === 'success') return `${base} text-emerald-700 dark:text-emerald-300`;
        if (this.storageMessageTone === 'warning') return `${base} text-amber-700 dark:text-amber-300`;
        if (this.storageMessageTone === 'error') return `${base} text-red-600 dark:text-red-300`;
        return `${base} text-stone-400 dark:text-zinc-500`;
    }

    private loadSettings() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) return;
            this.settings = this.normalizeSettings(JSON.parse(stored));
            this.savedAt = this.nowLabel();
        } catch (error) {
            this.saveSettings();
        }
    }

    private defaultSettings(): AppSettings {
        return {
            workspaceName: 'Notedown',
            storagePath: '~/Documents/Notedown Notes',
            theme: 'light',
            editorMode: 'split',
            autoSave: true,
            tabSize: 2
        };
    }

    private normalizeSettings(stored: any): AppSettings {
        const defaults = this.defaultSettings();
        return {
            workspaceName: typeof stored?.workspaceName === 'string' ? stored.workspaceName : defaults.workspaceName,
            storagePath: typeof stored?.storagePath === 'string' ? stored.storagePath : defaults.storagePath,
            theme: this.normalizeTheme(stored?.theme),
            editorMode: this.normalizeEditorMode(stored?.editorMode),
            autoSave: typeof stored?.autoSave === 'boolean' ? stored.autoSave : defaults.autoSave,
            tabSize: this.normalizeTabSize(stored?.tabSize)
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

    private async ensureDefaultStoragePath() {
        const api = this.storageApi();
        if (!api?.defaultPath) return;

        const result = await api.defaultPath();
        if (result?.ok && result.storagePath && this.shouldUseDefaultStoragePath(result.storagePath)) {
            this.settings.storagePath = result.storagePath;
            this.saveSettings();
        }
    }

    private shouldUseDefaultStoragePath(defaultPath: string) {
        if (!this.settings.storagePath) return true;
        const legacyPath = defaultPath.replace(/ Notes$/, '');
        return this.sameStoredPath(this.settings.storagePath, '~/Documents/Notedown')
            || this.sameStoredPath(this.settings.storagePath, legacyPath);
    }

    private sameStoredPath(left: string, right: string) {
        return String(left || '').replace(/\/+$/g, '').toLowerCase() === String(right || '').replace(/\/+$/g, '').toLowerCase();
    }

    private async runStorageAction(actionName: StorageAction, progressMessage: string, action: () => Promise<void>) {
        if (this.storageBusy) return;
        this.storageBusy = true;
        this.storageAction = actionName;
        this.setStorageMessage(progressMessage, 'info');
        await this.service.render();
        try {
            await action();
        } catch (error) {
            this.setStorageMessage(this.errorMessage(error, '저장소 작업 중 오류가 발생했습니다.'), 'error');
        } finally {
            this.storageAction = '';
            this.storageBusy = false;
            await this.service.render();
        }
    }

    private applyStorageFallback(message: string, tone: StorageMessageTone) {
        const summary = this.localNoteSummary();
        this.storageInfo = {
            storagePath: this.settings.storagePath,
            metadataPath: this.settings.storagePath ? `${this.settings.storagePath}/metadata.json` : '',
            metadataExists: false,
            notes: summary.notes,
            workspaces: summary.workspaces,
            shallowMarkdownCount: 0,
            deepMarkdownCount: 0
        };
        this.setStorageMessage(message, tone);
    }

    private localNoteSummary() {
        try {
            const notes = JSON.parse(localStorage.getItem(this.notesKey) || '[]');
            if (!Array.isArray(notes)) return { notes: 0, workspaces: 0 };
            const workspaces = new Set(notes.map((note: any) => note?.folder || 'memo'));
            return { notes: notes.length, workspaces: workspaces.size };
        } catch (error) {
            return { notes: 0, workspaces: 0 };
        }
    }

    private setStorageMessage(message: string, tone: StorageMessageTone) {
        this.storageMessage = message;
        this.storageMessageTone = tone;
    }

    private errorMessage(error: unknown, fallback: string) {
        return error instanceof Error && error.message ? error.message : fallback;
    }

    private storageApi() {
        return (window as any).notedown?.storage;
    }

    private nowLabel() {
        return new Intl.DateTimeFormat('ko-KR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date());
    }
}
