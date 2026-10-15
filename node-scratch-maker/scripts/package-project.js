import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const TurboWarpPackager = require('@turbowarp/packager');
const MAX_PROJECT_SIZE = 100 * 1024 * 1024;

const usage = () => {
  console.log('Usage: yarn package <project-url> [output.html]');
  console.log('Accepts a shared Scratch project URL or a direct .sb3 URL.');
};

const safeFilename = (value) => value
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
  .replace(/[. ]+$/, '')
  .trim() || 'scratch-project';

const parseProjectUrl = (input) => {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a complete project URL, including https://.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Project URLs must use HTTP or HTTPS and cannot contain credentials.');
  }

  const isScratch = ['scratch.mit.edu', 'www.scratch.mit.edu'].includes(url.hostname);
  const projectMatch = isScratch && url.pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
  if (isScratch && !projectMatch) {
    throw new Error('That Scratch URL does not contain a project ID.');
  }

  if (projectMatch) {
    return {
      kind: 'scratch',
      id: projectMatch[1],
      name: `Scratch-project-${projectMatch[1]}`
    };
  }

  let filename;
  try {
    filename = decodeURIComponent(path.posix.basename(url.pathname));
  } catch {
    throw new Error('The project URL contains an invalid filename.');
  }
  if (!filename.toLowerCase().endsWith('.sb3')) {
    throw new Error('Use a shared Scratch project URL or a direct URL ending in .sb3.');
  }

  return {kind: 'file', url: url.href, name: filename.replace(/\.sb3$/i, '')};
};

const getProjectData = async (source) => {
  let projectUrl = source.url;
  if (source.kind === 'scratch') {
    console.log('Looking up shared Scratch project…');
    const metadataResponse = await fetch(`https://trampoline.turbowarp.org/api/projects/${source.id}`);
    if (!metadataResponse.ok) {
      throw new Error(metadataResponse.status === 404
        ? 'Project not found or not shared. Only public Scratch projects can be packaged by ID.'
        : `Could not load Scratch project details (HTTP ${metadataResponse.status}).`);
    }
    const metadata = await metadataResponse.json();
    if (!metadata.project_token) {
      throw new Error('Scratch did not provide a project token. Check that the project is shared.');
    }
    projectUrl = `https://projects.scratch.mit.edu/${source.id}?token=${encodeURIComponent(metadata.project_token)}`;
  }

  console.log('Downloading project…');
  const response = await fetch(projectUrl);
  if (!response.ok) {
    throw new Error(`Project download failed (HTTP ${response.status}).`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_PROJECT_SIZE) {
    throw new Error('Project file is larger than the 100 MB limit.');
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) {
    throw new Error('The project URL returned an empty file.');
  }
  if (data.length > MAX_PROJECT_SIZE) {
    throw new Error('Project file is larger than the 100 MB limit.');
  }
  return data;
};

const main = async () => {
  const [projectUrl, requestedOutput, ...extraArguments] = process.argv.slice(2);
  if (!projectUrl || projectUrl === '--help' || projectUrl === '-h') {
    usage();
    return;
  }
  if (extraArguments.length) {
    usage();
    throw new Error('Too many arguments.');
  }

  const source = parseProjectUrl(projectUrl);
  const defaultOutput = `${safeFilename(source.name.replace(/\.sb3$/i, ''))}.html`;
  const outputPath = path.resolve(requestedOutput || defaultOutput);
  if (path.extname(outputPath).toLowerCase() !== '.html') {
    throw new Error('The output path must end in .html.');
  }

  const projectData = await getProjectData(source);
  console.log('Loading project with TurboWarp Packager…');
  const loadedProject = await TurboWarpPackager.loadProject(projectData);

  const packager = new TurboWarpPackager.Packager();
  packager.project = loadedProject;
  packager.options.target = 'html';
  packager.options.autoplay = true;

  console.log('Generating standalone HTML…');
  const result = await packager.package();
  await mkdir(path.dirname(outputPath), {recursive: true});
  await writeFile(outputPath, result.data);
  console.log(`Created ${outputPath}`);
};

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});