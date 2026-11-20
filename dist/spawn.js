/** Node's direct argv adapter. Shell-specific planning remains in the core. */
import { spawn } from 'node:child_process';
import { UkiryuError } from './engine.js';
export const nodeSpawner = {
    spawn(request) {
        return new Promise((resolve, reject) => {
            if (!Number.isFinite(request.timeout) || request.timeout < 0 || request.timeout * 1000 > 2147483647) {
                throw new RangeError('timeout must be finite, non-negative seconds within the host timer range');
            }
            const [executable, ...args] = request.argv;
            const child = spawn(executable, args, {
                cwd: request.cwd,
                env: { ...process.env, ...request.env },
                shell: false,
                windowsHide: true,
                stdio: 'pipe',
            });
            const stdout = [];
            const stderr = [];
            let timedOut = false;
            let timer;
            const failed = (error) => {
                clearTimeout(timer);
                reject(new UkiryuError(new Map([
                    ['code', 'SPAWN_ERROR'],
                    ['message', error.message],
                ])));
            };
            child.stdout.on('data', (chunk) => stdout.push(chunk));
            child.stderr.on('data', (chunk) => stderr.push(chunk));
            child.on('error', failed);
            child.on('close', (exitStatus, signal) => {
                clearTimeout(timer);
                resolve({
                    stdout: new Uint8Array(Buffer.concat(stdout)),
                    stderr: new Uint8Array(Buffer.concat(stderr)),
                    exitStatus,
                    signal,
                    timedOut,
                });
            });
            // An early exit may close stdin before all input is written.
            child.stdin.on('error', (error) => {
                if (error.code !== 'EPIPE') {
                    child.kill('SIGKILL');
                    failed(error);
                }
            });
            if (request.timeout > 0) {
                timer = setTimeout(() => {
                    timedOut = child.kill('SIGKILL');
                }, request.timeout * 1000);
            }
            child.stdin.end(request.stdin);
        });
    },
};
