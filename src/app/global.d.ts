import type { AquilaApi } from '@/shared/api';

declare global {
  interface Window {
    aquila: AquilaApi;
  }
}

export {};
