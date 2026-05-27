// SPDX-License-Identifier: Apache-2.0
/**
 * Read + patch hooks for the Settings route. The Settings form mutates
 * a local draft; on Save, `useUpdateSettings` flushes the patch and
 * the resulting record replaces the cached read so the form rehydrates
 * from authoritative data.
 */
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type DockProjectSettings, useTransport } from '../transport';

const KEY = ['settings'] as const;

export function useSettings(): UseQueryResult<DockProjectSettings> {
  const transport = useTransport();
  return useQuery({
    queryKey: [...KEY, transport.kind],
    queryFn: () => transport.getSettings(),
  });
}

export function useUpdateSettings(): UseMutationResult<
  DockProjectSettings,
  Error,
  Partial<DockProjectSettings>
> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<DockProjectSettings>) => transport.updateSettings(patch),
    onSuccess: (data) => qc.setQueryData([...KEY, transport.kind], data),
  });
}
