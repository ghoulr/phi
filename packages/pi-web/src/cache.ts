const DEFAULT_MAX_ENTRIES = 32;

class LruCache<TKey, TValue> {
	private readonly store = new Map<TKey, TValue>();

	constructor(private readonly maxEntries: number) {}

	get(key: TKey): TValue | undefined {
		const value = this.store.get(key);
		if (value === undefined) {
			return undefined;
		}
		this.store.delete(key);
		this.store.set(key, value);
		return value;
	}

	set(key: TKey, value: TValue): void {
		if (this.store.has(key)) {
			this.store.delete(key);
		}
		this.store.set(key, value);
		if (this.store.size <= this.maxEntries) {
			return;
		}
		const oldestKey = this.store.keys().next().value;
		if (oldestKey !== undefined) {
			this.store.delete(oldestKey);
		}
	}
}

const globalState = globalThis as typeof globalThis & {
	__piWebCache__?: LruCache<string, string>;
};

function getCache(): LruCache<string, string> {
	if (!globalState.__piWebCache__) {
		globalState.__piWebCache__ = new LruCache<string, string>(
			DEFAULT_MAX_ENTRIES
		);
	}
	return globalState.__piWebCache__;
}

export function normalizeUrlCacheKey(rawUrl: string): string {
	const url = new URL(rawUrl);
	url.hash = "";
	return url.toString();
}

export function getCachedWebText(rawUrl: string): string | undefined {
	return getCache().get(normalizeUrlCacheKey(rawUrl));
}

export function setCachedWebText(rawUrl: string, text: string): void {
	getCache().set(normalizeUrlCacheKey(rawUrl), text);
}
