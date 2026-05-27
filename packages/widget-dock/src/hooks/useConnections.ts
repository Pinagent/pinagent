// SPDX-License-Identifier: Apache-2.0
/**
 * Read + mutate hooks for the Connections route. Mutations invalidate
 * the connections query so the card re-renders against the fresh
 * presentable shape returned by the server.
 */
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type PresentableConnections, useTransport } from '../transport';

const KEY = ['connections'] as const;

export function useConnections(): UseQueryResult<PresentableConnections> {
  const transport = useTransport();
  return useQuery({
    queryKey: [...KEY, transport.kind],
    queryFn: () => transport.getConnections(),
  });
}

export function useSetGithubConnection(): UseMutationResult<PresentableConnections, Error, string> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => transport.setGithubConnection(token),
    onSuccess: (data) => qc.setQueryData([...KEY, transport.kind], data),
  });
}

export function useClearGithubConnection(): UseMutationResult<PresentableConnections, Error, void> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => transport.clearGithubConnection(),
    onSuccess: (data) => qc.setQueryData([...KEY, transport.kind], data),
  });
}

export function useSetAnthropicConnection(): UseMutationResult<
  PresentableConnections,
  Error,
  string
> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => transport.setAnthropicConnection(key),
    onSuccess: (data) => qc.setQueryData([...KEY, transport.kind], data),
  });
}

export function useClearAnthropicConnection(): UseMutationResult<
  PresentableConnections,
  Error,
  void
> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => transport.clearAnthropicConnection(),
    onSuccess: (data) => qc.setQueryData([...KEY, transport.kind], data),
  });
}
