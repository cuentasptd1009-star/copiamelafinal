import { useState, useRef, useCallback, useEffect } from 'react';

interface UseVoiceSearchOptions {
  onResult: (transcript: string) => void;
  onError?: (error: string) => void;
  lang?: string;
}

interface UseVoiceSearchReturn {
  isListening: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;

function getSpeechRecognition(): (new () => AnyRecognition) | null {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

export function useVoiceSearch({
  onResult,
  onError,
  lang = 'es-ES',
}: UseVoiceSearchOptions): UseVoiceSearchReturn {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<AnyRecognition>(null);
  const isSupported = !!getSpeechRecognition();

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    const API = getSpeechRecognition();
    if (!API) return;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    const recognition = new API();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      const transcript: string = event.results?.[0]?.[0]?.transcript ?? '';
      const cleaned = transcript.trim().replace(/[.,!?;:…]+$/, '');
      if (cleaned) onResult(cleaned);
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'aborted') {
        onError?.(event.error);
      }
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
    }
  }, [lang, onResult, onError]);

  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  return { isListening, isSupported, startListening, stopListening };
}
