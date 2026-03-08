import type { ApiShape } from '../../shared/api-shape';

declare global {
  interface Window {
    api: ApiShape;
  }
}

export {};
