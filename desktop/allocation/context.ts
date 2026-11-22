import type { NetworkClient } from "../networkTypes";

export interface StorageContext {
  api: {
    storage: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<void>;
      delete(key: string): Promise<void>;
    };
  };
}

export interface NetworkContext {
  api: { network: NetworkClient };
}
