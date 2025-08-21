// 알림 상태 타입 정의 (QueueMessage의 status와 호환)
type TaskStatus = 'pending' | 'processing' | 'completed' | 'error';

// 알림 설정 타입
interface NotificationConfig {
  title: string;
  body: string;
  icon: string;
  sound: string | null;
  requireInteraction?: boolean;
}

// 사운드 타입 정의
type SoundType = 'success' | 'error';

/**
 * 브라우저 알림 및 사운드 알림을 관리하는 클래스
 */
class NotificationManager {
  static isSupported(): boolean {
    return "Notification" in window;
  }

  static async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) {
      console.warn('이 브라우저는 알림을 지원하지 않습니다.');
      return false;
    }

    if (Notification.permission === "granted") {
      return true;
    }

    if (Notification.permission === "denied") {
      console.warn('알림 권한이 거부되었습니다.');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    } catch (error) {
      console.error('알림 권한 요청 중 오류:', error);
      return false;
    }
  }

  static show(title: string, options: NotificationOptions = {}): Notification | null {
    if (!this.isSupported() || Notification.permission !== "granted") {
      console.log('알림을 표시할 수 없습니다:', title);
      return null;
    }

    const defaultOptions: NotificationOptions = {
      icon: '/favicon.ico', // 기본 아이콘
      badge: '/favicon.ico',
      tag: 'automation-task', // 같은 태그의 알림은 덮어씀
      requireInteraction: false, // 자동으로 사라짐
      silent: false, // 시스템 사운드 허용
      ...options
    };

    try {
      const notification = new Notification(title, defaultOptions);
      
      // 알림 클릭 시 창 포커스
      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      // 5초 후 자동으로 닫기
      setTimeout(() => {
        notification.close();
      }, 5000);

      return notification;
    } catch (error) {
      console.error('알림 생성 중 오류:', error);
      return null;
    }
  }

  /**
   * 작업 상태 변경에 따른 알림 표시
   */
  static showTaskNotification(status: TaskStatus, message: string, taskId: string | null = null): Notification | null {
    const statusConfig: Record<TaskStatus, NotificationConfig> = {
      'pending': {
        title: '⏳ 작업 대기',
        body: `대기: ${this.truncateMessage(message)}`,
        icon: '/favicon.ico',
        sound: null // 대기는 조용히
      },
      'processing': {
        title: '🚀 작업 시작됨',
        body: this.truncateMessage(message),
        icon: '/favicon.ico',
        sound: null // 시작은 조용히
      },
      'completed': {
        title: '✅ 작업 완료',
        body: `완료: ${this.truncateMessage(message)}`,
        icon: '/favicon.ico',
        sound: 'success'
      },
      'error': {
        title: '❌ 작업 오류',
        body: `오류: ${this.truncateMessage(message)}`,
        icon: '/favicon.ico',
        sound: 'error',
        requireInteraction: true // 오류는 사용자가 직접 닫을 때까지 유지
      }
    };

    const config = statusConfig[status];
    if (!config) {
      console.warn('알 수 없는 작업 상태:', status);
      return null;
    }

    // 알림 표시
    const notification = this.show(config.title, {
      body: config.body,
      icon: config.icon,
      tag: taskId ? `task-${taskId}` : 'task-generic',
      requireInteraction: config.requireInteraction || false
    });

    // 사운드 재생
    if (config.sound) {
      this.playSound(config.sound as SoundType);
    }

    return notification;
  }

  /**
   * 메시지 길이 제한 (알림에 너무 긴 텍스트 방지)
   */
  static truncateMessage(message: string | null | undefined, maxLength: number = 100): string {
    if (!message || typeof message !== 'string') return '메시지 없음';
    return message.length > maxLength ? 
           message.substring(0, maxLength) + '...' : message;
  }

  /**
   * 사운드 재생
   */
  static async playSound(soundType: SoundType): Promise<boolean> {
    try {
      // 동적 import로 audio utils 로드
      const { playSuccessSound, playErrorSound } = await import('./audio-utils');
      
      switch (soundType) {
        case 'success':
          return playSuccessSound();
        case 'error':
          return playErrorSound();
        default:
          console.warn('알 수 없는 사운드 타입:', soundType);
          return false;
      }
    } catch (error) {
      console.error('사운드 재생 중 오류:', error);
      return false;
    }
  }

  /**
   * 사운드 볼륨 설정 가져오기 (로컬스토리지에서)
   */
  static getSoundVolume(): number {
    try {
      const volume = localStorage.getItem('notification-sound-volume');
      return volume ? parseFloat(volume) : 0.7; // 기본 볼륨 70%
    } catch {
      return 0.7;
    }
  }

  /**
   * 사운드 볼륨 설정 저장
   */
  static setSoundVolume(volume: number): number {
    try {
      const clampedVolume = Math.max(0, Math.min(1, volume));
      localStorage.setItem('notification-sound-volume', clampedVolume.toString());
      return clampedVolume;
    } catch (error) {
      console.error('볼륨 설정 저장 중 오류:', error);
      return 0.7;
    }
  }

  /**
   * 알림 설정 상태 확인
   */
  static isEnabled(): boolean {
    try {
      return localStorage.getItem('notifications-enabled') !== 'false';
    } catch {
      return true; // 기본적으로 활성화
    }
  }

  /**
   * 알림 활성화/비활성화 설정
   */
  static setEnabled(enabled: boolean): void {
    try {
      localStorage.setItem('notifications-enabled', enabled.toString());
    } catch (error) {
      console.error('알림 설정 저장 중 오류:', error);
    }
  }

  /**
   * 테스트 알림 보내기
   */
  static showTestNotification(): void {
    if (this.isEnabled() && Notification.permission === "granted") {
      this.show("테스트 알림", {
        body: "알림이 정상적으로 작동합니다! 🎉",
        tag: 'test-notification'
      });
      this.playSound('success');
    }
  }
}

export default NotificationManager;