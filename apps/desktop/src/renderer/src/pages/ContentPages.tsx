import { ContentBrowser } from '../components/ContentBrowser';
import { useI18n } from '../lib/i18n';

export function ModsPage(): React.JSX.Element {
  const { t } = useI18n();
  return <ContentBrowser projectType="mod" title={t('nav.mods')} subtitle={t('content.requiresInstance')} />;
}

export function ModpacksPage(): React.JSX.Element {
  const { t } = useI18n();
  return <ContentBrowser projectType="modpack" title={t('nav.modpacks')} subtitle={t('content.modpacksNote')} />;
}

export function ResourcePacksPage(): React.JSX.Element {
  const { t } = useI18n();
  return <ContentBrowser projectType="resourcepack" title={t('nav.resourcepacks')} subtitle={t('content.requiresInstance')} />;
}

export function ShadersPage(): React.JSX.Element {
  const { t } = useI18n();
  return <ContentBrowser projectType="shader" title={t('nav.shaders')} subtitle={t('content.requiresInstance')} />;
}
