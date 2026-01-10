import useSWR from 'swr';
import { useMemo } from 'react';
import { 
  ProviderMetadata, 
  ProviderMetadataListResponse, 
  MappingGenerateRequest, 
  MappingGenerateResponse 
} from '@/lib/api-types';
import { useApiPost } from './hooks';

/**
 * Hook for managing provider metadata and rules (Admin).
 */
export function useProviderRules() {
  const { data, error, mutate, isLoading } = useSWR<ProviderMetadataListResponse>(
    '/v1/admin/rules'
  );

  const generateMapping = useApiPost<MappingGenerateRequest, MappingGenerateResponse>(
    '/v1/admin/rules/generate-mapping'
  );

  return {
    metadataList: data?.items || [],
    total: data?.total || 0,
    isLoading,
    error,
    mutate,
    generateMapping
  };
}

export function useProviderMetadata(metadataId?: string) {
  const { data, error, mutate, isLoading } = useSWR<ProviderMetadata>(
    metadataId ? `/v1/admin/rules/${metadataId}` : null
  );

  return {
    metadata: data,
    isLoading,
    error,
    mutate
  };
}
