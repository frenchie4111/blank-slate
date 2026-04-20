import Anthropic from '@anthropic-ai/sdk';
import { fetch as expoFetch } from 'expo/fetch';

export function createClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    fetch: expoFetch as unknown as typeof fetch,
  });
}
