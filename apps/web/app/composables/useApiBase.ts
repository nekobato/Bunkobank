/**
 * Returns the configured Bunkobank API base URL.
 */
export const useApiBase = (): string => {
  const config = useRuntimeConfig();
  return config.public.apiBase;
};
