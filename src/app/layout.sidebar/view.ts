import { HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';

export class Component implements OnInit, OnDestroy {
    private routeSubscription?: Subscription;
    private handleWorkspacePanel = (event: Event) => {
        this.workspacePanelOpen = Boolean((event as CustomEvent<boolean>).detail);
    };

    public mobileOpen = false;
    public isSettingsRoute = false;
    public workspacePanelOpen = false;

    constructor(private router: Router) { }

    public ngOnInit() {
        this.syncRouteState();
        window.addEventListener('notedown:workspace-panel', this.handleWorkspacePanel);
        this.routeSubscription = this.router.events
            .pipe(filter(event => event instanceof NavigationEnd))
            .subscribe(() => this.syncRouteState());
    }

    public ngOnDestroy() {
        window.removeEventListener('notedown:workspace-panel', this.handleWorkspacePanel);
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

    @HostListener('document:keydown.escape')
    public closeOnEscape() {
        this.closeSidebar();
    }

    private syncRouteState() {
        this.isSettingsRoute = this.router.url.startsWith('/settings');
        if (this.isSettingsRoute) {
            this.closeSidebar();
            this.workspacePanelOpen = false;
        }
    }
}
