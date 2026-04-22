// vad.js - Smart Voice Activity Detection
// Auto-detect speech. 2.3s silence = final submit.

class PinoVAD {
  constructor(socket, options = {}) {
    this.socket = socket;
    this.silenceMs = options.silenceMs || 2300;
    this.speechThresh = options.speechThresh || 0.012;
    this.pollMs = options.pollMs || 48;
    this.minBlobBytes = options.minBlobBytes || 500;

    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.mediaRecorder = null;

    this.silenceTimer = null;
    this.audioChunks = [];
    this.isSpeaking = false;
    this.captureActive = false;
    this.isActive = false;
    this.isPaused = false;
    this.lastUiState = '';

    this.onStateChange = options.onStateChange || (() => {});
  }

  _setState(state) {
    if (this.lastUiState === state) return;
    this.lastUiState = state;
    this.onStateChange(state);
  }

  async start() {
    if (this.isActive) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);

    const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    this.mediaRecorder = preferredType
      ? new MediaRecorder(this.stream, { mimeType: preferredType })
      : new MediaRecorder(this.stream);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0 && this.captureActive) {
        this.audioChunks.push(e.data);
      }
    };

    this.mediaRecorder.start(100);
    this.isActive = true;
    this._setState('idle');
    this._poll();
  }

  pause() {
    this.isPaused = true;
    this.captureActive = false;
    this.isSpeaking = false;
    clearTimeout(this.silenceTimer);
    this._setState('idle');
  }

  resume() {
    this.isPaused = false;
    this._setState('idle');
  }

  _getRMS() {
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }

  _poll() {
    if (!this.isActive) return;

    if (!this.isPaused && this.analyser) {
      const rms = this._getRMS();
      const speaking = rms > this.speechThresh;

      if (speaking) {
        if (!this.isSpeaking) {
          this.isSpeaking = true;
          if (!this.captureActive) {
            this.audioChunks = [];
            this.captureActive = true;
          }
          this._setState('speaking');
        }

        // KEY LOGIC: Every time speech is detected, reset the silence timer
        // This allows short pauses (1-2 sec) to be merged into the same utterance
        clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(() => this._onSilenceFinal(), this.silenceMs);
      } else if (this.isSpeaking) {
        // Went quiet - show paused state but don't submit yet
        this.isSpeaking = false;
        this._setState('paused');
        // silenceTimer is still running from last speech - if they speak again
        // within 2.3s, the timer will be reset above
      }
    }

    setTimeout(() => this._poll(), this.pollMs);
  }

  _onSilenceFinal() {
    if (!this.captureActive) return;

    this.isSpeaking = false;
    this.captureActive = false;
    this._setState('processing');

    const blob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
    this.audioChunks = [];

    if (blob.size < this.minBlobBytes) {
      this._setState('idle');
      return;
    }

    blob.arrayBuffer().then((buf) => {
      this.socket.emit('audio_chunk_final', buf);
    }).catch(() => {
      this._setState('idle');
    });
  }

  stop() {
    this.isActive = false;
    this.isPaused = false;
    this.captureActive = false;
    this.isSpeaking = false;
    clearTimeout(this.silenceTimer);

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    if (this.audioCtx) {
      this.audioCtx.close();
    }
  }
}

window.PinoVAD = PinoVAD;
