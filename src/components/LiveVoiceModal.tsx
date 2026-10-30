import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Captions,
  Keyboard,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  Send,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import type { LiveTurnRecord, LiveVoiceName } from '../types/nova.ts';
import {
  ALLOWED_LIVE_VOICES,
  LIVE_VOICE_DESCRIPTIONS,
  base64ToFloat32Pcm,
  computeRmsLevel,
  downsampleFloat32ToInt16Pcm,
  int16PcmToBase64,
} from '../utils/liveAudio.ts';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedVoice: LiveVoiceName;
  onChangeVoice: (voice: LiveVoiceName) => void;
  onRecordTurn: (turn: LiveTurnRecord) => void;
}

type ConnectionState = 'connecting' | 'ready' | 'error' | 'closed';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({
  isOpen,
  onClose,
  selectedVoice,
  onChangeVoice,
  onRecordTurn,
}) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isNovaSpeaking, setIsNovaSpeaking] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [showTextComposer, setShowTextComposer] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const [liveUserCaption, setLiveUserCaption] = useState('');
  const [liveAssistantCaption, setLiveAssistantCaption] = useState('');

  // Mutable refs for Web Audio / WebSocket / animation callbacks (zero stale closures)
  const wsRef = useRef<WebSocket | null>(null);
  const isMutedRef = useRef(false);
  const connectionStateRef = useRef<ConnectionState>('connecting');

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);

  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);

  const inputLevelRef = useRef(0);
  const smoothedLevelRef = useRef(0);
  const orbOuterRef = useRef<HTMLDivElement | null>(null);
  const orbCoreRef = useRef<HTMLDivElement | null>(null);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const rafIdRef = useRef<number | null>(null);

  const turnUserTextRef = useRef('');
  const turnAssistantTextRef = useRef('');
  const onRecordTurnRef = useRef(onRecordTurn);

  useEffect(() => {
    onRecordTurnRef.current = onRecordTurn;
  }, [onRecordTurn]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const flushTurnToHistory = useCallback(() => {
    const u = turnUserTextRef.current.trim();
    const a = turnAssistantTextRef.current.trim();
    if (u || a) {
      onRecordTurnRef.current({
        userText: u || '(Voice prompt)',
        assistantText: a,
      });
      turnUserTextRef.current = '';
      turnAssistantTextRef.current = '';
    }
  }, []);

  const stopAllPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsNovaSpeaking(false);
  }, []);

  const stopMicrophoneCapture = useCallback(() => {
    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null;
      try {
        processorNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      sourceNodeRef.current = null;
    }
    if (silentGainRef.current) {
      try {
        silentGainRef.current.disconnect();
      } catch {
        // Ignore
      }
      silentGainRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      void inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    inputLevelRef.current = 0;
  }, []);

  const ensureOutputAudioContext = useCallback(async (): Promise<AudioContext | null> => {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!outputAudioCtxRef.current || outputAudioCtxRef.current.state === 'closed') {
      const ctx = new AudioCtx({ sampleRate: 24000 });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      analyser.connect(ctx.destination);
      outputAudioCtxRef.current = ctx;
      outputAnalyserRef.current = analyser;
      nextStartTimeRef.current = 0;
    }

    if (outputAudioCtxRef.current.state === 'suspended') {
      try {
        await outputAudioCtxRef.current.resume();
      } catch {
        // Will resume on next user interaction if blocked
      }
    }

    return outputAudioCtxRef.current;
  }, []);

  const schedulePcm24kChunk = useCallback(
    async (base64Pcm: string) => {
      const float32 = base64ToFloat32Pcm(base64Pcm);
      if (float32.length === 0) return;

      const ctx = await ensureOutputAudioContext();
      if (!ctx || !outputAnalyserRef.current) return;

      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(outputAnalyserRef.current);

      activeSourcesRef.current.add(source);
      setIsNovaSpeaking(true);

      source.onended = () => {
        activeSourcesRef.current.delete(source);
        if (activeSourcesRef.current.size === 0) {
          setIsNovaSpeaking(false);
        }
      };

      const startAt = Math.max(ctx.currentTime + 0.015, nextStartTimeRef.current);
      source.start(startAt);
      nextStartTimeRef.current = startAt + audioBuffer.duration;
    },
    [ensureOutputAudioContext]
  );

  const startMicrophoneCapture = useCallback(async () => {
    stopMicrophoneCapture();
    setMicError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setMicError('Microphone access is unavailable in this browser. You can still type below and hear Nova speak live.');
      setShowTextComposer(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Verify modal wasn't closed while awaiting permission prompt
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      const inputCtx = new AudioCtx({ sampleRate: 16000 });
      if (inputCtx.state === 'suspended') {
        await inputCtx.resume().catch(() => {});
      }

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(2048, 1, 1);
      const silentGain = inputCtx.createGain();
      silentGain.gain.value = 0;

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(inputCtx.destination);

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (isMutedRef.current) {
          inputLevelRef.current = 0;
          return;
        }

        const channelData = event.inputBuffer.getChannelData(0);
        inputLevelRef.current = computeRmsLevel(channelData);

        const ws = wsRef.current;
        if (
          !ws ||
          ws.readyState !== WebSocket.OPEN ||
          connectionStateRef.current !== 'ready'
        ) {
          return;
        }

        const pcm16 = downsampleFloat32ToInt16Pcm(
          channelData,
          event.inputBuffer.sampleRate,
          16000
        );
        const base64Audio = int16PcmToBase64(pcm16);
        if (base64Audio) {
          ws.send(JSON.stringify({ type: 'audio', audio: base64Audio }));
        }
      };

      mediaStreamRef.current = stream;
      inputAudioCtxRef.current = inputCtx;
      sourceNodeRef.current = source;
      processorNodeRef.current = processor;
      silentGainRef.current = silentGain;
    } catch (err) {
      const denied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setMicError(
        denied
          ? 'Microphone permission was blocked. Allow microphone access or type below to talk with Nova Live.'
          : 'No microphone was detected. You can type below and hear Nova reply in real-time voice.'
      );
      setShowTextComposer(true);
    }
  }, [stopMicrophoneCapture]);

  // Connect WebSocket + audio pipeline when modal opens or voice/reconnect changes
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setConnectionState('connecting');
    connectionStateRef.current = 'connecting';
    setErrorMessage(null);
    setLiveUserCaption('');
    setLiveAssistantCaption('');
    turnUserTextRef.current = '';
    turnAssistantTextRef.current = '';

    void ensureOutputAudioContext();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/live?voice=${encodeURIComponent(
      selectedVoice
    )}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      void startMicrophoneCapture();
    };

    ws.onmessage = (event) => {
      if (cancelled) return;
      let msg: {
        type?: string;
        audio?: string;
        text?: string;
        message?: string;
      };
      try {
        msg = JSON.parse(String(event.data)) as typeof msg;
      } catch {
        return;
      }

      if (msg.type === 'ready') {
        connectionStateRef.current = 'ready';
        setConnectionState('ready');
        setErrorMessage(null);
        return;
      }

      if (msg.type === 'audio' && typeof msg.audio === 'string') {
        void schedulePcm24kChunk(msg.audio);
        return;
      }

      if (msg.type === 'input_transcript' && typeof msg.text === 'string') {
        if (turnUserTextRef.current === '' && turnAssistantTextRef.current === '') {
          setLiveAssistantCaption('');
        }
        turnUserTextRef.current += msg.text;
        setLiveUserCaption(turnUserTextRef.current.trim());
        return;
      }

      if (msg.type === 'output_transcript' && typeof msg.text === 'string') {
        turnAssistantTextRef.current += msg.text;
        setLiveAssistantCaption(turnAssistantTextRef.current.trim());
        return;
      }

      if (msg.type === 'interrupted') {
        stopAllPlayback();
        flushTurnToHistory();
        return;
      }

      if (msg.type === 'turn_complete') {
        flushTurnToHistory();
        return;
      }

      if (msg.type === 'error') {
        connectionStateRef.current = 'error';
        setConnectionState('error');
        setErrorMessage(msg.message || 'Live voice connection encountered an error.');
        return;
      }

      if (msg.type === 'session_closed') {
        if (connectionStateRef.current !== 'error') {
          connectionStateRef.current = 'closed';
          setConnectionState('closed');
        }
      }
    };

    ws.onerror = () => {
      if (cancelled) return;
      if (connectionStateRef.current !== 'error') {
        connectionStateRef.current = 'error';
        setConnectionState('error');
        setErrorMessage('Unable to connect to the Nova Live voice server.');
      }
    };

    ws.onclose = () => {
      if (cancelled) return;
      if (connectionStateRef.current !== 'error') {
        connectionStateRef.current = 'closed';
        setConnectionState('closed');
      }
    };

    return () => {
      cancelled = true;
      flushTurnToHistory();
      stopAllPlayback();
      stopMicrophoneCapture();
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'Client closed modal');
        } catch {
          // Ignore
        }
        wsRef.current = null;
      }
    };
  }, [
    ensureOutputAudioContext,
    flushTurnToHistory,
    isOpen,
    reconnectNonce,
    schedulePcm24kChunk,
    selectedVoice,
    startMicrophoneCapture,
    stopAllPlayback,
    stopMicrophoneCapture,
  ]);

  // Close output AudioContext completely when modal unmounts or closes
  useEffect(() => {
    if (isOpen) return;
    if (outputAudioCtxRef.current) {
      void outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
      outputAnalyserRef.current = null;
    }
    setElapsedSeconds(0);
    setIsMuted(false);
    setShowTextComposer(false);
    setTextDraft('');
  }, [isOpen]);

  // Call duration timer while connected
  useEffect(() => {
    if (!isOpen || connectionState !== 'ready') return;
    const interval = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isOpen, connectionState]);

  // 60fps audio-reactive visual loop driven via refs (zero React re-renders per frame)
  useEffect(() => {
    if (!isOpen) return;
    const outputSampleBuf = new Float32Array(256);

    const tick = () => {
      let outLevel = 0;
      const analyser = outputAnalyserRef.current;
      if (analyser && activeSourcesRef.current.size > 0) {
        analyser.getFloatTimeDomainData(outputSampleBuf);
        outLevel = computeRmsLevel(outputSampleBuf);
      }

      const inLevel = isMutedRef.current ? 0 : inputLevelRef.current;
      const target = Math.max(outLevel * 1.15, inLevel);
      smoothedLevelRef.current += (target - smoothedLevelRef.current) * 0.24;
      const level = smoothedLevelRef.current;

      if (orbOuterRef.current) {
        const outerScale = 1 + level * 0.42;
        orbOuterRef.current.style.transform = `scale(${outerScale.toFixed(3)})`;
        orbOuterRef.current.style.opacity = (0.18 + level * 0.55).toFixed(3);
      }

      if (orbCoreRef.current) {
        const coreScale = 1 + level * 0.16;
        orbCoreRef.current.style.transform = `scale(${coreScale.toFixed(3)})`;
      }

      const multipliers = [0.48, 0.82, 1.15, 0.78, 0.52];
      for (let i = 0; i < barRefs.current.length; i++) {
        const bar = barRefs.current[i];
        if (!bar) continue;
        const h = Math.round(10 + level * 36 * multipliers[i]);
        bar.style.height = `${Math.min(48, Math.max(8, h))}px`;
      }

      rafIdRef.current = window.requestAnimationFrame(tick);
    };

    rafIdRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isOpen]);

  // Escape key closes Live Voice
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleToggleMute = () => {
    void ensureOutputAudioContext();
    if (micError) {
      void startMicrophoneCapture();
      return;
    }
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (next && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'audio_stream_end' }));
      }
      return next;
    });
  };

  const handleSendTextToLive = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textDraft.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    void ensureOutputAudioContext();
    stopAllPlayback();
    flushTurnToHistory();

    turnUserTextRef.current = trimmed;
    turnAssistantTextRef.current = '';
    setLiveUserCaption(trimmed);
    setLiveAssistantCaption('');

    wsRef.current.send(JSON.stringify({ type: 'text', text: trimmed }));
    setTextDraft('');
  };

  const handleReconnect = () => {
    void ensureOutputAudioContext();
    setReconnectNonce((n) => n + 1);
  };

  if (!isOpen) return null;

  const statusHeadline =
    connectionState === 'connecting'
      ? 'Connecting to Nova Live…'
      : connectionState === 'error'
      ? 'Connection interrupted'
      : connectionState === 'closed'
      ? 'Session ended'
      : isNovaSpeaking
      ? 'Nova is speaking'
      : isMuted
      ? 'Microphone muted'
      : micError
      ? 'Live voice ready'
      : "Go ahead, I'm listening";

  const statusSubtext =
    connectionState === 'connecting'
      ? 'Opening low-latency Gemini Live audio channel'
      : connectionState === 'error'
      ? errorMessage || 'Check your connection and retry.'
      : connectionState === 'closed'
      ? 'Tap Reconnect to resume real-time voice conversation'
      : isNovaSpeaking
      ? 'Speak anytime or tap Interrupt to jump in'
      : isMuted
      ? 'Tap the microphone button below to resume speaking'
      : `${selectedVoice} · ${LIVE_VOICE_DESCRIPTIONS[selectedVoice]}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nova Live real-time voice conversation"
      className="fixed inset-0 z-50 flex flex-col justify-between bg-[#FAF9F5] text-[#141413] dark:bg-[#141413] dark:text-[#F5F4EF]"
    >
      {/* Top Bar */}
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              connectionState === 'ready'
                ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.55)]'
                : connectionState === 'connecting'
                ? 'animate-pulse bg-amber-500'
                : 'bg-[#C94A38]'
            }`}
          />
          <span className="text-sm font-semibold tracking-tight">Nova Live</span>
          <span className="font-mono text-xs text-[#6B6860] tabular-nums dark:text-[#9E9B92]">
            {formatDuration(elapsedSeconds)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <label className="sr-only" htmlFor="nova-live-voice-select">
            Voice persona
          </label>
          <div className="relative flex items-center">
            <Volume2 className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-[#6B6860] dark:text-[#9E9B92]" />
            <select
              id="nova-live-voice-select"
              value={selectedVoice}
              onChange={(e) => {
                void ensureOutputAudioContext();
                onChangeVoice(e.target.value as LiveVoiceName);
              }}
              aria-label="Select live voice"
              className="h-10 appearance-none rounded-full border border-[#E6E3DC] bg-white pr-7 pl-8 text-xs font-medium text-[#141413] transition-colors hover:border-[#CFCBC1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#141413]/20 dark:border-[#2E2D28] dark:bg-[#1E1D1A] dark:text-[#F5F4EF] dark:hover:border-[#45433C]"
            >
              {ALLOWED_LIVE_VOICES.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[#6B6860] dark:text-[#9E9B92]"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          <button
            type="button"
            onClick={() => setShowCaptions((v) => !v)}
            aria-label={showCaptions ? 'Hide live captions' : 'Show live captions'}
            aria-pressed={showCaptions}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
              showCaptions
                ? 'border-[#141413] bg-[#141413] text-white dark:border-[#F5F4EF] dark:bg-[#F5F4EF] dark:text-[#141413]'
                : 'border-[#E6E3DC] bg-white text-[#6B6860] hover:text-[#141413] dark:border-[#2E2D28] dark:bg-[#1E1D1A] dark:text-[#9E9B92] dark:hover:text-[#F5F4EF]'
            }`}
          >
            <Captions className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close live voice"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#E6E3DC] bg-white text-[#141413] transition-colors hover:bg-[#EFECE6] dark:border-[#2E2D28] dark:bg-[#1E1D1A] dark:text-[#F5F4EF] dark:hover:bg-[#2B2A26]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Center Stage: Sculptural Reactive Voice Orb + Editorial State + Live Captions */}
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-4 text-center">
        <div className="relative flex h-52 w-52 items-center justify-center sm:h-60 sm:w-60">
          {/* Outer audio-reactive halo */}
          <div
            ref={orbOuterRef}
            className={`pointer-events-none absolute inset-3 rounded-full transition-colors duration-300 ${
              isNovaSpeaking
                ? 'bg-[#D97757]/35 dark:bg-[#E08B6D]/30'
                : connectionState === 'ready' && !isMuted
                ? 'bg-[#141413]/15 dark:bg-[#F5F4EF]/20'
                : 'bg-[#8A877E]/15'
            }`}
          />

          {/* Core sculptural circle */}
          <div
            ref={orbCoreRef}
            className={`relative flex h-36 w-36 items-center justify-center rounded-full shadow-[0_18px_50px_rgba(20,20,19,0.16)] transition-colors duration-300 sm:h-40 sm:w-40 ${
              connectionState === 'error'
                ? 'bg-[#C94A38] text-white'
                : isMuted
                ? 'border border-[#DDD9CE] bg-[#EFECE6] text-[#6B6860] dark:border-[#34332E] dark:bg-[#252420] dark:text-[#9E9B92]'
                : isNovaSpeaking
                ? 'bg-[#141413] text-[#FAF9F5] ring-4 ring-[#D97757]/25 dark:bg-[#F5F4EF] dark:text-[#141413] dark:ring-[#E08B6D]/30'
                : 'bg-[#141413] text-[#FAF9F5] dark:bg-[#F5F4EF] dark:text-[#141413]'
            }`}
          >
            <div className="flex h-12 items-center justify-center gap-1.5" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((idx) => (
                <span
                  key={idx}
                  ref={(el) => {
                    barRefs.current[idx] = el;
                  }}
                  className="w-1.5 rounded-full bg-current transition-[height] duration-75"
                  style={{ height: idx === 2 ? '18px' : idx % 2 === 1 ? '13px' : '9px' }}
                />
              ))}
            </div>
          </div>
        </div>

        <h2 className="mt-4 font-serif text-[26px] leading-tight font-normal tracking-[-0.02em] sm:text-[32px]">
          {statusHeadline}
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-[#6B6860] dark:text-[#9E9B92]">
          {statusSubtext}
        </p>

        {/* Retry button on connection close or error */}
        {(connectionState === 'error' || connectionState === 'closed') && (
          <button
            type="button"
            onClick={handleReconnect}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#141413] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2B2A27] dark:bg-[#F5F4EF] dark:text-[#141413] dark:hover:bg-[#E3E1DA]"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Reconnect Live Voice</span>
          </button>
        )}

        {/* Microphone Fallback Notice */}
        {micError && connectionState === 'ready' && (
          <div className="mt-4 flex max-w-md items-start gap-2.5 rounded-2xl border border-[#E6E3DC] bg-white px-4 py-3 text-left text-xs text-[#5C5952] dark:border-[#2E2D28] dark:bg-[#1E1D1A] dark:text-[#B5B2A8]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#D97757]" />
            <div className="min-w-0 flex-1">
              <p>{micError}</p>
              <button
                type="button"
                onClick={() => void startMicrophoneCapture()}
                className="mt-1.5 font-semibold text-[#141413] underline underline-offset-2 dark:text-[#F5F4EF]"
              >
                Retry microphone access
              </button>
            </div>
          </div>
        )}

        {/* Live Streaming Captions */}
        {showCaptions && (liveUserCaption || liveAssistantCaption) && (
          <div
            aria-live="polite"
            className="mt-5 w-full max-w-lg space-y-2 rounded-2xl border border-[#E6E3DC] bg-white/85 px-4 py-3.5 text-left shadow-xs backdrop-blur-xs dark:border-[#2E2D28] dark:bg-[#1E1D1A]/85"
          >
            {liveUserCaption && (
              <p className="text-xs leading-relaxed text-[#6B6860] dark:text-[#9E9B92]">
                <span className="mr-1.5 font-semibold text-[#141413] dark:text-[#F5F4EF]">
                  You:
                </span>
                {liveUserCaption}
              </p>
            )}
            {liveAssistantCaption && (
              <p className="max-h-28 overflow-y-auto text-sm leading-relaxed text-[#141413] dark:text-[#F5F4EF]">
                <span className="mr-1.5 font-semibold text-[#D97757]">Nova:</span>
                {liveAssistantCaption}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls & Optional Silent Text-to-Voice Bar */}
      <div className="mx-auto w-full max-w-xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
        {showTextComposer && (
          <form
            onSubmit={handleSendTextToLive}
            className="mb-3 flex items-center gap-2 rounded-full border border-[#E6E3DC] bg-white px-3.5 py-1.5 shadow-sm dark:border-[#2E2D28] dark:bg-[#1E1D1A]"
          >
            <input
              type="text"
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              placeholder={
                connectionState === 'ready'
                  ? 'Type to Nova Live (speaks reply aloud)…'
                  : 'Waiting for Live connection…'
              }
              disabled={connectionState !== 'ready'}
              aria-label="Type message to Nova Live"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-[#141413] placeholder:text-[#8A877E] focus:outline-none disabled:opacity-50 dark:text-[#F5F4EF]"
            />
            <button
              type="submit"
              disabled={!textDraft.trim() || connectionState !== 'ready'}
              aria-label="Send message to Nova Live"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#141413] text-white transition-opacity disabled:opacity-35 dark:bg-[#F5F4EF] dark:text-[#141413]"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}

        <div className="flex items-center justify-center gap-3 sm:gap-4">
          {/* Mute / Unmute Microphone */}
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={
              micError
                ? 'Retry microphone'
                : isMuted
                ? 'Unmute microphone'
                : 'Mute microphone'
            }
            aria-pressed={isMuted}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full border transition-all active:scale-95 ${
              isMuted || micError
                ? 'border-[#141413] bg-[#141413] text-white dark:border-[#F5F4EF] dark:bg-[#F5F4EF] dark:text-[#141413]'
                : 'border-[#E6E3DC] bg-white text-[#141413] hover:bg-[#EFECE6] dark:border-[#2E2D28] dark:bg-[#1E1D1A] dark:text-[#F5F4EF] dark:hover:bg-[#2B2A26]'
            }`}
          >
            {isMuted || micError ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>

          {/* Interrupt Nova Playback (when Nova is actively speaking) */}
          {isNovaSpeaking && (
            <button
              type="button"
              onClick={stopAllPlayback}
              aria-label="Interrupt Nova speech"
              className="inline-flex h-14 items-center gap-2 rounded-full border border-[#E6E3DC] bg-white px-5 text-sm font-medium text-[#141413] transition-all hover:bg-[#EFECE6] active:scale-95 dark:border-[#2E2D28] dark:bg-[#1E1D1A] dark:text-[#F5F4EF] dark:hover:bg-[#2B2A26]"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>Interrupt</span>
            </button>
          )}

          {/* Toggle Silent Text Input */}
          <button
            type="button"
            onClick={() => setShowTextComposer((v) => !v)}
            aria-label={showTextComposer ? 'Hide text input' : 'Type to Nova Live'}
            aria-pressed={showTextComposer}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full border transition-all active:scale-95 ${
              showTextComposer
                ? 'border-[#141413] bg-[#141413] text-white dark:border-[#F5F4EF] dark:bg-[#F5F4EF] dark:text-[#141413]'
                : 'border-[#E6E3DC] bg-white text-[#141413] hover:bg-[#EFECE6] dark:border-[#2E2D28] dark:bg-[#1E1D1A] dark:text-[#F5F4EF] dark:hover:bg-[#2B2A26]'
            }`}
          >
            <Keyboard className="h-5 w-5" />
          </button>

          {/* End Live Conversation */}
          <button
            type="button"
            onClick={onClose}
            aria-label="End live voice conversation"
            className="inline-flex h-14 items-center gap-2 rounded-full bg-[#C94A38] px-6 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#B43E2D] active:scale-95"
          >
            <PhoneOff className="h-4 w-4" />
            <span>End</span>
          </button>
        </div>
      </div>
    </div>
  );
};
