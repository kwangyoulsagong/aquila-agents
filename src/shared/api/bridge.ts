// The renderer's only door to the main process. Never touch window.aquila elsewhere.
import type { AquilaApi } from './types';

// Unit tests run without a window: importing a model that uses a shared constant must not throw there.
export const api: AquilaApi = typeof window === 'undefined' ? (undefined as never) : window.aquila;
