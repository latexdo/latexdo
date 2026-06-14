export {};

declare global {
  interface Window {
    terminalApi: {
      create: (options?: { cwd?: string }) => Promise<{ id: number }>;
      write: (id: number, data: string) => void;
      resize: (id: number, cols: number, rows: number) => void;
      dispose: (id: number) => void;
      onData: (
        callback: (payload: { id: number; data: string }) => void,
      ) => () => void;
      onExit: (
        callback: (payload: { id: number; exitCode: number }) => void,
      ) => () => void;
    };
  }
}
