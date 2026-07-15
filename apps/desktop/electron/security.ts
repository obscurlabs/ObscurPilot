import type { Session } from 'electron';

const PRODUCTION_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function installSecurityHeaders(
  session: Session,
  isDevelopment: boolean,
  developmentOrigin: string,
): () => void {
  const developmentPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' " + developmentOrigin + ' ws://127.0.0.1:5173 ws://localhost:5173',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  const policy = isDevelopment ? developmentPolicy : PRODUCTION_POLICY;

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
        'Permissions-Policy': ['camera=(), microphone=(), geolocation=(), display-capture=()'],
        'Referrer-Policy': ['no-referrer'],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
      },
    });
  });
  return () => {
    session.webRequest.onHeadersReceived(null);
  };
}

export function installPermissionDenial(session: Session): () => void {
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  return () => {
    session.setPermissionCheckHandler(null);
    session.setPermissionRequestHandler(null);
  };
}

export function isTrustedRendererUrl(
  frameUrl: string | undefined,
  isDevelopment: boolean,
  developmentOrigin: string,
): boolean {
  if (frameUrl === undefined) {
    return false;
  }

  try {
    const url = new URL(frameUrl);
    if (!isDevelopment) {
      return url.protocol === 'app:' && url.hostname === 'bundle';
    }
    return url.origin === developmentOrigin;
  } catch {
    return false;
  }
}
