import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Camera, Copy } from 'lucide-react';

const prefix = 'HDFC-BANK:ACCOUNT:';
const accountNumber = /^9[01][0-9]{10}$/;

export function ReceiveQr({ number }: { number: string }) {
  const [feedback, setFeedback] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(number);
      setFeedback('Account number copied.');
    } catch {
      setFeedback('Select the account number below to copy it.');
    }
  }
  return <section className="panel receive-panel">
    <h2>Receive a transfer</h2>
    <p>Share this code with another account holder. They can scan it to enter your account number.</p>
    <div className="receive-code"><QRCodeSVG value={prefix + number} size={220} marginSize={4} title="Your account QR code" /></div>
    <span className="receive-number">{number}</span>
    <button className="btn secondary compact" onClick={copy}><Copy size={16} /> Copy account number</button>
    {feedback && <p role="status">{feedback}</p>}
  </section>;
}

export function QrScanner({ onScan, close }: { onScan: (number: string) => void; close: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let stream: MediaStream | undefined;
    let frame = 0;
    const canvas = document.createElement('canvas');
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera scanning is unavailable here. Enter the account number instead.');
        return;
      }
      try {
        const { default: jsQR } = await import('jsqr');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!active) { stream.getTracks().forEach(track => track.stop()); return; }
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Camera unavailable');
        const scan = () => {
          if (!active || !video.current) return;
          const element = video.current;
          if (element.readyState >= 2 && element.videoWidth && element.videoHeight) {
            canvas.width = element.videoWidth;
            canvas.height = element.videoHeight;
            context.drawImage(element, 0, 0);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
            if (found) {
              const number = found.data.startsWith(prefix) ? found.data.slice(prefix.length) : '';
              if (accountNumber.test(number)) { onScan(number); return; }
              setError('This is not a supported account code. Scan an HDFC Bank account code.');
            }
          }
          frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch {
        if (active) setError('Unable to access the camera. Check permission or enter the account number instead.');
      }
    }
    void start();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [onScan]);

  return <div className="scanner">
    <p><Camera size={17} /> Point your camera at an account QR code.</p>
    <video ref={video} playsInline muted aria-label="Camera preview" />
    {error && <p className="feedback error" role="alert">{error}</p>}
    <button type="button" className="btn secondary compact" onClick={close}>Close camera</button>
  </div>;
}
