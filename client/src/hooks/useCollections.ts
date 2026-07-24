// useCollections.ts
// DB-backed collections via tRPC.
// Collections are stored in the app database (TiDB/MySQL) and persist across devices.

import { trpc } from "@/lib/trpc";
import { useCallback } from "react";

export interface Collection {
  id: number; // DB integer primary key (was a string in the old localStorage version)
  name: string;
  description?: string | null;
  characterIds: string[];
  createdAt: Date;
  coverImage?: string | null;
  parentId?: number | null; // null = top-level collection
}

export function useCollections() {
  const utils = trpc.useUtils();

  const { data: collections = [], isLoading } = trpc.collections.list.useQuery();

  const createMutation = trpc.collections.create.useMutation({
    onSuccess: () => utils.collections.list.invalidate(),
  });


  const updateMutation = trpc.collections.update.useMutation({
    onSuccess: () => utils.collections.list.invalidate(),
  });

  const deleteMutation = trpc.collections.delete.useMutation({
    onSuccess: () => utils.collections.list.invalidate(),
  });

  const addCharacterMutation = trpc.collections.addCharacter.useMutation({
    onSuccess: () => utils.collections.list.invalidate(),
  });

  const removeCharacterMutation = trpc.collections.removeCharacter.useMutation({
    onSuccess: () => utils.collections.list.invalidate(),
  });

  // Create a new collection (with optional cover image and description)
  const createCollection = useCallback(
    async (name: string, coverImage?: string, description?: string, parentId?: number | null): Promise<Collection> => {
      const result = await createMutation.mutateAsync({
        name,
        coverImage: coverImage ?? undefined,
        description: description ?? undefined,
        parentId: parentId ?? null,
      });
      return result as Collection;
    },
    [createMutation]
  );

  // Rename a collection
  const renameCollection = useCallback(
    (id: number, name: string) => {
      updateMutation.mutate({ id, name });
    },
    [updateMutation]
  );

  // Update collection metadata (name, coverImage, description, parentId)
  const updateCollection = useCallback(
    (id: number, updates: Partial<Pick<Collection, "name" | "coverImage" | "description" | "parentId">>) => {
      updateMutation.mutate({
        id,
        name: updates.name,
        coverImage: updates.coverImage ?? null,
        description: updates.description ?? null,
        parentId: updates.parentId !== undefined ? (updates.parentId ?? null) : undefined,
      });
    },
    [updateMutation]
  );

  // Delete a collection
  const deleteCollection = useCallback(
    (id: number) => {
      deleteMutation.mutate({ id });
    },
    [deleteMutation]
  );

  // Add a character to a collection (no-op if already present — server handles idempotency)
  const addToCollection = useCallback(
    (collectionId: number, characterId: string) => {
      addCharacterMutation.mutate({ collectionId, characterId });
    },
    [addCharacterMutation]
  );

  // Remove a character from a collection
  const removeFromCollection = useCallback(
    (collectionId: number, characterId: string) => {
      removeCharacterMutation.mutate({ collectionId, characterId });
    },
    [removeCharacterMutation]
  );

  // Toggle a character's membership in a collection
  const toggleInCollection = useCallback(
    (collectionId: number, characterId: string) => {
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const has = col.characterIds.includes(characterId);
      if (has) {
        removeCharacterMutation.mutate({ collectionId, characterId });
      } else {
        addCharacterMutation.mutate({ collectionId, characterId });
      }
    },
    [collections, addCharacterMutation, removeCharacterMutation]
  );

  // Check if a character is in a specific collection
  const isInCollection = useCallback(
    (collectionId: number, characterId: string) =>
      collections.find((c) => c.id === collectionId)?.characterIds.includes(characterId) ?? false,
    [collections]
  );

  // Get all collection IDs a character belongs to
  const getCharacterCollections = useCallback(
    (characterId: string) =>
      collections.filter((c) => c.characterIds.includes(characterId)).map((c) => c.id),
    [collections]
  );

  return {
    collections: collections as Collection[],
    isLoading,
    createCollection,
    renameCollection,
    updateCollection,
    deleteCollection,
    addToCollection,
    removeFromCollection,
    toggleInCollection,
    isInCollection,
    getCharacterCollections,
  };
}
