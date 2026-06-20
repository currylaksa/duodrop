/**
 * Renders a scannable QR (issue 005). Dark modules on a white field so it scans regardless of
 * the app's dark theme. The QR carries a room-join link whose #fragment holds the non-secret
 * 4-digit room code, so a scan joins the same room as typing the code (SAS path, ADR 0003/0005).
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrCode({ text }: { text: string }) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let alive = true;
    void QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0A0B0D', light: '#FFFFFF' },
    }).then((markup) => {
      if (alive) setSvg(markup);
    });
    return () => {
      alive = false;
    };
  }, [text]);

  return (
    <div className="qrsvg" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
