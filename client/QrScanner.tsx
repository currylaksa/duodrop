/**
 * Camera-based QR scanning (issue 005) — an optional Join method, never the only way in. It
 * opens the rear camera, decodes frames with jsQR, and on the first frame that yields a valid
 * DuoDrop room code calls onCode. If the camera is unavailable (denied/no device/insecure
 * context) it surfaces an error and the user falls back to typing the code.
 */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { roomFromScan } from './qr';

export function QrScanner({
  onCode,
  onCancel,
}: {
  onCode: (code: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      const video = videoRef.current;
      if (!stopped && video && video.readyState >= video.HAVE_ENOUGH_DATA && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(frame.data, frame.width, frame.height);
        if (found) {
          const code = roomFromScan(found.data);
          if (code) {
            stopped = true;
            onCode(code);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play();
        }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setError('Camera unavailable — type the code instead.'));

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="scanner">
      {error ? (
        <div className="scan-err">{error}</div>
      ) : (
        <div className="scanframe">
          <video ref={videoRef} className="scanvideo" muted playsInline />
          <span className="scan-corner tl" />
          <span className="scan-corner tr" />
          <span className="scan-corner bl" />
          <span className="scan-corner br" />
        </div>
      )}
      <button className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
