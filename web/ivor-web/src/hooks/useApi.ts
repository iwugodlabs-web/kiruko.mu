"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../components/Toast';

interface ApiResponse<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface UseApiOptions {
  enabled?: boolean;
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
  cacheTime?: number;
  staleTime?: number;
}

const cache = new Map<string, { data: any; timestamp: number }>();

export function useApi<T>(
  url: string | null,
  options: UseApiOptions = {}
): ApiResponse<T> {
  const {
    enabled = true,
    onSuccess,
    onError,
    cacheTime = 5 * 60 * 1000, // 5 minutes
    staleTime = 30 * 1000 // 30 seconds
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { error: showErrorToast } = useToast();

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (force = false) => {
    if (!enabled || !url) return;

    // Check cache
    const cached = cache.get(url);
    if (!force && cached && Date.now() - cached.timestamp < staleTime) {
      setData(cached.data);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(url, {
        signal: abortControllerRef.current.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      // Cache the result
      cache.set(url, { data: result, timestamp: Date.now() });

      // Clean up old cache entries
      for (const [key, value] of cache.entries()) {
        if (Date.now() - value.timestamp > cacheTime) {
          cache.delete(key);
        }
      }

      setData(result);
      setLoading(false);

      if (onSuccess) {
        onSuccess(result);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return; // Request was cancelled
      }

      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
      setLoading(false);

      if (onError) {
        onError(errorMessage);
      } else {
        showErrorToast('Error', errorMessage);
      }
    }
  }, [url, enabled, staleTime, cacheTime, onSuccess, onError, showErrorToast]);

  const refetch = useCallback(() => {
    fetchData(true);
  }, [fetchData]);

  useEffect(() => {
    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData]);

  return { data, loading, error, refetch };
}

interface UseMutationOptions<TData, TVariables> {
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: string, variables: TVariables) => void;
  onSettled?: (data: TData | undefined, error: string | null, variables: TVariables) => void;
}

interface MutationResult<TData, TVariables> {
  mutate: (variables: TVariables) => Promise<TData | undefined>;
  data: TData | undefined;
  loading: boolean;
  error: string | null;
  reset: () => void;
}

export function useMutation<TData = any, TVariables = any>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: UseMutationOptions<TData, TVariables> = {}
): MutationResult<TData, TVariables> {
  const { onSuccess, onError, onSettled } = options;
  const [data, setData] = useState<TData | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { success: showSuccessToast, error: showErrorToast } = useToast();

  const mutate = useCallback(async (variables: TVariables): Promise<TData | undefined> => {
    setLoading(true);
    setError(null);

    try {
      const result = await mutationFn(variables);
      setData(result);
      setLoading(false);

      if (onSuccess) {
        onSuccess(result, variables);
      }

      if (onSettled) {
        onSettled(result, null, variables);
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);
      setLoading(false);

      if (onError) {
        onError(errorMessage, variables);
      } else {
        showErrorToast('Error', errorMessage);
      }

      if (onSettled) {
        onSettled(undefined, errorMessage, variables);
      }

      throw err;
    }
  }, [mutationFn, onSuccess, onError, onSettled, showErrorToast]);

  const reset = useCallback(() => {
    setData(undefined);
    setError(null);
    setLoading(false);
  }, []);

  return { mutate, data, loading, error, reset };
}

// Utility hook for optimistic updates
export function useOptimisticUpdate<T>(
  initialData: T,
  updateFn: (newData: T) => Promise<T>
) {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { error: showErrorToast } = useToast();

  const update = useCallback(async (newData: T) => {
    const previousData = data;
    setData(newData); // Optimistic update
    setLoading(true);
    setError(null);

    try {
      const result = await updateFn(newData);
      setData(result);
      setLoading(false);
    } catch (err) {
      setData(previousData); // Revert on error
      const errorMessage = err instanceof Error ? err.message : 'Update failed';
      setError(errorMessage);
      setLoading(false);
      showErrorToast('Update Failed', errorMessage);
    }
  }, [data, updateFn, showErrorToast]);

  return { data, loading, error, update };
}