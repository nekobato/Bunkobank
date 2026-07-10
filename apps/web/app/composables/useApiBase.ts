/**
 * Returns the configured BookCafe API base URL.
 */
export const useApiBase = (): string => {
  const config = useRuntimeConfig();
  return config.public.apiBase;
};
