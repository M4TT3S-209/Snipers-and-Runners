import qrcode from 'qrcode-generator';
import { useMemo } from 'preact/hooks';

/** QR-Code als SVG (lokal erzeugt – kein externer Dienst). */
export function QrCode({ text, size = 200 }: { text: string; size?: number }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }, [text]);
  return <div class="qr" style={{ width: `${size}px`, height: `${size}px` }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
