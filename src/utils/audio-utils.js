/**
 * 웹 오디오 API를 사용해서 간단한 사운드를 생성하는 유틸리티
 */

let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

/**
 * 간단한 beep 사운드 생성 및 재생
 */
export function playBeepSound(frequency = 800, duration = 200, type = 'sine') {
  try {
    const ctx = getAudioContext();
    
    // 사용자 상호작용 후에만 오디오 컨텍스트 시작 가능
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    oscillator.type = type;
    
    // 볼륨 조절 (0.0 ~ 1.0)
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration / 1000);
    
    return true;
  } catch (error) {
    console.error('Beep 사운드 재생 실패:', error);
    return false;
  }
}

/**
 * 성공 사운드 (상승하는 톤)
 */
export function playSuccessSound() {
  try {
    const ctx = getAudioContext();
    
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    // 첫 번째 톤 (C)
    setTimeout(() => playBeepSound(523.25, 150, 'sine'), 0);
    // 두 번째 톤 (E)
    setTimeout(() => playBeepSound(659.25, 150, 'sine'), 100);
    // 세 번째 톤 (G)
    setTimeout(() => playBeepSound(783.99, 300, 'sine'), 200);
    
    return true;
  } catch (error) {
    console.error('성공 사운드 재생 실패:', error);
    return false;
  }
}

/**
 * 오류 사운드 (하강하는 톤)
 */
export function playErrorSound() {
  try {
    const ctx = getAudioContext();
    
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    // 첫 번째 톤 (높은 음)
    setTimeout(() => playBeepSound(800, 200, 'square'), 0);
    // 두 번째 톤 (중간 음)
    setTimeout(() => playBeepSound(600, 200, 'square'), 150);
    // 세 번째 톤 (낮은 음)
    setTimeout(() => playBeepSound(400, 300, 'square'), 300);
    
    return true;
  } catch (error) {
    console.error('오류 사운드 재생 실패:', error);
    return false;
  }
}