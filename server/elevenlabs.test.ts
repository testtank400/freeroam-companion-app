import { describe, it, expect } from 'vitest';

describe('ElevenLabs API key validation', () => {
  it('should be able to list voices with the configured API key', async () => {
    const apiKey = process.env.ELEVEN_LABS_API_KEY;
    expect(apiKey, 'ELEVEN_LABS_API_KEY must be set').toBeTruthy();

    const res = await fetch('https://api.elevenlabs.io/v2/voices?page_size=1', {
      headers: { 'xi-api-key': apiKey! },
    });

    expect(res.status, 'ElevenLabs API should return 200').toBe(200);
    const data = await res.json() as { voices: unknown[]; total_count?: number };
    expect(Array.isArray(data.voices), 'Response should have voices array').toBe(true);
  });
});
