import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

export function registerApplicationProtocol(): void {
  const rendererRoot = resolve(__dirname, '../dist-renderer');

  protocol.handle('app', (request) => {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.hostname !== 'bundle') {
        return new Response('Not found', { status: 404 });
      }
      const requestedPath = decodeURIComponent(requestUrl.pathname);
      const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
      const targetPath = resolve(rendererRoot, relativePath);
      const relativeTarget = relative(rendererRoot, targetPath);
      const escapesRoot =
        relativeTarget === '..' ||
        relativeTarget.startsWith('..' + sep) ||
        relativeTarget.includes(sep + '..' + sep);

      if (escapesRoot || !existsSync(targetPath)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(targetPath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
