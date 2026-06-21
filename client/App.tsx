import { useCallback, useEffect, useRef, useState } from 'react';
import { DuoDropController, type TransferItem, type ControllerConfig } from './controller';
import { QrCode } from './QrCode';
import { QrScanner } from './QrScanner';
import { buildRoomLink, roomFromScan } from './qr';

type View = 'home' | 'join' | 'xfer' | 'sas-wait' | 'sas-compare';

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

export function App() {
  const [view, setView] = useState<View>('home');
  const [items, setItems] = useState<TransferItem[]>([]);
  const [drag, setDrag] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);
  // SAS short-code path (ADR 0003/0005) — the only pairing path: a non-secret room code
  // plus a 4-emoji safety-string compare.
  const [sasConnected, setSasConnected] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [safety, setSafety] = useState<string[]>([]);

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

  const startController = useCallback(async (config: ControllerConfig) => {
    // One session per page load — also guards against StrictMode's double-mount.
    if (startedRef.current) return;
    startedRef.current = true;
    const controller = new DuoDropController(config, {
      onConnected: () => setSasConnected(true),
      onRoomCreated: (code) => setRoomCode(code),
      onSafetyString: (emoji) => setSafety(emoji),
      onItemAdd: (item) => setItems((prev) => [item, ...prev]),
      onItemCanSave: (id) =>
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, canSave: true } : i))),
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
      onClosed: (message) => toast(message),
    });
    controllerRef.current = controller;
    try {
      await controller.start();
    } catch (err) {
      // A start failure (blocked crypto, no ICE, dead socket) used to vanish as an unhandled
      // rejection, leaving the UI stuck "waiting". Surface it and let the user retry.
      startedRef.current = false;
      toast(err instanceof Error ? `Couldn’t connect — ${err.message}` : 'Couldn’t connect');
    }
  }, [toast]);

  const createSasRoom = useCallback(() => {
    void startController({ create: true });
    setView('sas-wait');
  }, [startController]);

  const joinRoom = useCallback(
    (code: string) => {
      if (!/^\d{4}$/.test(code.trim())) {
        toast('Enter the 4-digit room code from the other device');
        return;
      }
      const room = code.trim();
      setRoomInput(room);
      void startController({ create: false, code: room });
      setView('sas-wait');
    },
    [startController, toast],
  );

  // Once the room is both connected and has its safety string, show the match gate.
  useEffect(() => {
    if (sasConnected && safety.length && view === 'sas-wait') setView('sas-compare');
  }, [sasConnected, safety, view]);

  // Joining by an opened or scanned link: the non-secret room code rides in the #fragment
  // (…#room=4821), so a phone-camera scan that opens the URL joins straight away. Handle a
  // fresh load and a link dropped into the address bar of an open tab — a fragment-only change
  // fires `hashchange` without a reload, which a one-shot mount read would miss.
  useEffect(() => {
    const tryJoin = () => {
      const code = roomFromScan(location.href);
      if (code) joinRoom(code);
    };
    tryJoin();
    window.addEventListener('hashchange', tryJoin);
    return () => window.removeEventListener('hashchange', tryJoin);
  }, [joinRoom]);

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

  // The security gate (ADR 0003): the transfer view — the only place files can be sent — is
  // unreachable until a human confirms the safety strings match on both screens.
  const confirmMatch = useCallback(() => setView('xfer'), []);
  const rejectMatch = useCallback(() => {
    // A mismatch means a possible relay-in-the-middle: tear the whole session down.
    location.href = location.origin;
  }, []);

  const copyRoomLink = useCallback(() => {
    if (!roomCode) return;
    void navigator.clipboard?.writeText(buildRoomLink(roomCode, location.origin)).catch(() => {});
    toast('Room link copied');
  }, [roomCode, toast]);

  const sendFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length) void controllerRef.current?.sendFiles(list);
  }, []);

  const endSession = useCallback(() => {
    location.href = location.origin;
  }, []);

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
          <span className={`dot${view === 'xfer' || view === 'sas-wait' ? ' live' : ''}`} />
          <span>
            {view === 'xfer'
              ? 'secure · connected'
              : view === 'sas-wait'
                ? 'room open'
                : view === 'sas-compare'
                  ? 'verify'
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
                  <button className="btn btn-signal" onClick={createSasRoom}>
                    Create a room <span className="k">C</span>
                  </button>
                  <button className="btn btn-ghost" onClick={() => setView('join')}>
                    Join a room <span className="k">J</span>
                  </button>
                </div>
                <div className="hint-row">
                  a 4-digit code + a QR · scan it or type it · then match four emoji
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

        {view === 'join' && (
          <section className="view">
            <div className="join reveal">
              <div className="eyebrow" style={{ justifyContent: 'center' }}>
                join a device · no sign-in, no app
              </div>
              <h2>Join a device</h2>
              <p>Type the 4-digit room code from the other device — or scan its QR.</p>
              <div className="codeinput">
                <input
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onKeyDown={(e) => e.key === 'Enter' && joinRoom(roomInput)}
                  placeholder="4-digit code · 0000"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </div>
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button className="btn btn-signal" onClick={() => joinRoom(roomInput)}>
                  Join room
                </button>
                <button className="btn btn-ghost" onClick={() => setScanning((on) => !on)}>
                  {scanning ? 'Hide scanner' : 'Scan QR'}
                </button>
              </div>
              {scanning && (
                <QrScanner
                  onCode={(code) => {
                    setScanning(false);
                    joinRoom(code);
                  }}
                  onCancel={() => setScanning(false)}
                />
              )}
              <div style={{ marginTop: 36 }}>
                <button className="btn btn-ghost" onClick={() => setView('home')}>
                  ← back
                </button>
              </div>
            </div>
          </section>
        )}

        {view === 'sas-wait' && (
          <section className="view">
            <div className="join reveal">
              {roomCode ? (
                <>
                  <div className="eyebrow" style={{ justifyContent: 'center' }}>
                    room open · waiting for the other device
                  </div>
                  <h2>Room code</h2>
                  <p>On the other device, type this code — or scan the QR.</p>
                  <div className="roomcode">{roomCode}</div>
                  <div className="qrwrap" style={{ marginTop: 18 }}>
                    <QrCode text={buildRoomLink(roomCode, location.origin)} />
                    <div className="qr-cap">scan to join · the code is not a secret</div>
                  </div>
                  <div className="actions" style={{ justifyContent: 'center', marginTop: 18 }}>
                    <button className="btn btn-ghost" onClick={copyRoomLink}>
                      Copy room link
                    </button>
                  </div>
                  <div className="waiting" style={{ justifyContent: 'center', marginTop: 18 }}>
                    <span className="dot live" /> waiting for the other device…
                  </div>
                </>
              ) : (
                <>
                  <div className="eyebrow" style={{ justifyContent: 'center' }}>
                    joining room {roomInput}
                  </div>
                  <h2>Connecting…</h2>
                  <p>Pairing with the other device over the relay.</p>
                  <div className="waiting" style={{ justifyContent: 'center', marginTop: 22 }}>
                    <span className="dot live" /> establishing the channel…
                  </div>
                </>
              )}
              <div style={{ marginTop: 36 }}>
                <button className="btn btn-ghost" onClick={endSession}>
                  Cancel
                </button>
              </div>
            </div>
          </section>
        )}

        {view === 'sas-compare' && (
          <section className="view">
            <div className="join reveal">
              <div className="eyebrow" style={{ justifyContent: 'center' }}>
                security check · compare both screens
              </div>
              <h2>Do these match?</h2>
              <p>
                These four emoji must be <b>identical</b> on both laptops. If they differ, someone
                may be intercepting the connection — do not continue.
              </p>
              <div className="sasemoji">
                {safety.map((e, i) => (
                  <span key={i} className="sasglyph">
                    {e}
                  </span>
                ))}
              </div>
              <div className="actions" style={{ justifyContent: 'center', marginTop: 26 }}>
                <button className="btn btn-signal" onClick={confirmMatch}>
                  ✓ They match — continue
                </button>
                <button className="btn btn-danger" onClick={rejectMatch}>
                  ✕ They’re different
                </button>
              </div>
              <div className="secret-note" style={{ justifyContent: 'center', marginTop: 20 }}>
                <span className="lock">🔒</span>
                <span>the emoji are derived from a key the relay never sees</span>
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
                      ) : item.direction === 'receive' && item.canSave ? (
                        <button
                          className="savebtn"
                          onClick={() => {
                            controllerRef.current?.saveReceive(item.id);
                            setItems((prev) =>
                              prev.map((i) => (i.id === item.id ? { ...i, canSave: false } : i)),
                            );
                          }}
                        >
                          Save
                        </button>
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

      <div className={`toast${toastOn ? ' on' : ''}`}>
        <span className="k">✓</span>
        <span>{toastMsg}</span>
      </div>
    </div>
  );
}
