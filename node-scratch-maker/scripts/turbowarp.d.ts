declare module '@turbowarp/packager' {
  const api: {
    loadProject(data: Uint8Array): Promise<unknown>;
    Packager: new () => {
      project: unknown;
      options: {target: string; autoplay: boolean};
      package(): Promise<{data: Uint8Array | string}>;
    };
  };
  export default api;
}