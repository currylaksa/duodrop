import { useCallback, useEffect, useRef, useState } from 'react';
import {
  generatePairingSecret,
  deriveRoutingId,
  encodeSecret,
  decodeSecret,
  buildShareLink,
  parseShareLink,
} from '../shared/src/pairing';
import { DuoDropController, type TransferItem } from './controller';
import { QrCode } from './QrCode';
import { QrScanner } from './QrScanner';

type View = 'home' | 'create' | 'join' | 'xfer';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n;
  let i = -1;
  do {
    value /= 1024;
    i++;
  } while (value >= 1024 && i < units.length - 1);
  return `${value.toFixed(1)} ${units[i]}`;
}

function fmtSpeed(bps: number): string {
  return `${fmtBytes(Math.max(0, bps))}/s`;
}

function fileTag(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1, dot + 5).toUpperCase() : 'BIN';
}

function percent(item: TransferItem): number {
  if (item.status === 'done') return 100;
  if (item.size === 0) return 100;
  return Math.min(100, Math.floor((item.transferred / item.size) * 100));
}

function ConnectOverlay({ onDone }: { onDone: () => void }) {
  const lines = [
    'routing id — HKDF(secret, "routing")',
    'signaling — matched on routing id',
    'ICE — gathering candidates',
    'DTLS — transport secured',
    'secretstream — XChaCha20-Poly1305',
    'data channel — open',
  ];
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    lines.forEach((_, i) => timers.push(setTimeout(() => setShown(i + 1), 240 + i * 300)));
    const doneAt = 240 + lines.length * 300 + 200;
    timers.push(setTimeout(() => setDone(true), doneAt));
    timers.push(setTimeout(onDone, doneAt + 900));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overlay on">
      <div className="console">
        <div className="eyebrow">establishing secure channel</div>
        {lines.map((line, i) => (
          <div key={line} className={`line${i < shown ? ' show' : ''}`}>
            <span>{line}</span>
            <span className="ok">[ok]</span>
          </div>
        ))}
        <div className={`done${done ? ' show' : ''}`}>
          <span className="lk">🔒</span> SECURE CHANNEL ESTABLISHED
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>('home');
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [routingId, setRoutingId] = useState('');
  const [items, setItems] = useState<TransferItem[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [drag, setDrag] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);

  const controllerRef = useRef<DuoDropController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  const toast = useCallback((message: string) => {
    setToastMsg(message);
    setToastOn(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastOn(false), 2200);
  }, []);

  const beginSession = useCallback(async (s: Uint8Array) => {
    // One session per page load — also guards against StrictMode's double-mount.
    if (startedRef.current) return;
    startedRef.current = true;
    setSecret(s);
    setRoutingId(await deriveRoutingId(s));
    const controller = new DuoDropController(s, {
      onConnected: () => setConnecting(true),
      onItemAdd: (item) => setItems((prev) => [item, ...prev]),
      onItemProgress: (id, transferred, speed) =>
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, transferred, speed } : i))),
      onItemDone: (id) =>
        setItems((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, status: 'done' as const, transferred: i.size, speed: 0 } : i,
          ),
        ),
      onItemError: (id, message) => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, status: 'error' as const, error: message, speed: 0 } : i,
          ),
        );
        toast(message);
      },
      onWarn: (message) => toast(message),
    });
    controllerRef.current = controller;
    await controller.start();
  }, [toast]);

  // Joining peer: the secret is in the share link's #fragment.
  useEffect(() => {
    const joining = parseShareLink(location.href);
    if (joining) void beginSession(joining);
  }, [beginSession]);

  // Mobile resilience: a backgrounded tab can have its connection torn down mid-transfer,
  // which drops us into the re-pair model. Warn while a transfer is still in flight.
  const activeRef = useRef(false);
  activeRef.current = items.some((i) => i.status === 'active');
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden && activeRef.current) {
        toast('Keep this tab in front — backgrounding can drop the transfer.');
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [toast]);

  const createChannel = useCallback(() => {
    void beginSession(generatePairingSecret());
    setView('create');
  }, [beginSession]);

  const joinWithCode = useCallback(() => {
    let s: Uint8Array;
    try {
      s = decodeSecret(codeInput);
    } catch {
      toast('Invalid pairing code');
      return;
    }
    if (s.length !== 16) {
      toast('Invalid pairing code');
      return;
    }
    void beginSession(s);
  }, [beginSession, codeInput, toast]);

  const copyLink = useCallback(() => {
    if (!secret) return;
    const link = buildShareLink(secret, location.origin);
    void navigator.clipboard?.writeText(link).catch(() => {});
    toast('Link copied · secret stays in #fragment');
  }, [secret, toast]);

  const sendFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length) void controllerRef.current?.sendFiles(list);
  }, []);

  const endSession = useCallback(() => {
    location.href = location.origin;
  }, []);

  const cipherGroups = secret ? encodeSecret(secret).split('-') : [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="wordmark">
            DUO<b>DROP</b>
          </div>
          <div className="slash">// secure transfer</div>
        </div>
        <div className="statuschip">
          <span className={`dot${view === 'xfer' ? ' live' : view === 'create' ? ' live' : ''}`} />
          <span>
            {view === 'xfer'
              ? 'secure · connected'
              : view === 'create'
                ? 'channel open'
                : view === 'join'
                  ? 'joining…'
                  : 'idle'}
          </span>
        </div>
      </header>

      <main className="stage">
        {view === 'home' && (
          <section className="view reveal">
            <div className="hero">
              <div>
                <div className="eyebrow">end-to-end encrypted · device-to-device</div>
                <h1>
                  Send it.
                  <br />
                  Nobody <span className="em">in&nbsp;between.</span>
                </h1>
                <p className="lede">
                  Two devices, one key, <b>zero trust</b>. Files stream directly peer-to-peer —
                  the relay never sees your key, and <b>never touches your file</b>.
                </p>
                <div className="actions">
                  <button className="btn btn-signal" onClick={createChannel}>
                    Create a channel <span className="k">C</span>
                  </button>
                  <button className="btn btn-ghost" onClick={() => setView('join')}>
                    Join with a code <span className="k">J</span>
                  </button>
                </div>
              </div>
              <div className="diagram">
                <span className="corner tl" />
                <span className="corner tr" />
                <span className="corner bl" />
                <span className="corner br" />
                <div className="node-row">
                  <div className="node">
                    A<span>THIS DEVICE</span>
                  </div>
                  <div className="wire" />
                  <div className="node">
                    B<span>PEER</span>
                  </div>
                </div>
                <div className="lockbadge">🔒 XChaCha20-Poly1305</div>
                <div className="diag-foot">relay brokers handshake · bytes go direct</div>
              </div>
            </div>
          </section>
        )}

        {view === 'create' && (
          <section className="view">
            <div className="reveal">
              <div className="eyebrow">channel open · waiting for peer</div>
              <div className="pair" style={{ marginTop: 22 }}>
                <div className="panel glow">
                  <div className="panel-h">
                    <span className="lbl">Pairing secret · 128-bit</span>
                    <span className="tag ok">never sent to server</span>
                  </div>
                  <div className="panel-b">
                    <div className="cipher">
                      {cipherGroups.map((g, i) => (
                        <span key={i}>
                          {i > 0 && <span className="sep"> · </span>}
                          <span className="g">{g}</span>
                        </span>
                      ))}
                    </div>
                    <div className="secret-note">
                      <span className="lock">🔑</span>
                      <span>whoever holds this can join &amp; decrypt — share it like a key</span>
                    </div>
                    <div className="deriv">
                      <div className="deriv-row">
                        <span className="key">Routing ID</span>
                        <span className="val server">
                          {routingId.slice(0, 8)}… · server sees only this
                        </span>
                      </div>
                      <div className="deriv-row">
                        <span className="key">Pairing key</span>
                        <span className="val key">HKDF(secret, "encryption") · stays on device 🔒</span>
                      </div>
                    </div>
                    <div className="actionsrow">
                      <button className="btn btn-signal" onClick={copyLink}>
                        Copy link <span className="k">⌘C</span>
                      </button>
                      <button className="btn btn-ghost" onClick={endSession}>
                        Cancel
                      </button>
                    </div>
                    <div className="waiting" style={{ marginTop: 22 }}>
                      <span className="dot live" /> waiting for the other device…
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-h">
                    <span className="lbl">Scan to join</span>
                    <span className="tag ok">same secret</span>
                  </div>
                  <div className="qrwrap">
                    {secret && <QrCode text={buildShareLink(secret, location.origin)} />}
                    <div className="qr-cap">scan · type the code · or open the link</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {view === 'join' && (
          <section className="view">
            <div className="join reveal">
              <div className="eyebrow" style={{ justifyContent: 'center' }}>
                enter the pairing secret
              </div>
              <h2>Join a channel</h2>
              <p>Type the code shown on the other device. Ambiguous characters are excluded.</p>
              <div className="codeinput">
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && joinWithCode()}
                  placeholder="K7QM-9FRT-2XPW-…"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                />
              </div>
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button className="btn btn-signal" onClick={joinWithCode}>
                  Connect
                </button>
                <button className="btn btn-ghost" onClick={() => setScanning((on) => !on)}>
                  {scanning ? 'Hide scanner' : 'Scan QR'}
                </button>
              </div>
              {scanning && (
                <QrScanner
                  onSecret={(s) => {
                    setScanning(false);
                    void beginSession(s);
                  }}
                  onCancel={() => setScanning(false)}
                />
              )}
              <div className="or">or open the share link directly</div>
              <div style={{ marginTop: 36 }}>
                <button className="btn btn-ghost" onClick={() => setView('home')}>
                  ← back
                </button>
              </div>
            </div>
          </section>
        )}

        {view === 'xfer' && (
          <section className="view">
            <div className="xfer reveal">
              <div className="sessionbar">
                <div className="sess-left">
                  <span className="peer">
                    <span className="dot live" /> peer connected
                  </span>
                  <span className="verified">🔒 secure channel</span>
                </div>
                <div className="metrics">
                  <span>
                    direct <b>P2P</b>
                  </span>
                  <span>
                    <b>XChaCha20</b>
                    <span className="u">-Poly1305</span>
                  </span>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => e.target.files && sendFiles(e.target.files)}
              />
              <div
                className={`dropzone${drag ? ' drag' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  sendFiles(e.dataTransfer.files);
                }}
              >
                <div className="ic">↑</div>
                <h3>Drop files to send</h3>
                <p>
                  or <span className="browse">browse</span> — encrypted chunk-by-chunk, streamed
                  to the peer
                </p>
              </div>

              <div className="queue">
                {items.map((item) => (
                  <div className={`file${item.status === 'error' ? ' err' : ''}`} key={item.id}>
                    <div className="ft">{fileTag(item.name)}</div>
                    <div className="meta">
                      <div className="name">{item.name}</div>
                      <div className="sub">
                        <span>{fmtBytes(item.size)}</span>
                        <span
                          className={`stat ${
                            item.status === 'done'
                              ? 'done'
                              : item.status === 'error'
                                ? 'err'
                                : item.direction === 'send'
                                  ? 'tx'
                                  : 'rx'
                          }`}
                        >
                          {item.status === 'done'
                            ? item.direction === 'send'
                              ? '✓ delivered'
                              : '✓ received'
                            : item.status === 'error'
                              ? '✕ failed'
                              : item.direction === 'send'
                                ? '▸ sending'
                                : '▾ receiving'}
                        </span>
                        {item.status === 'active' && item.speed > 0 && (
                          <span className="speed">{fmtSpeed(item.speed)}</span>
                        )}
                      </div>
                      <div className={`track${item.status === 'error' ? ' err' : ''}`}>
                        <div className="fill" style={{ width: `${percent(item)}%` }} />
                      </div>
                    </div>
                    <div className="right">
                      {item.status === 'done' ? (
                        <div className="check">✓</div>
                      ) : item.status === 'error' ? (
                        <div className="xmark">✕</div>
                      ) : (
                        <div className="pct">{percent(item)}%</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-signal" onClick={() => fileInputRef.current?.click()}>
                  Add files
                </button>
                <button className="btn btn-ghost" onClick={endSession}>
                  End session
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="creed">
        <div className="words">
          <b>encrypted</b> · <b>zero-trust</b> · <b>peer-to-peer</b> · no install · no account
        </div>
        <div className="net">routing on hashed id · bytes go direct</div>
      </footer>

      {connecting && (
        <ConnectOverlay
          onDone={() => {
            setConnecting(false);
            setView('xfer');
          }}
        />
      )}

      <div className={`toast${toastOn ? ' on' : ''}`}>
        <span className="k">✓</span>
        <span>{toastMsg}</span>
      </div>
    </div>
  );
}
