let memoryToken: string | null = null;

export type ServerConnectionState = 'online' | 'offline' | 'server_error';

type ConnectionListener = (state: ServerConnectionState, errorMessage?: string) => void;
const connectionListeners = new Set<ConnectionListener>();
let currentConnectionState: ServerConnectionState =
  typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';

export function subscribeConnectionState(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

function notifyConnectionState(state: ServerConnectionState, errorMessage?: string) {
  if (currentConnectionState !== state || errorMessage) {
    currentConnectionState = state;
    for (const listener of connectionListeners) {
      listener(state, errorMessage);
    }
  }
}

export function setMemoryToken(token: string | null) {
  memoryToken = token;
}

export function getMemoryToken(): string | null {
  return memoryToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  currentVersion?: number;
  constructor(message: string, status: number, code?: string, currentVersion?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.currentVersion = currentVersion;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (err) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    notifyConnectionState(offline ? 'offline' : 'server_error', 'Tidak dapat menghubungi server CBT.');
    throw new ApiError(
      offline
        ? 'Perangkat sedang offline. Perubahan tidak disimpan ke server.'
        : 'Gagal terhubung ke server CBT. Periksa koneksi jaringan Anda.',
      0,
      offline ? 'NETWORK_OFFLINE' : 'NETWORK_ERROR',
    );
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    if (res.status >= 500) {
      notifyConnectionState('server_error', String(data.error || `Server error (${res.status})`));
    } else {
      notifyConnectionState('online');
    }
    throw new ApiError(
      String(data.error || `Permintaan gagal (${res.status})`),
      res.status,
      typeof data.code === 'string' ? data.code : undefined,
      typeof data.current_version === 'number' ? data.current_version : undefined,
    );
  }

  notifyConnectionState('online');
  return data as T;
}

export async function downloadAuthenticatedFile(apiPath: string, fallbackFilename: string): Promise<void> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }

  const res = await fetch(`/api${apiPath}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let errMsg = `Gagal mengunduh berkas (${res.status})`;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed.error) errMsg = parsed.error;
    } catch {
      // Ignore parse error
    }
    throw new ApiError(errMsg, res.status);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
