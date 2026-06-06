/**
 * Renders a scannable QR of the share link (issue 005). Dark modules on a white field so it
 * scans regardless of the app's dark theme. The QR carries the link — which holds the Pairing
 * secret in its #fragment — so a scan recovers the same secret as opening the link (ADR 0001).
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
