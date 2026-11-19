// The renderer's only door to the main process. Never touch window.aquila elsewhere.
import type { AquilaApi } from './types';

export const api: AquilaApi = window.aquila;
