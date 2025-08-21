/**
 * 웹 오디오 API를 사용해서 간단한 사운드를 생성하는 유틸리티
 */

// 음향 관련 상수들 - 매직 넘버 제거
const AUDIO_CONSTANTS = {
  // 기본 사운드 설정
  DEFAULT_FREQUENCY: 800,
  DEFAULT_DURATION: 200,
  DEFAULT_VOLUME: 0.1,
  
  // 성공 사운드 (C 메이저 화음)
  SUCCESS_NOTES: {
    C: 523.25,    // C5
    E: 659.25,    // E5  
    G: 783.99     // G5
  },
  SUCCESS_DURATIONS: {
    FIRST: 150,
    SECOND: 150,
    THIRD: 300
  },
  SUCCESS_DELAYS: {
    SECOND: 100,
    THIRD: 200
  },
  
  // 에러 사운드 (하강 톤)
  ERROR_FREQUENCIES: {
    HIGH: 800,
    MIDDLE: 600,
    LOW: 400
  },
  ERROR_DURATIONS: {
    HIGH: 200,
    MIDDLE: 200,
    LOW: 300
  },
  ERROR_DELAYS: {
    MIDDLE: 150,
    LOW: 300
  },
  
  // 타이밍 관련
  FADE_IN_TIME: 0.01,
  CLEANUP_TIMEOUT: 1000, // 1초 후 정리
} as const;

// 오디오 컨텍스트 타입 정의
type AudioContextType = AudioContext | null;
type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

// 글로벌 오디오 컨텍스트와 정리용 타이머들
let audioContext: AudioContextType = null;
let cleanupTimers: Set<NodeJS.Timeout> = new Set();
let activeOscillators: Set<OscillatorNode> = new Set();

function getAudioContext(): AudioContext | null {
  try {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        console.warn('Web Audio API는 이 브라우저에서 지원되지 않습니다.');
        return null;
      }
      audioContext = new AudioContextClass();
    }
    return audioContext;
  } catch (error) {
    console.error('오디오 컨텍스트 생성 실패:', error);
    return null;
  }
}

/**
 * 오디오 컨텍스트와 관련 리소스 정리
 * 메모리 누수 방지를 위한 cleanup 메커니즘
 */
function cleanupAudioResources(): void {
  // 활성 oscillator들 정리
  activeOscillators.forEach(oscillator => {
    try {
      oscillator.disconnect();
      oscillator.stop();
    } catch (error) {
      // 이미 정리되었을 수 있으므로 에러 무시
    }
  });
  activeOscillators.clear();
  
  // 타이머들 정리
  cleanupTimers.forEach(timer => {
    clearTimeout(timer);
  });
  cleanupTimers.clear();
  
  // 오디오 컨텍스트 정리 (필요시)
  if (audioContext && audioContext.state !== 'closed') {
    try {
      // 컨텍스트를 즉시 닫지 않고 suspend만 함
      // (다른 사운드가 재생될 수 있으므로)
      if (audioContext.state === 'running') {
        audioContext.suspend();
      }
    } catch (error) {
      console.warn('오디오 컨텍스트 suspend 실패:', error);
    }
  }
}

/**
 * 오디오 컨텍스트 완전 종료 (페이지 언로드 시 사용)
 */
export function closeAudioContext(): void {
  cleanupAudioResources();
  
  if (audioContext) {
    try {
      audioContext.close();
      audioContext = null;
    } catch (error) {
      console.warn('오디오 컨텍스트 종료 실패:', error);
    }
  }
}

/**
 * 간단한 beep 사운드 생성 및 재생
 */
