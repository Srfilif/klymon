import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Cpu, Languages, LogIn, Rocket, Sparkles, UserRound } from 'lucide-react';
import type { ClientStatus, MemoryAdvice, SystemInfo } from '@klymon/shared-types';
import { invoke, errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { useI18n } from '../lib/i18n';
import { Alert, Spinner, Stat } from '../components/ui/misc';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Field, Input } from '../components/ui/input';

const STEPS = 6;

export function OnboardingPage(): React.JSX.Element {
  const { t } = useI18n();
  const { settings, updateSettings, refreshAccounts, refreshInstances, toast } = useApp();
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState(settings?.language ?? 'es');
  const [dataDirectory, setDataDirectory] = useState(settings?.dataDirectory ?? '');
  const [accountMode, setAccountMode] = useState<'none' | 'offline' | 'microsoft'>('none');
  const [offlineName, setOfflineName] = useState('');
  const [memory, setMemory] = useState(settings?.defaultMemoryMb ?? 4096);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [advice, setAdvice] = useState<MemoryAdvice | null>(null);
  const [client, setClient] = useState<ClientStatus | null>(null);
  const [javaReady, setJavaReady] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [device, setDevice] = useState<{ flowId: string; userCode: string; verificationUri: string } | null>(null);
  const [accountDone, setAccountDone] = useState(false);
  const [installClient, setInstallClient] = useState(true);

  useEffect(() => {
    void invoke('system:info').then(setSystem).catch(() => undefined);
    void invoke('system:memory-advice')
      .then((value) => {
        setAdvice(value);
        setMemory((current) => (current === 4096 ? value.recommendedMb : current));
      })
      .catch(() => undefined);
    void invoke('client:status')
      .then(setClient)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void invoke('java:detect')
      .then((runtimes) => setJavaReady(runtimes.length > 0))
      .catch(() => setJavaReady(false));
  }, []);

  const finish = async (): Promise<void> => {
    setCreating(true);
    try {
      await updateSettings({
        language: language as 'es' | 'en',
        defaultMemoryMb: memory,
        onboardingCompleted: true,
      });
      if (installClient) {
        // Kick off the install in the background: onboarding closes immediately
        // and the Home card shows live progress.
        void invoke('client:install')
          .then(() => refreshInstances())
          .catch((error: unknown) => toast(errorMessage(error), 'error'));
      }
      await refreshAccounts();
      await refreshInstances();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setCreating(false);
    }
  };

  const createOffline = async (): Promise<void> => {
    try {
      await invoke('accounts:create-offline', { name: offlineName });
      setAccountDone(true);
      setAccountMode('offline');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const startMicrosoft = async (): Promise<void> => {
    try {
      const info = await invoke('accounts:begin-microsoft');
      setDevice({ flowId: info.flowId, userCode: info.userCode, verificationUri: info.verificationUri });
      void invoke('app:open-external', { url: info.verificationUri }).catch(() => undefined);
      await invoke('accounts:await-microsoft', { flowId: info.flowId });
      setAccountDone(true);
      setAccountMode('microsoft');
      setDevice(null);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  const pickDirectory = async (): Promise<void> => {
    try {
      const directory = await invoke('app:pick-directory', { title: t('onboarding.directory') });
      if (directory) setDataDirectory(directory);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };

  return (
    <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto p-8">
      <Card className="w-full max-w-2xl">
        <CardContent className="flex flex-col gap-5 p-7">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid size-9 place-items-center rounded-md bg-gradient-to-br from-primary to-accent text-base font-black text-white">K</div>
              <div>
                <p className="text-sm font-semibold">Klymon Launcher</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {t('onboarding.step')} {step + 1} / {STEPS}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void updateSettings({ onboardingCompleted: true })}>
              {t('onboarding.skip')}
            </Button>
          </div>

          {step === 0 ? (
            <div className="flex flex-col gap-3">
              <Sparkles className="size-7 text-primary" />
              <h1 className="text-xl font-semibold">{t('onboarding.welcome')}</h1>
              <p className="text-xs text-muted-foreground">{t('onboarding.welcomeText')}</p>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-3">
              <Languages className="size-6 text-primary" />
              <h2 className="text-lg font-semibold">{t('onboarding.language')}</h2>
              <div className="grid grid-cols-2 gap-2">
                {(['es', 'en'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setLanguage(value);
                      void updateSettings({ language: value });
                    }}
                    className={`focus-ring rounded-md border px-4 py-3 text-sm font-medium ${
                      language === value ? 'border-primary/60 bg-primary/10' : 'border-border'
                    }`}
                  >
                    {value === 'es' ? 'Español' : 'English'}
                  </button>
                ))}
              </div>
              <Field label={t('onboarding.directory')} hint={t('onboarding.directoryHint')}>
                <div className="flex gap-2">
                  <Input readOnly value={dataDirectory} />
                  <Button variant="outline" onClick={() => void pickDirectory()}>
                    {t('common.browse')}
                  </Button>
                </div>
              </Field>
              <p className="text-[10px] text-muted-foreground">{t('settings.dataDirectoryHint')}</p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-3">
              <Cpu className="size-6 text-primary" />
              <h2 className="text-lg font-semibold">{t('onboarding.hardware')}</h2>
              {system ? (
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="CPU" value={system.cpuModel} hint={`${system.cpuCores} cores`} />
                  <Stat label="RAM" value={`${system.totalMemoryMb} MB`} />
                  <Stat label="GPU" value={system.gpus[0] ?? '—'} />
                  <Stat label="OS" value={`${system.platform} ${system.arch}`} hint={system.release} />
                </div>
              ) : (
                <Spinner />
              )}
              <Field label={`${t('onboarding.memory')} · ${memory} MB`} hint={advice ? `${advice.profile} · max ${advice.maximumMb} MB` : undefined}>
                <input
                  type="range"
                  min={1024}
                  max={Math.max(advice?.maximumMb ?? 8192, 2048)}
                  step={512}
                  value={memory}
                  onChange={(event) => setMemory(Number(event.target.value))}
                  className="w-full accent-[var(--primary)]"
                />
              </Field>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-3">
              <UserRound className="size-6 text-primary" />
              <h2 className="text-lg font-semibold">{t('onboarding.account')}</h2>
              <p className="text-xs text-muted-foreground">{t('onboarding.accountHint')}</p>
              {accountDone ? (
                <Alert variant="success">
                  <Check className="inline size-3" /> {t('accounts.active')}
                </Alert>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Input value={offlineName} onChange={(event) => setOfflineName(event.target.value)} placeholder={t('accounts.offlineName')} maxLength={16} />
                    <Button onClick={() => void createOffline()} disabled={offlineName.trim().length < 3}>
                      {t('accounts.addOffline')}
                    </Button>
                  </div>
                  <Button variant="outline" onClick={() => void startMicrosoft()}>
                    <LogIn className="size-4" /> {t('accounts.addMicrosoft')}
                  </Button>
                  {device ? (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-primary/40 bg-primary/10 p-3">
                      <p className="text-[11px] text-muted-foreground">{t('accounts.deviceCode')}</p>
                      <p className="select-all font-mono text-xl font-bold tracking-[0.3em] text-primary">{device.userCode}</p>
                      <Spinner label={t('accounts.waiting')} />
                    </div>
                  ) : null}
                  <p className="text-[10px] text-muted-foreground">{t('accounts.offlineHint')}</p>
                </div>
              )}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="flex flex-col gap-3">
              <Rocket className="size-6 text-primary" />
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{t('onboarding.clientTitle')}</h2>
                <Badge variant="success">{t('client.recommended')}</Badge>
                <Badge variant="outline">Minecraft {client?.mcVersion ?? '1.21.1'}</Badge>
                <Badge variant="muted">Fabric</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{t('onboarding.clientHint', { mods: client?.modsExpected ?? 16 })}</p>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={installClient} onChange={(event) => setInstallClient(event.target.checked)} className="accent-[var(--primary)]" />
                {t('onboarding.installClient')}
              </label>
              <p className="text-[10px] text-muted-foreground">{t('onboarding.clientSize', { version: client?.mcVersion ?? '1.21.1' })}</p>
              <div className="flex items-center gap-2">
                <Badge variant={javaReady ? 'success' : 'warning'}>{javaReady === null ? '…' : javaReady ? 'Java ✓' : 'Java ✗'}</Badge>
                <p className="text-[11px] text-muted-foreground">{t('onboarding.javaHint')}</p>
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="flex flex-col gap-3">
              <Check className="size-7 text-success" />
              <h2 className="text-lg font-semibold">{t('onboarding.ready')}</h2>
              <p className="text-xs text-muted-foreground">{t('onboarding.readyHint')}</p>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <Stat label={t('settings.language')} value={language === 'es' ? 'Español' : 'English'} />
                <Stat label={t('onboarding.memory')} value={`${memory} MB`} />
                <Stat label="Minecraft" value={client?.mcVersion ?? '1.21.1'} />
                <Stat label={t('accounts.title')} value={accountDone ? '✓' : '—'} />
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button variant="ghost" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}>
              <ArrowLeft className="size-4" /> {t('common.back')}
            </Button>
            {step < STEPS - 1 ? (
              <Button onClick={() => setStep((value) => Math.min(STEPS - 1, value + 1))}>
                {t('common.continue')} <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button onClick={() => void finish()} loading={creating}>
                <Check className="size-4" /> {t('common.finish')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
