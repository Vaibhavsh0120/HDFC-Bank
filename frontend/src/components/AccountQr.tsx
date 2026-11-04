import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Camera, ChevronRight, Copy, Download, ImagePlus, Info, Landmark, QrCode, ScanLine } from 'lucide-react';
import { type Account } from '../lib/banking';
import { saveFile } from '../lib/files';

const prefix = 'HDFC-BANK:ACCOUNT:';
const accountNumber = /^9[01][0-9]{10}$/;
export type QrPayment = { number: string; amount?: string; description?: string };

export function parseAccountQr(value: string): QrPayment {
  if (!value.startsWith(prefix) || value.length > 1200) throw new Error('Scan an account QR code from this project. UPI and merchant codes are not supported.');
  const [number, query = ''] = value.slice(prefix.length).split('?');
  if (!accountNumber.test(number)) throw new Error('This account QR code is invalid.');
  const params = new URLSearchParams(query);
  const amount = params.get('amount') || undefined;
  const description = params.get('note') || undefined;
  if (amount && (!/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 9999999999.99)) throw new Error('The amount in this QR code is invalid. Ask for a new code.');
  if (description && description.length > 140) throw new Error('The note in this QR code is too long.');
  return { number, amount, description };
}

async function readImage(file: File): Promise<QrPayment> {
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Image scanning is unavailable. Enter the account number instead.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import('jsqr');
    const found = jsQR(pixels.data, pixels.width, pixels.height);
    if (!found) throw new Error('No QR code found. Choose a clearer image or enter the account number.');
    return parseAccountQr(found.data);
  } finally { URL.revokeObjectURL(url); }
}

export function QrImageInput({ onScan }: { onScan: (payment: QrPayment) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { onScan(await readImage(file)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to read this image. Choose a PNG or JPEG.'); }
    finally { setBusy(false); }
  }
  return <div className="form-stack">
    <label className="btn secondary upload-button"><ImagePlus size={18} /> {busy ? 'Reading QR image…' : 'Upload QR image'}<input aria-label="Upload QR image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={upload} /></label>
    {error && <p className="feedback error" role="alert">{error}</p>}
  </div>;
}

export function ReceiveQr({ account }: { account: Account }) {
  const [feedback, setFeedback] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const qr = useRef<HTMLDivElement>(null);
  const valid = !amount || (/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= 9999999999.99);
  const params = new URLSearchParams();
  if (amount && valid) params.set('amount', Number(amount).toFixed(2));
  if (note.trim()) params.set('note', note.trim());
  const value = prefix + account.number + (params.size ? '?' + params : '');
  async function download() {
    setFeedback('');
    const svg = qr.current?.querySelector('svg'); if (!svg) return;
    try {
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1000;
      const context = canvas.getContext('2d'); if (!context) throw new Error();
      context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 1000); context.drawImage(image, 80, 30, 640, 640);
      context.fillStyle = '#132a57'; context.textAlign = 'center'; context.font = 'bold 28px sans-serif';
      context.fillText(account.name.slice(0, 40), 400, 740, 700); context.fillText(account.number, 400, 790);
      context.font = '24px sans-serif'; if (amount) context.fillText('INR ' + Number(amount).toFixed(2), 400, 840);
      context.fillText('Student project • Virtual funds only', 400, 920);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(), 'image/png'));
      await saveFile(blob, 'account-qr-' + account.number.slice(-4) + '.png');
      setFeedback(Capacitor.isNativePlatform() ? 'QR sharing opened.' : 'QR image downloaded.');
    } catch { setFeedback('Unable to save the QR image. You can take a screenshot or copy your account number.'); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(account.number); setFeedback('Account number copied.'); }
    catch { setFeedback('Select the account number below to copy it.'); }
  }
  return <section className="panel receive-panel">
    <h2>Your receive QR</h2><p>Share with another account holder in this project. You never need a PIN to receive money.</p>
    {account.status === 'Frozen' ? <p className="feedback error">Your account is frozen. It cannot receive transfers. Contact support.</p> : <>
      {valid ? <div ref={qr} className="receive-code"><QRCodeSVG value={value} size={240} marginSize={4} title="Your account QR code" /></div> : <p className="feedback error" role="alert">Enter a positive amount with up to two decimal places.</p>}
      <strong>{account.name}</strong><span className="receive-number">{account.number}</span>
      <div className="form-stack receive-options"><label>Request amount (INR) <small>Optional</small><input inputMode="decimal" value={amount} maxLength={13} onChange={event => setAmount(event.target.value)} placeholder="Any amount" /></label>
        <label>Payment note <small>Optional</small><input value={note} maxLength={140} onChange={event => setNote(event.target.value)} /></label></div>
      <div className="button-row"><button className="btn secondary compact" onClick={copy}><Copy size={16} /> Copy number</button><button className="btn primary compact" onClick={download} disabled={!valid}><Download size={16} /> Save / share QR</button></div>
    </>}
    {feedback && <p role="status">{feedback}</p>}
  </section>;
}

