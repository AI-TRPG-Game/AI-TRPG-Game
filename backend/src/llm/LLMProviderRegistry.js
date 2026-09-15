import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';

function publicProfile(profile, isDefault) {
  return {
    id: profile.id,
    label: profile.label,
    description: profile.description || '',
    provider: profile.provider,
    model: profile.model,
    configured: Boolean(profile.configured),
    isDefault,
  };
}

/**
 * Owns the server-side provider instances behind the safe profile IDs exposed
 * to the browser. API keys and base URLs never leave this registry.
 */
export class LLMProviderRegistry {
  constructor({ profiles, defaultProfileId }) {
    if (!Array.isArray(profiles) || profiles.length === 0) {
      throw new Error('At least one LLM profile is required');
    }

    this.profiles = new Map();
    for (const profile of profiles) {
      if (!profile?.id || this.profiles.has(profile.id)) continue;
      const provider = new OpenAICompatibleProvider(profile);
      this.profiles.set(profile.id, { profile, provider });
    }
    if (this.profiles.size === 0) throw new Error('No valid LLM profiles were configured');
    this.defaultProfileId = this.profiles.has(defaultProfileId)
      ? defaultProfileId
      : this.profiles.keys().next().value;
  }

  resolve(requestedProfileId) {
    const id = this.profiles.has(requestedProfileId)
      ? requestedProfileId
      : this.defaultProfileId;
    const entry = this.profiles.get(id);
    return { id, ...entry };
  }

  has(profileId) {
    return this.profiles.has(profileId);
  }

  listPublicProfiles() {
    return [...this.profiles.values()].map(({ profile }) =>
      publicProfile(profile, profile.id === this.defaultProfileId)
    );
  }
}

