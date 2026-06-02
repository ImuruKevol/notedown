import { OnInit } from '@angular/core';
import { Service } from '@wiz/libs/portal/season/service';

type ThemeMode = 'light' | 'dark' | 'system';
type EditorMode = 'markdown' | 'split' | 'preview';
type ToggleKey = 'autoSave' | 'syncAutoUpload';
type StorageAction = '' | 'choose' | 'refresh' | 'initialize' | 'import';
type SyncAction = '' | 'health' | 'setup' | 'login' | 'plan' | 'run';
type StorageMessageTone = 'info' | 'success' | 'warning' | 'error';

interface AppSettings {
    workspaceName: string;
    storagePath: string;
    theme: ThemeMode;
    editorMode: EditorMode;
    autoSave: boolean;
    tabSize: number;
    syncServerUrl: string;
    syncUsername: string;
    syncToken: string;
    syncTokenType: string;
    syncClientId: string;
    syncAutoUpload: boolean;
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

interface SyncPlanSummary {
    uploadFiles: number;
    downloadFiles: number;
    deleteServerFiles: number;
    deleteLocalFiles: number;
    conflicts: number;
}

interface SyncConflict {
    relativePath: string;
    reason?: string;
    type?: string;
    clientRevision?: number;
    serverRevision?: number;
    serverFile?: any;
    serverNote?: any;
    clientNote?: any;
    clientWorkspace?: any;
    serverWorkspace?: any;
}

interface SyncConflictDetail {
    relativePath: string;
    localExists?: boolean;
    localContent?: string;
    localNote?: any;
    localError?: string;
    serverContent?: string;
    serverFile?: any;
    serverError?: string;
}

export class Component implements OnInit {
    private storageKey = 'notedown.settings.v1';
    private notesKey = 'notedown.notes.v1';
    private startupSyncResultKey = 'notedown.sync.startup.result.v1';

    public activeSection = 'general';
    public savedAt = '';
    public storageBusy = false;
    public storageAction: StorageAction = '';
    public storageMessage = '';
    public storageMessageTone: StorageMessageTone = 'info';
    public storageInfo: StorageInfo = {};
    public syncBusy = false;
    public syncAction: SyncAction = '';
    public syncPassword = '';
    public syncMessage = '';
    public syncMessageTone: StorageMessageTone = 'info';
    public syncPlanSummary: SyncPlanSummary | null = null;
    public syncConflicts: SyncConflict[] = [];
    public selectedSyncConflictIndex = 0;
    public syncConflictDetail: SyncConflictDetail | null = null;
    public syncConflictBusy = false;
    public sections = [
        { id: 'general', label: '일반' },
        { id: 'storage', label: '저장소' },
        { id: 'sync', label: '동기화' }
    ];
    public settings: AppSettings = this.defaultSettings();

    constructor(public service: Service) { }

