export const shouldOpenBrowser = (args: readonly string[], releaseBuild: boolean): boolean => {
  return !args.includes('--no-browser') && (releaseBuild || args.includes('--open'));
};

export const getBrowserArguments = (url: string, profileDirectory: string): string[] => [
  '--kiosk',
  '--new-window',
  `--user-data-dir=${profileDirectory}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-mode',
  url
];