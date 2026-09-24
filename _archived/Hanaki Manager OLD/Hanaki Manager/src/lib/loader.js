import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadModules(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const modules = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    modules.push({ file, mod });
  }
  return modules;
}
