import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { Service } from '@wiz/libs/portal/season/service';
import { TranslateService } from '@ngx-translate/core';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
    private readonly settingsKey = 'notedown.settings.v1';

    constructor(
        public service: Service,
        public ref: ChangeDetectorRef,
        public translate: TranslateService
    ) {
        window['MonacoEnvironment'] = {
            getWorkerUrl: function (moduleId: string, label: string) {
                return `/lib/vs/base/worker/workerMain.js`;
            }
        };
    }

    public async ngOnInit() {
        await this.importInstallerSettingsIfNeeded();
        await this.service.init(this);
    }

    private async importInstallerSettingsIfNeeded() {
        if (localStorage.getItem(this.settingsKey)) return;
        const installerSettings = (window as any).notedown?.app?.installerSettings;
        if (!installerSettings) return;
        try {
            const result = await installerSettings();
            if (result?.ok && result.settings) {
                localStorage.setItem(this.settingsKey, JSON.stringify(result.settings));
            }
        } catch (error) {
            // Installation settings are optional; the app can still start with runtime defaults.
        }
    }
}
