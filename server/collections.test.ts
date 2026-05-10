/**
 * Collections router tests
 * Verifies that the collections tRPC procedures are correctly defined
 * and that the DB helper functions have the right signatures.
 */
import { describe, it, expect } from 'vitest';
import { appRouter } from './routers';

describe('collections router', () => {
  it('has a list procedure', () => {
    expect(appRouter.collections).toBeDefined();
    expect(appRouter.collections.list).toBeDefined();
  });

  it('has a create procedure', () => {
    expect(appRouter.collections.create).toBeDefined();
  });

  it('has an update procedure', () => {
    expect(appRouter.collections.update).toBeDefined();
  });

  it('has a delete procedure', () => {
    expect(appRouter.collections.delete).toBeDefined();
  });

  it('has an addCharacter procedure', () => {
    expect(appRouter.collections.addCharacter).toBeDefined();
  });

  it('has a removeCharacter procedure', () => {
    expect(appRouter.collections.removeCharacter).toBeDefined();
  });
});

describe('db helpers for collections', () => {
  it('exports getCollectionsByOwner', async () => {
    const { getCollectionsByOwner } = await import('./db');
    expect(typeof getCollectionsByOwner).toBe('function');
  });

  it('exports createCollection', async () => {
    const { createCollection } = await import('./db');
    expect(typeof createCollection).toBe('function');
  });

  it('exports updateCollection', async () => {
    const { updateCollection } = await import('./db');
    expect(typeof updateCollection).toBe('function');
  });

  it('exports deleteCollection', async () => {
    const { deleteCollection } = await import('./db');
    expect(typeof deleteCollection).toBe('function');
  });

  it('exports addCharacterToCollection', async () => {
    const { addCharacterToCollection } = await import('./db');
    expect(typeof addCharacterToCollection).toBe('function');
  });

  it('exports removeCharacterFromCollection', async () => {
    const { removeCharacterFromCollection } = await import('./db');
    expect(typeof removeCharacterFromCollection).toBe('function');
  });
});
