import { ONBOARDING_TOTAL_STEPS, type OnboardingFunnelAction } from '@klymon/shared-types';

/**
 * First-run funnel copy (pure, no Electron imports so the tests cover it).
 * The renderer reports wizard progress through `onboarding:event`; this
 * builds the activity rows that make drop-off visible on the Home timeline.
 */
export function buildOnboardingActivity(
  step: number,
  action: OnboardingFunnelAction,
): { kind: 'onboarding'; message: string } {
  const shown = Math.max(0, Math.min(Math.floor(step), ONBOARDING_TOTAL_STEPS - 1)) + 1;
  if (action === 'finished') {
    return { kind: 'onboarding', message: 'Finished onboarding' };
  }
  if (action === 'skipped') {
    return { kind: 'onboarding', message: `Skipped onboarding at step ${shown}/${ONBOARDING_TOTAL_STEPS}` };
  }
  return { kind: 'onboarding', message: `Onboarding step ${shown}/${ONBOARDING_TOTAL_STEPS}` };
}
