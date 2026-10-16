import {getConfiguration} from './pegasus.ts';
import {importProject, loadEnvironment, parseProjectUrl} from './project.ts';

const usage = (): void => {
  console.log('Usage: yarn package <project-url-or-id> [output.html]');
  console.log('Accepts a shared Scratch project URL, project ID, or a direct .sb3 URL.');
  console.log('Configuration: SCRATCH_OUTPUT_DIR, PEGASUS_DIR, PEGASUS_COLLECTION (or .env).');
};

const main = async (): Promise<void> => {
  const [projectUrl, requestedOutput, ...extraArguments] = process.argv.slice(2);
  if (!projectUrl || projectUrl === '--help' || projectUrl === '-h') {
    usage();
    return;
  }
  if (extraArguments.length) {
    usage();
    throw new Error('Too many arguments.');
  }

  loadEnvironment();
  const result = await importProject(getConfiguration(), parseProjectUrl(projectUrl), {
    output: requestedOutput,
    onProgress: ({message}) => console.log(message)
  });
  console.log(`Created ${result.outputPath}`);
};

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});