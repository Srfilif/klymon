import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { I18nProvider, useI18n } from './lib/i18n';
import { AppProvider, useApp } from './lib/app-context';
import { MusicProvider } from './lib/music-context';
import { Shell } from './components/layout/Shell';
import { Spinner } from './components/ui/misc';
import { HomePage } from './pages/HomePage';
import { PlayPage } from './pages/PlayPage';
import { VersionsPage } from './pages/VersionsPage';
import { InstancesPage } from './pages/InstancesPage';
import { ModsPage, ModpacksPage, ResourcePacksPage, ShadersPage } from './pages/ContentPages';
import { AccountsPage } from './pages/AccountsPage';
import { SkinsPage } from './pages/SkinsPage';
import { MusicPage } from './pages/MusicPage';
import { NewsPage } from './pages/NewsPage';
import { SettingsPage } from './pages/SettingsPage';
import { OnboardingPage } from './pages/OnboardingPage';

function Gate(): React.JSX.Element {
  const { ready, settings } = useApp();
  const { t } = useI18n();

  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }

  if (settings && !settings.onboardingCompleted) {
    return <OnboardingPage />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="play" element={<PlayPage />} />
          <Route path="versions" element={<VersionsPage />} />
          <Route path="instances" element={<InstancesPage />} />
          <Route path="mods" element={<ModsPage />} />
          <Route path="modpacks" element={<ModpacksPage />} />
          <Route path="resourcepacks" element={<ResourcePacksPage />} />
          <Route path="shaders" element={<ShadersPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="skins" element={<SkinsPage />} />
          <Route path="music" element={<MusicPage />} />
          <Route path="news" element={<NewsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export function App(): React.JSX.Element {
  return (
    <I18nProvider>
      <AppProvider>
        <MusicProvider>
          <Gate />
        </MusicProvider>
      </AppProvider>
    </I18nProvider>
  );
}
