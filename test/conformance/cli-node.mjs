// Focused deterministic CLI replay; the full runners cover every dispatched group.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import * as api from '../../dist/node.js';
import {runCliCorpus} from './cli-snapshot.mjs';
const dir=process.env.UKIRYU_CONFORMANCE_DIR;
if (!dir) throw new Error('set UKIRYU_CONFORMANCE_DIR to the pinned core corpus/conformance');
const result=await runCliCorpus({engine:await api.load(),api,load:file=>readFile(path.join(dir,file),'utf8'),digest:async text=>createHash('sha256').update(text).digest('hex')});
console.log(`Node ${process.version}: ${JSON.stringify(result)}`);
