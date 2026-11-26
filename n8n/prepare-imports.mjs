import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const templateDir = new URL('./', import.meta.url);
const outputDir = new URL('../output/n8n-imports/', import.meta.url);
const placeholder = /\{\{(PROSPECT_DESK_[A-Z0-9_]+)\}\}/g;

function projectOrigin() {
  const value = process.env.PROSPECT_DESK_SUPABASE_URL?.trim();
  const message = 'Set PROSPECT_DESK_SUPABASE_URL to your Supabase HTTPS project URL.';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || url.hostname === 'your-project-ref.supabase.co' || /['"\\]/.test(url.origin)) {
    throw new Error(message);
  }
  return url.origin;
}

function optionalId(key, pattern) {
  const value = process.env[key]?.trim() ?? '';
  if (value && !pattern.test(value)) throw new Error('Check the ID in ' + key + '.');
  return value;
}

try {
  const values = {
    PROSPECT_DESK_SUPABASE_URL: projectOrigin(),
    PROSPECT_DESK_AIRTABLE_BASE_ID: optionalId('PROSPECT_DESK_AIRTABLE_BASE_ID', /^app[a-z0-9]+$/i),
    PROSPECT_DESK_AIRTABLE_TABLE_ID: optionalId('PROSPECT_DESK_AIRTABLE_TABLE_ID', /^tbl[a-z0-9]+$/i),
    PROSPECT_DESK_AIRTABLE_SYNC_WORKFLOW_ID: optionalId('PROSPECT_DESK_AIRTABLE_SYNC_WORKFLOW_ID', /^[a-z0-9_-]+$/i),
  };
  const files = (await readdir(templateDir)).filter(file => file.endsWith('.json')).sort();
  const imports = await Promise.all(files.map(async (file) => {
    const template = await readFile(new URL(file, templateDir), 'utf8');
    const rendered = template.replace(placeholder, (_, key) => {
      if (!Object.hasOwn(values, key)) throw new Error('Unknown workflow setting ' + key + ' in ' + file + '.');
      return values[key];
    });
    const workflow = JSON.parse(rendered);
    if (workflow.active !== false) throw new Error(file + ' must be inactive before preparing an import.');
    return { file, rendered };
  }));

  await mkdir(outputDir, { recursive: true });
  await Promise.all(imports.map(({ file, rendered }) => writeFile(new URL(file, outputDir), rendered)));
  console.log('Prepared ' + imports.length + ' workflow imports in output/n8n-imports/.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
