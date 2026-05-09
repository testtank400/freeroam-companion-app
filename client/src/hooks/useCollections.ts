// useCollections.ts
// Local-only collections backed by localStorage.
// A collection is { id, name, characterIds[] }.
// When Freeroam adds a character collections API, this can be migrated.

import { useCallback, useEffect, useState } from 'react';

export interface Collection {
  id: string;
  name: string;
  characterIds: string[];
  createdAt: number;
}

const STORAGE_KEY = 'character_collections';

function loadCollections(): Collection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Collection[];
  } catch {
    return [];
  }
}

function persistCollections(collections: Collection[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
  } catch {
    // ignore storage errors
  }
}

function generateId(): string {
  return `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function useCollections() {
  const [collections, setCollections] = useState<Collection[]>(() => loadCollections());

  // Persist on every change
  useEffect(() => {
    persistCollections(collections);
  }, [collections]);

  // Create a new collection
  const createCollection = useCallback((name: string): Collection => {
    const newCol: Collection = {
      id: generateId(),
      name: name.trim(),
      characterIds: [],
      createdAt: Date.now(),
    };
    setCollections(prev => [newCol, ...prev]);
    return newCol;
  }, []);

  // Rename a collection
  const renameCollection = useCallback((id: string, name: string) => {
    setCollections(prev =>
      prev.map(c => c.id === id ? { ...c, name: name.trim() } : c)
    );
  }, []);

  // Delete a collection
  const deleteCollection = useCallback((id: string) => {
    setCollections(prev => prev.filter(c => c.id !== id));
  }, []);

  // Add a character to a collection (no-op if already present)
  const addToCollection = useCallback((collectionId: string, characterId: string) => {
    setCollections(prev =>
      prev.map(c =>
        c.id === collectionId && !c.characterIds.includes(characterId)
          ? { ...c, characterIds: [...c.characterIds, characterId] }
          : c
      )
    );
  }, []);

  // Remove a character from a collection
  const removeFromCollection = useCallback((collectionId: string, characterId: string) => {
    setCollections(prev =>
      prev.map(c =>
        c.id === collectionId
          ? { ...c, characterIds: c.characterIds.filter(id => id !== characterId) }
          : c
      )
    );
  }, []);

  // Toggle a character's membership in a collection
  const toggleInCollection = useCallback((collectionId: string, characterId: string) => {
    setCollections(prev =>
      prev.map(c => {
        if (c.id !== collectionId) return c;
        const has = c.characterIds.includes(characterId);
        return {
          ...c,
          characterIds: has
            ? c.characterIds.filter(id => id !== characterId)
            : [...c.characterIds, characterId],
        };
      })
    );
  }, []);

  // Check if a character is in a specific collection
  const isInCollection = useCallback(
    (collectionId: string, characterId: string) =>
      collections.find(c => c.id === collectionId)?.characterIds.includes(characterId) ?? false,
    [collections]
  );

  // Get all collection IDs a character belongs to
  const getCharacterCollections = useCallback(
    (characterId: string) =>
      collections.filter(c => c.characterIds.includes(characterId)).map(c => c.id),
    [collections]
  );

  return {
    collections,
    createCollection,
    renameCollection,
    deleteCollection,
    addToCollection,
    removeFromCollection,
    toggleInCollection,
    isInCollection,
    getCharacterCollections,
  };
}
