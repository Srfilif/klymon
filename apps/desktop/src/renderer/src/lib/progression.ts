import { useCallback } from 'react';
import type { ProgressionProfileModel } from '@klymon/shared-types';
import { invoke, useAsync, useEvent, type AsyncState } from './api';

export function useProgressionProfile(): AsyncState<ProgressionProfileModel> {
  const state = useAsync<ProgressionProfileModel>(() => invoke('progression:profile'), []);
  const reload = state.reload;
  const refresh = useCallback(() => reload(), [reload]);
  useEvent('data:changed', ({ scope }) => {
    if (scope === 'progression') refresh();
  });
  return state;
}
