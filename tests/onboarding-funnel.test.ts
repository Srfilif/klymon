import { describe, expect, it } from 'vitest';
import { ONBOARDING_TOTAL_STEPS } from '@klymon/shared-types';
import { buildOnboardingActivity } from '../apps/desktop/src/main/services/onboarding-funnel';

describe('onboarding funnel', () => {
  it('describes step progress', () => {
    expect(buildOnboardingActivity(0, 'step')).toEqual({ kind: 'onboarding', message: 'Onboarding step 1/6' });
    expect(buildOnboardingActivity(5, 'step')).toEqual({ kind: 'onboarding', message: 'Onboarding step 6/6' });
  });

  it('describes terminal actions', () => {
    expect(buildOnboardingActivity(5, 'finished')).toEqual({ kind: 'onboarding', message: 'Finished onboarding' });
    expect(buildOnboardingActivity(2, 'skipped')).toEqual({ kind: 'onboarding', message: 'Skipped onboarding at step 3/6' });
  });

  it('clamps out-of-range steps defensively', () => {
    expect(buildOnboardingActivity(99, 'step').message).toBe('Onboarding step 6/6');
    expect(buildOnboardingActivity(-4, 'step').message).toBe('Onboarding step 1/6');
  });

  it('shares the step count with the renderer wizard', () => {
    expect(ONBOARDING_TOTAL_STEPS).toBe(6);
  });
});
