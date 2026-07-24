/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POOLMATE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  Telegram?: {
    WebApp?: {
      initData?: string;
    };
  };
}