export function QrScanner({ onScan, close }: { onScan: (payment: QrPayment) => void; close: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; let stream: MediaStream | undefined; let frame = 0; let lastFrame = 0;
    const stop = () => { stream?.getTracks().forEach(track => track.stop()); cancelAnimationFrame(frame); };
    const canvas = document.createElement('canvas');
    async function start() {
      setError('');
      if (!navigator.mediaDevices?.getUserMedia) { setError('Camera scanning needs HTTPS or localhost. Upload a QR image or enter the account number.'); return; }
      try {
        const { default: jsQR } = await import('jsqr');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (!active || !video.current) { stop(); return; }
        video.current.srcObject = stream; await video.current.play();
        const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Camera unavailable');
        const scan = (now: number) => {
          if (!active || !video.current) return;
          const element = video.current;
          if (now - lastFrame > 150 && element.readyState >= 2 && element.videoWidth && element.videoHeight) {
            lastFrame = now;
            const scale = Math.min(1, 900 / Math.max(element.videoWidth, element.videoHeight));
            canvas.width = Math.round(element.videoWidth * scale); canvas.height = Math.round(element.videoHeight * scale);
            context.drawImage(element, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(pixels.data, pixels.width, pixels.height);
            if (found) {
              try { const payment = parseAccountQr(found.data); stop(); onScan(payment); return; }
              catch (error) { setError((error as Error).message); }
            }
          }
          frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch { stop(); if (active) setError('Unable to access your camera. Check permission, retry, upload an image or enter the account number.'); }
    }
    const visibility = () => { if (document.hidden) { stop(); setError('Camera paused. Retry when you are ready.'); } };
    document.addEventListener('visibilitychange', visibility); void start();
    return () => { active = false; stop(); document.removeEventListener('visibilitychange', visibility); };
  }, [onScan, retry]);
  return <div className="scanner">
    <p><Camera size={17} /> Scan the recipient’s account QR code.</p>
    <video ref={video} playsInline muted aria-label="Camera preview" />
    {error && <p className="feedback error" role="alert">{error}</p>}
    <div className="button-row">{error && <button type="button" className="btn secondary compact" onClick={() => setRetry(value => value + 1)}>Retry camera</button>}<button type="button" className="btn secondary compact" onClick={close}>Close scanner</button></div>
  </div>;
}

export function PaymentHub({ account, onPay, initialMode = 'pay' }: { account: Account; onPay: (payment?: QrPayment) => void; initialMode?: 'pay' | 'receive' }) {
  const [tab, setTab] = useState<'pay' | 'receive'>(initialMode);
  const [qrMode, setQrMode] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [nativeScanning, setNativeScanning] = useState(false);
  const [error, setError] = useState('');
  const scanned = useCallback((payment: QrPayment) => {
    if (payment.number === account.number) { setError('This is your own QR code. Scan another account’s code to send money.'); setScanning(false); return; }
    setError(''); setScanning(false); onPay(payment);
  }, [account.number, onPay]);
  async function startScanner() {
    setError('');
    if (!Capacitor.isNativePlatform()) { setScanning(true); return; }
    if (nativeScanning) return;
    setNativeScanning(true);
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner');
      const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: 'Scan a project account QR code' });
      if (result.ScanResult) scanned(parseAccountQr(result.ScanResult));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to open the scanner. Check camera permission or upload a QR image.');
    } finally { setNativeScanning(false); }
  }
  const unavailable = account.status !== 'Active' || account.payment_locked;
  return <div className="payments-screen"><div className="page-heading"><p className="eyebrow">PAYMENTS</p><h1>Scan & pay</h1><p>Send and receive money between accounts in this project.</p></div>
    <div className="tab-bar" role="group" aria-label="Payment mode"><button aria-pressed={tab === 'pay'} onClick={() => { setTab('pay'); setScanning(false); setQrMode(false); setError(''); }}>Send money</button><button aria-pressed={tab === 'receive'} onClick={() => { setTab('receive'); setScanning(false); setQrMode(false); setError(''); }}>Receive money</button></div>
    {tab === 'receive' ? <ReceiveQr account={account} /> : <section className="panel payment-methods" aria-labelledby="payment-method-title">
      {qrMode && <button type="button" className="text-link payment-back" onClick={() => { setQrMode(false); setScanning(false); setError(''); }}><ArrowLeft size={17} /> Back to payment methods</button>}
      <div className={qrMode ? 'payment-method-heading' : undefined}><span className="icon-box payment-heading-icon"><QrCode size={26} /></span><div><h2 id="payment-method-title">{qrMode ? 'Pay with QR' : 'Pay another account'}</h2><p className="muted payment-intro">{qrMode ? 'Use an account QR code.' : 'Choose how you want to pay.'}</p></div></div>
      {unavailable ? <p className="feedback error">{account.status !== 'Active' ? 'Your account is frozen. Contact support.' : 'Your outgoing payments are locked. Unlock them in Profile & settings.'}</p> : <>
        {qrMode ? <div className="form-stack payment-qr-controls">
          {scanning ? <QrScanner onScan={scanned} close={() => setScanning(false)} /> : <button className="btn primary" disabled={nativeScanning} onClick={startScanner}><Camera size={18} /> {nativeScanning ? 'Scanning…' : 'Scan QR code'}</button>}
          <QrImageInput onScan={scanned} />
        </div> : <div className="payment-options">
          <button type="button" className="payment-option payment-option-primary" onClick={() => setQrMode(true)}><span className="payment-option-icon"><ScanLine size={28} /></span><span className="payment-option-copy"><strong>Pay with QR</strong><span>Scan a QR code or upload an image</span></span><ChevronRight className="payment-option-chevron" size={25} /></button>
          <button type="button" className="payment-option" onClick={() => onPay()}><span className="payment-option-icon"><Landmark size={28} /></span><span className="payment-option-copy"><strong>Pay with account number</strong><span>Enter recipient details manually</span></span><ChevronRight className="payment-option-chevron" size={25} /></button>
        </div>}
      </>}
      {error && <p className="feedback error" role="alert">{error}</p>}
      <p className="muted payment-support-note"><Info size={19} /><span>Project accounts only. No UPI or external bank transfers.</span></p>
    </section>}
  </div>;
}