    public async ngOnInit() {
        this.loadSettings();
        this.applyStartupSyncResult();
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
        this.syncPassword = '';
        this.syncPlanSummary = null;
        this.clearSyncConflicts();
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

    public syncStatusLabel() {
        if (this.hasSyncConflicts()) return '충돌';
        if (this.hasSyncToken()) return '로그인됨';
        if (this.settings.syncUsername) return '로그인 필요';
        return '미설정';
    }

    public syncStatusClass() {
        const base = 'inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold';
        if (this.hasSyncConflicts()) return `${base} bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300`;
        if (this.hasSyncToken()) return `${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300`;
        if (this.settings.syncUsername) return `${base} bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300`;
        return `${base} bg-stone-100 text-stone-600 dark:bg-zinc-800 dark:text-zinc-300`;
    }

    public syncMessageClass() {
        const base = 'mt-2 min-h-5 text-[12px]';
        if (this.syncMessageTone === 'success') return `${base} text-emerald-700 dark:text-emerald-300`;
        if (this.syncMessageTone === 'warning') return `${base} text-amber-700 dark:text-amber-300`;
        if (this.syncMessageTone === 'error') return `${base} text-red-600 dark:text-red-300`;
        return `${base} text-stone-400 dark:text-zinc-500`;
    }

    public hasSyncConflicts() {
        return this.syncConflicts.length > 0;
    }

    public selectedSyncConflict() {
        return this.syncConflicts[this.selectedSyncConflictIndex] || this.syncConflicts[0] || null;
    }

    public selectSyncConflict(index: number) {
        if (index < 0 || index >= this.syncConflicts.length) return;
        this.selectedSyncConflictIndex = index;
        this.syncConflictDetail = null;
        void this.loadSyncConflictDetail();
    }

    public syncConflictButtonClass(index: number) {
        const base = 'flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors';
        if (this.selectedSyncConflictIndex === index) return `${base} bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100`;
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
        return reason || '충돌 상세 정보가 필요합니다.';
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

    public async testSyncServer() {
        const api = this.syncApi();
        if (!api?.health) {
            this.setSyncMessage('동기화는 Electron 앱에서 사용할 수 있습니다.', 'warning');
            await this.service.render();
            return;
        }

        await this.runSyncAction('health', '동기화 서버에 연결하는 중입니다...', async () => {
            const result = await api.health({ serverUrl: this.settings.syncServerUrl });
            if (result?.ok) {
                this.setSyncMessage('동기화 서버에 연결되었습니다.', 'success');
                return;
            }
            this.setSyncMessage(result?.error || '동기화 서버에 연결하지 못했습니다.', 'error');
        });
    }

    public async setupSyncServer() {
        const api = this.syncApi();
        if (!api?.setup) {
            this.setSyncMessage('초기 설정은 Electron 앱에서 사용할 수 있습니다.', 'warning');
            await this.service.render();
            return;
        }
        if (!this.validSyncCredential()) return;

        await this.runSyncAction('setup', '동기화 서버 계정을 생성하는 중입니다...', async () => {
            const result = await api.setup(this.syncPayload({ password: this.syncPassword }));
            if (result?.ok && result.accessToken) {
                this.storeSyncToken(result);
                this.syncPassword = '';
                this.setSyncMessage('동기화 서버 초기 설정이 완료되었습니다.', 'success');
                return;
            }
            this.setSyncMessage(result?.error || '동기화 서버 초기 설정에 실패했습니다.', 'error');
        });
    }

    public async loginSyncServer() {
        const api = this.syncApi();
        if (!api?.login) {
            this.setSyncMessage('동기화 서버 로그인은 Electron 앱에서 사용할 수 있습니다.', 'warning');
            await this.service.render();
            return;
        }
        if (!this.validSyncCredential()) return;

        await this.runSyncAction('login', '동기화 서버에 로그인하는 중입니다...', async () => {
            const result = await api.login(this.syncPayload({ password: this.syncPassword }));
            if (result?.ok && result.accessToken) {
                this.storeSyncToken(result);
                this.syncPassword = '';
                this.setSyncMessage('동기화 서버에 로그인했습니다.', 'success');
                return;
            }
            this.setSyncMessage(result?.error || '동기화 서버 로그인에 실패했습니다.', 'error');
        });
    }

    public logoutSyncServer() {
        this.settings.syncToken = '';
        this.settings.syncTokenType = '';
        this.syncPlanSummary = null;
        this.clearSyncConflicts();
        this.saveSettings();
        this.setSyncMessage('동기화 서버 로그인을 해제했습니다.', 'info');
    }

    public async planSync() {
        const api = this.syncApi();
        if (!api?.plan) {
            this.setSyncMessage('동기화 계획은 Electron 앱에서 사용할 수 있습니다.', 'warning');
            await this.service.render();
            return;
        }
        if (!this.ensureSyncReady()) return;

        await this.runSyncAction('plan', '서버 메타데이터와 비교하는 중입니다...', async () => {
            const result = await api.plan(this.syncPayload());
            if (result?.ok) {
                this.syncPlanSummary = result.summary;
                this.setSyncConflictsFromResult(result);
                this.setSyncMessage(this.syncSummaryMessage(result.summary), this.syncConflictCount(result) > 0 ? 'warning' : 'success');
                return;
            }
            this.setSyncMessage(result?.error || '동기화 계획을 만들지 못했습니다.', 'error');
        });
    }

    public async runFullSync() {
        const api = this.syncApi();
        if (!api?.runFull) {
            this.setSyncMessage('전체 동기화는 Electron 앱에서 사용할 수 있습니다.', 'warning');
            await this.service.render();
            return;
        }
        if (!this.ensureSyncReady()) return;

        await this.runSyncAction('run', '전체 동기화를 실행하는 중입니다...', async () => {
            const result = await api.runFull(this.syncPayload());
            if (result?.summary) this.syncPlanSummary = result.summary;
            const conflictCount = this.syncConflictCount(result);
            if (result?.status === 'conflict' || conflictCount > 0) {
                this.setSyncConflictsFromResult(result);
                this.setSyncMessage(`충돌 ${conflictCount || 1}건이 있어 자동 적용하지 않았습니다.`, 'warning');
                return;
            }
            if (result?.ok) {
                this.clearSyncConflicts();
                const operations = result.operations || {};
                const message = [
                    `업로드 ${operations.uploaded?.length || 0}`,
                    `다운로드 ${operations.downloaded?.length || 0}`,
                    `서버 삭제 ${operations.deletedServer?.length || 0}`,
                    `로컬 삭제 ${operations.deletedLocal?.length || 0}`
                ].join(', ');
                this.setSyncMessage(`전체 동기화가 완료되었습니다. ${message}`, 'success');
                window.dispatchEvent(new CustomEvent('notedown:notes-changed'));
                await this.refreshStorageInfo();
                return;
            }
            this.setSyncMessage(result?.error || '전체 동기화에 실패했습니다.', 'error');
        });
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
            tabSize: 2,
            syncServerUrl: 'http://172.16.0.143:5500',
            syncUsername: '',
            syncToken: '',
            syncTokenType: '',
            syncClientId: this.createClientId(),
            syncAutoUpload: false
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
            tabSize: this.normalizeTabSize(stored?.tabSize),
            syncServerUrl: typeof stored?.syncServerUrl === 'string' ? stored.syncServerUrl : defaults.syncServerUrl,
            syncUsername: typeof stored?.syncUsername === 'string' ? stored.syncUsername : defaults.syncUsername,
            syncToken: typeof stored?.syncToken === 'string' ? stored.syncToken : defaults.syncToken,
            syncTokenType: typeof stored?.syncTokenType === 'string' ? stored.syncTokenType : defaults.syncTokenType,
            syncClientId: typeof stored?.syncClientId === 'string' && stored.syncClientId ? stored.syncClientId : defaults.syncClientId,
            syncAutoUpload: typeof stored?.syncAutoUpload === 'boolean' ? stored.syncAutoUpload : defaults.syncAutoUpload
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

    private async runSyncAction(actionName: SyncAction, progressMessage: string, action: () => Promise<void>) {
        if (this.syncBusy) return;
        this.syncBusy = true;
        this.syncAction = actionName;
        this.setSyncMessage(progressMessage, 'info');
        await this.service.render();
        try {
            await action();
        } catch (error) {
            this.setSyncMessage(this.errorMessage(error, '동기화 작업 중 오류가 발생했습니다.'), 'error');
        } finally {
            this.syncAction = '';
            this.syncBusy = false;
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

    private setSyncMessage(message: string, tone: StorageMessageTone) {
        this.syncMessage = message;
        this.syncMessageTone = tone;
    }

    private applyStartupSyncResult() {
        if (!this.hasSyncToken()) return;
        try {
            const result = JSON.parse(localStorage.getItem(this.startupSyncResultKey) || '{}');
            if (!result?.syncedAtMs || Date.now() - Number(result.syncedAtMs) > 30 * 60 * 1000) return;
            if (result.summary) this.syncPlanSummary = result.summary;
            const conflictCount = this.syncConflictCount(result);
            if (result.status === 'running') {
                this.setSyncMessage('앱 시작 동기화가 진행 중입니다.', 'info');
                return;
            }
            if (result.status === 'conflict' || conflictCount > 0) {
                this.activeSection = 'sync';
                this.setSyncConflictsFromResult(result);
                this.setSyncMessage(`시작 동기화에서 충돌 ${conflictCount || 1}건이 감지되었습니다.`, 'warning');
                return;
            }
            if (result.ok) {
                this.clearSyncConflicts();
                this.setSyncMessage('앱 시작 시 서버 메타데이터 기준 동기화를 완료했습니다.', 'success');
                return;
            }
            if (result.error) this.setSyncMessage(result.error, 'error');
        } catch (error) {
            // Ignore malformed startup sync status.
        }
    }

    private syncConflictCount(result: any) {
        return Number(result?.summary?.conflicts)
            || result?.conflicts?.length
            || result?.plan?.conflicts?.length
            || result?.operations?.conflicts?.length
            || 0;
    }

    private setSyncConflictsFromResult(result: any) {
        this.syncConflicts = this.extractSyncConflicts(result);
        if (this.syncConflicts.length === 0 && this.syncConflictCount(result) > 0) {
            this.syncConflicts = [{ relativePath: '', reason: 'conflict' }];
        }
        this.selectedSyncConflictIndex = 0;
        this.syncConflictDetail = null;
    }

    private clearSyncConflicts() {
        this.syncConflicts = [];
        this.selectedSyncConflictIndex = 0;
        this.syncConflictDetail = null;
        this.syncConflictBusy = false;
    }

    private extractSyncConflicts(result: any): SyncConflict[] {
        const items = [
            ...(Array.isArray(result?.conflicts) ? result.conflicts : []),
            ...(Array.isArray(result?.plan?.conflicts) ? result.plan.conflicts : []),
            ...(Array.isArray(result?.operations?.conflicts) ? result.operations.conflicts : [])
        ];
        const conflicts = new Map<string, SyncConflict>();
        for (const rawItem of items) {
            const item = rawItem?.file || rawItem;
            const relativePath = item?.relativePath || item?.serverFile?.relativePath || '';
            if (!relativePath) continue;
            const conflict: SyncConflict = {
                relativePath,
                reason: item.reason || item.status || '',
                type: item.type || '',
                clientRevision: item.clientRevision,
                serverRevision: item.serverRevision,
                serverFile: item.serverFile || null,
                serverNote: item.serverNote || null,
                clientNote: item.clientNote || null,
                clientWorkspace: item.clientWorkspace || null,
                serverWorkspace: item.serverWorkspace || null
            };
            conflicts.set(`${relativePath}:${conflict.reason || ''}`, conflict);
        }
        return Array.from(conflicts.values());
    }

    private async loadSyncConflictDetail() {
        const conflict = this.selectedSyncConflict();
        const api = this.syncApi();
        if (!conflict?.relativePath) return;
        if (!api?.readFile) {
            this.syncConflictDetail = null;
            await this.service.render();
            return;
        }

        this.syncConflictBusy = true;
        await this.service.render();
        try {
            const result = await api.readFile(this.syncPayload({ relativePath: conflict.relativePath }));
            if (result?.ok) {
                this.syncConflictDetail = result;
            } else {
                this.syncConflictDetail = {
                    relativePath: conflict.relativePath,
                    serverError: result?.error || '충돌 파일을 읽지 못했습니다.'
                };
            }
        } catch (error) {
            this.syncConflictDetail = {
                relativePath: conflict.relativePath,
                serverError: this.errorMessage(error, '충돌 파일을 읽지 못했습니다.')
            };
        } finally {
            this.syncConflictBusy = false;
            await this.service.render();
        }
    }

    private syncApi() {
        return (window as any).notedown?.sync;
    }

    private syncPayload(extra: Record<string, unknown> = {}) {
        return {
            serverUrl: this.settings.syncServerUrl,
            username: this.settings.syncUsername,
            token: this.settings.syncToken,
            clientId: this.settings.syncClientId,
            storagePath: this.settings.storagePath,
            ...extra
        };
    }

    public hasSyncToken() {
        return Boolean(this.settings.syncToken);
    }

    private ensureSyncReady() {
        if (!this.settings.storagePath) {
            this.setSyncMessage('저장소 디렉토리를 먼저 선택하세요.', 'warning');
            return false;
        }
        if (!this.hasSyncToken()) {
            this.setSyncMessage('동기화 서버 로그인이 필요합니다.', 'warning');
            return false;
        }
        return true;
    }

    private validSyncCredential() {
        if (!this.settings.syncServerUrl.trim()) {
            this.setSyncMessage('동기화 서버 URL을 입력하세요.', 'warning');
            return false;
        }
        if (!this.settings.syncUsername.trim()) {
            this.setSyncMessage('사용자 이름을 입력하세요.', 'warning');
            return false;
        }
        if (this.syncPassword.length < 8) {
            this.setSyncMessage('비밀번호는 8자 이상이어야 합니다.', 'warning');
            return false;
        }
        return true;
    }

    private storeSyncToken(result: any) {
        this.settings.syncToken = result.accessToken || '';
        this.settings.syncTokenType = result.tokenType || 'Bearer';
        this.saveSettings();
    }

    private syncSummaryMessage(summary: SyncPlanSummary) {
        return [
            `업로드 ${summary.uploadFiles}`,
            `다운로드 ${summary.downloadFiles}`,
            `서버 삭제 ${summary.deleteServerFiles}`,
            `로컬 삭제 ${summary.deleteLocalFiles}`,
            `충돌 ${summary.conflicts}`
        ].join(', ');
    }

    private createClientId() {
        return `notedown-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
