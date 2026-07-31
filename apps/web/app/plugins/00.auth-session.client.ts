/**
 * Keeps Better Auth's shared session atom mounted for the Nuxt app lifetime.
 *
 * The global route middleware can then await the atom's single automatic
 * request instead of mounting and unmounting the last session subscriber.
 */
export default defineNuxtPlugin(() => {
  useBookAuth();
});
