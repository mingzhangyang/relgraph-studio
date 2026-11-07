import { readFile, writeFile } from 'node:fs/promises';
import { compileFromFile } from 'json-schema-to-typescript';

const schemaPath = 'packages/core/schema/relationship-graph.schema.json';
const outputPath = 'packages/core/types/generated/relationship-graph.ts';
const generated = await compileFromFile(schemaPath, {
  bannerComment:
    '// Generated from packages/core/schema/relationship-graph.schema.json. Do not edit by hand.',
  style: { singleQuote: true, printWidth: 100 },
});

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (current !== generated) {
    console.error(`${outputPath} is stale. Run npm run generate:types.`);
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated);
}
