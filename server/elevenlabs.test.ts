import { describe, it, expect } from 'vitest';

/**
 * Live smoke test against ElevenLabs. Requires ELEVEN_LABS_API_KEY in the environment.
 * Skipped automatically when the key is missing (CI, local without .env).
 */
const hasElevenLabsKey = !!process.env.ELEVEN_LABS_API_KEY?.trim();

describe.skipIf(!hasElevenLabsKey)('ElevenLabs API key validation', () => {
  it('should be able to list voices with the configured API key', async () => {
    const apiKey = process.env.ELEVEN_LABS_API_KEY!;

    const res = await fetch('https://api.elevenlabs.io/v2/voices?page_size=1', {
      headers: { 'xi-api-key': apiKey },
    });

    expect(res.status, 'ElevenLabs API should return 200').toBe(200);
    const data = await res.json() as { voices: unknown[]; total_count?: number };
    expect(Array.isArray(data.voices), 'Response should have voices array').toBe(true);
  });
});