export function playBeepSound(
  frequency: number = AUDIO_CONSTANTS.DEFAULT_FREQUENCY, 
  duration: number = AUDIO_CONSTANTS.DEFAULT_DURATION, 
  type: OscillatorType = 'sine'
): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      return false;
    }
    
    // 사용자 상호작용 후에만 오디오 컨텍스트 시작 가능
    if (ctx.state === 'suspended') {
      ctx.resume().catch(error => {
        console.warn('오디오 컨텍스트 재개 실패:', error);
      });
    }
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    // 활성 oscillator 추적 (cleanup용)
    activeOscillators.add(oscillator);
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    oscillator.type = type;
    
    // 볼륨 조절 (부드러운 fade in/out)
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(AUDIO_CONSTANTS.DEFAULT_VOLUME, ctx.currentTime + AUDIO_CONSTANTS.FADE_IN_TIME);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    
    const stopTime = ctx.currentTime + duration / 1000;
    oscillator.start(ctx.currentTime);
    oscillator.stop(stopTime);
    
    // 사운드 완료 후 정리
    const cleanupTimer = setTimeout(() => {
      activeOscillators.delete(oscillator);
      cleanupTimers.delete(cleanupTimer);
      
      try {
        oscillator.disconnect();
      } catch (error) {
        // 이미 정리되었을 수 있으므로 에러 무시
      }
    }, duration + 100); // 약간의 여유시간
    
    cleanupTimers.add(cleanupTimer);
    
    return true;
  } catch (error) {
    console.error('Beep 사운드 재생 실패:', error);
    return false;
  }
}

/**
 * 성공 사운드 (상승하는 톤 - C 메이저 화음)
 */
export function playSuccessSound(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      return false;
    }
    
    if (ctx.state === 'suspended') {
      ctx.resume().catch(error => {
        console.warn('오디오 컨텍스트 재개 실패:', error);
      });
    }
    
    // C 메이저 화음으로 성공 사운드 재생
    const notes = [
      { 
        frequency: AUDIO_CONSTANTS.SUCCESS_NOTES.C, 
        duration: AUDIO_CONSTANTS.SUCCESS_DURATIONS.FIRST,
        delay: 0 
      },
      { 
        frequency: AUDIO_CONSTANTS.SUCCESS_NOTES.E, 
        duration: AUDIO_CONSTANTS.SUCCESS_DURATIONS.SECOND,
        delay: AUDIO_CONSTANTS.SUCCESS_DELAYS.SECOND 
      },
      { 
        frequency: AUDIO_CONSTANTS.SUCCESS_NOTES.G, 
        duration: AUDIO_CONSTANTS.SUCCESS_DURATIONS.THIRD,
        delay: AUDIO_CONSTANTS.SUCCESS_DELAYS.THIRD 
      }
    ];
    
    notes.forEach(note => {
      const timer = setTimeout(() => {
        playBeepSound(note.frequency, note.duration, 'sine');
      }, note.delay);
      
      cleanupTimers.add(timer);
    });
    
    return true;
  } catch (error) {
    console.error('성공 사운드 재생 실패:', error);
    return false;
  }
}

/**
 * 오류 사운드 (하강하는 톤)
 */
export function playErrorSound(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      return false;
    }
    
    if (ctx.state === 'suspended') {
      ctx.resume().catch(error => {
        console.warn('오디오 컨텍스트 재개 실패:', error);
      });
    }
    
    // 하강 톤으로 에러 사운드 재생
    const errorTones = [
      {
        frequency: AUDIO_CONSTANTS.ERROR_FREQUENCIES.HIGH,
        duration: AUDIO_CONSTANTS.ERROR_DURATIONS.HIGH,
        delay: 0
      },
      {
        frequency: AUDIO_CONSTANTS.ERROR_FREQUENCIES.MIDDLE,
        duration: AUDIO_CONSTANTS.ERROR_DURATIONS.MIDDLE,
        delay: AUDIO_CONSTANTS.ERROR_DELAYS.MIDDLE
      },
      {
        frequency: AUDIO_CONSTANTS.ERROR_FREQUENCIES.LOW,
        duration: AUDIO_CONSTANTS.ERROR_DURATIONS.LOW,
        delay: AUDIO_CONSTANTS.ERROR_DELAYS.LOW
      }
    ];
    
    errorTones.forEach(tone => {
      const timer = setTimeout(() => {
        playBeepSound(tone.frequency, tone.duration, 'square');
      }, tone.delay);
      
      cleanupTimers.add(timer);
    });
    
    return true;
  } catch (error) {
    console.error('오류 사운드 재생 실패:', error);
    return false;
  }
}

/**
 * 모든 진행 중인 사운드 중단
 */
export function stopAllSounds(): void {
  cleanupAudioResources();
}

// 브라우저 페이지 언로드 시 리소스 정리
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', closeAudioContext);
  window.addEventListener('unload', closeAudioContext);
}