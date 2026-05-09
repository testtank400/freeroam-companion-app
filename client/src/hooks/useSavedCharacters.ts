// useSavedCharacters.ts
// Tracks which characters are saved/favorited.
// The list API doesn't return a saved flag, so we persist the set of saved IDs
// in localStorage and sync with the server on toggle.

import { trpc } from '@/lib/trpc';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

const STORAGE_KEY = 'saved_character_ids';

function loadSavedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function persistSavedIds(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore storage errors
  }
}

export function useSavedCharacters() {
  const [savedIds, setSavedIds] = useState<Set<string>>(() => loadSavedIds());

  const saveMutation = trpc.characters.save.useMutation();
  const unsaveMutation = trpc.characters.unsave.useMutation();

  // Keep localStorage in sync whenever savedIds changes
  useEffect(() => {
    persistSavedIds(savedIds);
  }, [savedIds]);

  const isSaved = useCallback(
    (characterId: string) => savedIds.has(characterId),
    [savedIds]
  );

  const toggleSave = useCallback(
    async (characterId: string, characterName: string) => {
      const currently = savedIds.has(characterId);

      // Optimistic update
      setSavedIds(prev => {
        const next = new Set(prev);
        if (currently) next.delete(characterId);
        else next.add(characterId);
        return next;
      });

      try {
        if (currently) {
          await unsaveMutation.mutateAsync({ characterId });
          toast.success(`${characterName} removed from favorites`);
        } else {
          await saveMutation.mutateAsync({ characterId });
          toast.success(`${characterName} added to favorites`);
        }
      } catch (err: unknown) {
        // Roll back on error
        setSavedIds(prev => {
          const next = new Set(prev);
          if (currently) next.add(characterId);
          else next.delete(characterId);
          return next;
        });
        toast.error(err instanceof Error ? err.message : 'Failed to update favorite');
      }
    },
    [savedIds, saveMutation, unsaveMutation]
  );

  return { isSaved, toggleSave, savedIds };
}
