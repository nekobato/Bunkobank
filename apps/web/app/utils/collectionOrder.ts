/**
 * Moves one id by a single position without mutating the source order.
 */
export const moveCollectionBook = (
  bookIds: readonly string[],
  bookId: string,
  direction: -1 | 1
): string[] => {
  const currentIndex = bookIds.indexOf(bookId);
  const nextIndex = currentIndex + direction;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= bookIds.length) {
    return [...bookIds];
  }

  const reordered = [...bookIds];
  [reordered[currentIndex], reordered[nextIndex]] = [
    reordered[nextIndex] as string,
    reordered[currentIndex] as string
  ];
  return reordered;
};
