// canvas-record.js — 브라우저 Canvas 고품질 녹화
// agent-browser eval -b <base64> 로 주입하여 사용.

(function() {
  if (window.__mediaRecorder && window.__mediaRecorder.state === 'recording') {
    return JSON.stringify({ status: 'already_recording' });
  }
  const canvas = document.querySelector('canvas');
  if (!canvas) return JSON.stringify({ error: 'Canvas element not found' });

  const width = canvas.width;
  const height = canvas.height;
  const stream = canvas.captureStream(30);

  const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  let selectedMime = '';
  for (const mime of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mime)) { selectedMime = mime; break; }
  }
  if (!selectedMime) return JSON.stringify({ error: 'No supported video MIME type' });

  const recorder = new MediaRecorder(stream, {
    mimeType: selectedMime,
    videoBitsPerSecond: 8000000
  });
  const chunks = [];

  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: selectedMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.id = '__download_recording';
    a.href = url;
    a.download = 'gameplay-canvas.webm';
    a.textContent = 'Download Recording';
    a.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;padding:20px;background:red;color:white;font-size:24px;cursor:pointer;border-radius:8px;';
    document.body.appendChild(a);
    window.__lastRecording = { url, size: blob.size, type: blob.type, chunks: chunks.length };
    window.__mediaRecorder = null;
  };

  window.__mediaRecorder = recorder;
  window.__stopRecording = function() {
    if (window.__mediaRecorder && window.__mediaRecorder.state === 'recording') {
      window.__mediaRecorder.stop();
      return JSON.stringify({ status: 'stopped' });
    }
    return JSON.stringify({ error: 'No recording in progress' });
  };

  recorder.start(1000);
  return JSON.stringify({ status: 'recording', canvas: { width, height }, mimeType: selectedMime, bitrate: '8 Mbps', fps: 30 });
})();
