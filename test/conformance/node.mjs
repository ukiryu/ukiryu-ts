// Runs the conformance corpus in UKIRYU_CONFORMANCE_DIR through the Node entry.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as api from '../../dist/node.js';
import { runCorpus } from './corpus.mjs';

const dir = process.env.UKIRYU_CONFORMANCE_DIR;
if (!dir) throw new Error('set UKIRYU_CONFORMANCE_DIR to the corpus/conformance directory of the pinned core');
const engine = await api.load();
const result = await runCorpus({
  engine,
  api,
  load: (file) => readFile(path.join(dir, file), 'utf8'),
  loadRule: (file) => readFile(path.resolve(dir, '../../ukiryu/tests/conformance', file), 'utf8'),
  digest: async (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
});
console.log(`Node ${process.version}: ${JSON.stringify(result)}`);
