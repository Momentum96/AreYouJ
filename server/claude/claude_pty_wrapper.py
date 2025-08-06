#!/usr/bin/env python3
"""
Claude PTY Wrapper for AI Project Dashboard
Based on Claude-Autopilot PTY wrapper with enhancements for web integration.
"""

import pty
import os
import sys
import select
import subprocess
import fcntl
import platform
import json
import time
import threading
import re

class ClaudePTYWrapper:
    def __init__(self, skip_permissions=True):
        self.skip_permissions = skip_permissions
        self.claude_process = None
        self.master = None
        self.slave = None
        self.session_ready = False
        self.output_buffer = ""
        self.last_output_time = time.time()
        
    def get_claude_command(self):
        """Get the appropriate command to run Claude CLI"""
        if platform.system() == 'Windows':
            # On Windows, use WSL since PTY requires Unix environment
            return ['wsl', 'claude']
        else:
            return ['claude']
    
    def start_session(self):
        """Start Claude session with PTY"""
        try:
            # Create PTY
            self.master, self.slave = pty.openpty()
            
            # Prepare Claude command
            claude_args = self.get_claude_command()
            if self.skip_permissions:
                claude_args.append('--dangerously-skip-permissions')
            
            # Start Claude process
            self.claude_process = subprocess.Popen(
                claude_args,
                stdin=self.slave,
                stdout=self.slave,
                stderr=self.slave,
                close_fds=True,
                preexec_fn=os.setsid if platform.system() != 'Windows' else None
            )
            
            # Close slave in parent process
            os.close(self.slave)
            
            # Set stdin to non-blocking mode
            stdin_flags = fcntl.fcntl(sys.stdin.fileno(), fcntl.F_GETFL)
            fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, stdin_flags | os.O_NONBLOCK)
            
            self.log_message("Claude PTY session started successfully")
            return True
            
        except Exception as e:
            self.log_error(f"Failed to start Claude session: {e}")
            return False
    
    def wait_for_ready_prompt(self, timeout=30):
        """Wait for Claude to show the ready prompt"""
        start_time = time.time()
        buffer = ""
        
        while time.time() - start_time < timeout:
            if self.claude_process.poll() is not None:
                self.log_error("Claude process terminated unexpectedly")
                return False
            
            try:
                ready, _, _ = select.select([self.master], [], [], 1.0)
                if self.master in ready:
                    data = os.read(self.master, 1024)
                    if data:
                        text = data.decode('utf-8', errors='ignore')
                        buffer += text
                        
                        # Check for ready prompt patterns
                        if '? for shortcuts' in buffer or '>' in buffer[-5:]:
                            self.session_ready = True
                            self.log_message("Claude session is ready for input")
                            return True
                            
            except OSError:
                continue
        
        self.log_error(f"Timeout waiting for Claude ready prompt ({timeout}s)")
        return False
    
    def send_message_chunked(self, message):
        """Send message to Claude in chunks with proper timing"""
        if not self.claude_process or not self.session_ready:
            self.log_error("Claude session not ready")
            return False
        
        try:
            # Calculate chunks (1KB each)
            CHUNK_SIZE = 1024
            message_bytes = message.encode('utf-8')
            chunks = [message_bytes[i:i + CHUNK_SIZE] 
                     for i in range(0, len(message_bytes), CHUNK_SIZE)]
            
            self.log_message(f"Sending message in {len(chunks)} chunks ({len(message_bytes)} bytes)")
            
            # Send each chunk with delay
            for i, chunk in enumerate(chunks):
                os.write(self.master, chunk)
                self.log_debug(f"Sent chunk {i+1}/{len(chunks)} ({len(chunk)} bytes)")
                time.sleep(0.2)  # 200ms delay between chunks
            
            # Wait for chunks to be processed
            time.sleep(0.3)
            
            # Send carriage return to execute
            os.write(self.master, b'\r')
            self.log_message("Message sent successfully, waiting for Claude response...")
            
            return True
            
        except Exception as e:
            self.log_error(f"Failed to send message: {e}")
            return False
    
    def stream_terminal_output(self, timeout=120):
        """Stream raw terminal output in real-time with proper ANSI handling"""
        start_time = time.time()
        buffer = ""
        complete_output = ""
        output_chunks = []
        last_chunk_time = time.time()
        
        while time.time() - start_time < timeout:
            if self.claude_process.poll() is not None:
                self.log_error("Claude process terminated during response")
                break
            
            try:
                ready, _, _ = select.select([self.master], [], [], 0.1)  # Shorter timeout for responsiveness
                if self.master in ready:
                    data = os.read(self.master, 4096)  # Larger buffer for better throughput
                    if data:
                        text = data.decode('utf-8', errors='ignore')
                        buffer += text
                        complete_output += text
                        output_chunks.append(text)
                        self.last_output_time = time.time()
                        last_chunk_time = time.time()
                        
                        # Stream terminal output with Claude-Autopilot style throttling
                        self.print_json({
                            "type": "terminal_output",
                            "data": text,
                            "timestamp": time.time(),
                            "is_raw": True
                        })
                        
                        # Check for clear screen patterns (like Claude-Autopilot)
                        clear_patterns = ['\x1b[2J', '\x1b[H\x1b[2J', '\x1b[2J\x1b[H', '\x1b[3J']
                        has_clear = any(pattern in text for pattern in clear_patterns)
                        
                        if has_clear:
                            self.print_json({
                                "type": "screen_clear",
                                "timestamp": time.time()
                            })
                        
                        # Check for completion patterns (prompt detection)
                        if self.is_prompt_ready(buffer):
                            self.log_message("Claude prompt ready - response complete")
                            
                            # Send final complete output
                            self.print_json({
                                "type": "response_complete",
                                "output": complete_output,
                                "timestamp": time.time()
                            })
                            return complete_output
                            
                else:
                    # No new output, check if we should send buffered output
                    if output_chunks and time.time() - last_chunk_time > 0.5:
                        # Send accumulated chunks as complete update
                        accumulated_text = ''.join(output_chunks)
                        if accumulated_text.strip():
                            self.print_json({
                                "type": "output_update",
                                "data": accumulated_text,
                                "timestamp": time.time()
                            })
                        output_chunks = []
                    
                    # Check if we're done waiting
                    if time.time() - self.last_output_time > 5.0:
                        if complete_output.strip():
                            self.log_message("Response completed (inactivity timeout)")
                            self.print_json({
                                "type": "response_complete", 
                                "output": complete_output,
                                "timestamp": time.time()
                            })
                            return complete_output
                
            except OSError:
                continue
        
        self.log_error(f"Timeout waiting for Claude response ({timeout}s)")
        if complete_output.strip():
            self.print_json({
                "type": "response_timeout",
                "output": complete_output, 
                "timestamp": time.time()
            })
        return complete_output
    
    def is_prompt_ready(self, buffer):
        """Check if Claude is ready for next input"""
        # Check for Claude-specific prompt patterns
        prompt_patterns = [
            '? for shortcuts',  # Main prompt indicator
            'Bypassing Permissions',  # Session ready
        ]
        
        # Look at the last 200 characters for efficiency
        recent_buffer = buffer[-200:] if len(buffer) > 200 else buffer
        
        # Check for clear screen followed by prompt
        clear_patterns = ['\x1b[2J', '\x1b[H\x1b[2J', '\x1b[2J\x1b[H']
        has_clear = any(pattern in recent_buffer for pattern in clear_patterns)
        
        if has_clear:
            # After clear screen, look for prompt indicators
            return any(pattern in recent_buffer for pattern in prompt_patterns)
        
        # Also check for standard prompt ending patterns
        if recent_buffer.endswith('> ') or '? for shortcuts' in recent_buffer:
            return True
            
        return False
    
    def process_queue_item(self, message_text, max_retries=3):
        """Process a single queue item with real-time streaming and retry logic"""
        self.log_message(f"Processing message: {message_text[:100]}...")
        
        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    self.log_message(f"Retry attempt {attempt + 1}/{max_retries}")
                    time.sleep(2 ** attempt)  # Exponential backoff
                
                # Check if Claude process is still alive
                if self.claude_process and self.claude_process.poll() is not None:
                    self.log_error(f"Claude process died (exit code: {self.claude_process.poll()})")
                    if not self.restart_claude_session():
                        return {
                            "status": "error", 
                            "error": "Failed to restart Claude session",
                            "attempt": attempt + 1
                        }
                
                # Send message with timeout
                send_success = self.send_message_chunked(message_text)
                if not send_success:
                    self.log_error(f"Failed to send message (attempt {attempt + 1})")
                    if attempt < max_retries - 1:
                        continue  # Retry
                    else:
                        return {
                            "status": "error", 
                            "error": f"Failed to send message after {max_retries} attempts"
                        }
                
                # Stream response in real-time with timeout
                response = self.stream_terminal_output(timeout=180)  # 3 minutes timeout
                
                if response is not None and response.strip():
                    return {
                        "status": "completed",
                        "output": response,
                        "timestamp": time.time(),
                        "attempts": attempt + 1
                    }
                else:
                    self.log_error(f"Empty or no response received (attempt {attempt + 1})")
                    if attempt < max_retries - 1:
                        continue  # Retry
                    else:
                        return {
                            "status": "error", 
                            "error": f"No valid response after {max_retries} attempts"
                        }
                        
            except Exception as e:
                self.log_error(f"Error processing message (attempt {attempt + 1}): {e}")
                if attempt < max_retries - 1:
                    continue  # Retry
                else:
                    return {
                        "status": "error", 
                        "error": f"Processing failed after {max_retries} attempts: {str(e)}"
                    }
        
        # Should not reach here, but just in case
        return {
            "status": "error", 
            "error": "Unexpected error in retry logic"
        }

    def restart_claude_session(self):
        """Restart Claude session if it has crashed"""
        try:
            self.log_message("Attempting to restart Claude session...")
            
            # Clean up old process
            if self.claude_process:
                try:
                    self.claude_process.terminate()
                    time.sleep(2)
                    if self.claude_process.poll() is None:
                        self.claude_process.kill()
                except:
                    pass
                    
            if self.master:
                try:
                    os.close(self.master)
                except:
                    pass
                    
            if self.slave:
                try:
                    os.close(self.slave)
                except:
                    pass
            
            # Start new Claude session
            success = self.start_claude()
            if success:
                self.log_message("✅ Claude session restarted successfully")
                return True
            else:
                self.log_error("❌ Failed to restart Claude session")
                return False
                
        except Exception as e:
            self.log_error(f"Error restarting Claude session: {e}")
            return False
    
    def log_message(self, message):
        """Log info message"""
        self.print_json({
            "type": "log",
            "level": "info", 
            "message": message,
            "timestamp": time.time()
        })
    
    def log_error(self, message):
        """Log error message"""
        self.print_json({
            "type": "log",
            "level": "error",
            "message": message, 
            "timestamp": time.time()
        })
    
    def log_debug(self, message):
        """Log debug message"""
        self.print_json({
            "type": "log",
            "level": "debug",
            "message": message,
            "timestamp": time.time()
        })
    
    def log_output(self, output):
        """Log Claude output"""
        self.print_json({
            "type": "output",
            "content": output,
            "timestamp": time.time()
        })
    
    def print_json(self, data):
        """Print JSON data to stdout for Node.js communication"""
        try:
            json_str = json.dumps(data)
            print(json_str, flush=True)
            # Also log to stderr for debugging
            print(f"[PTY-JSON] {json_str}", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[PTY-ERROR] Failed to print JSON: {e}", file=sys.stderr, flush=True)
    
    def cleanup(self):
        """Clean up resources"""
        try:
            if self.claude_process:
                self.claude_process.terminate()
                self.claude_process.wait(timeout=5)
        except:
            if self.claude_process:
                self.claude_process.kill()
        
        if self.master:
            try:
                os.close(self.master)
            except:
                pass
    
    def run_interactive_mode(self):
        """Run in interactive mode for testing"""
        if not self.start_session():
            return False
        
        if not self.wait_for_ready_prompt():
            return False
        
        try:
            while True:
                try:
                    # Check for stdin input
                    ready, _, _ = select.select([sys.stdin, self.master], [], [], 1.0)
                    
                    if self.master in ready:
                        try:
                            data = os.read(self.master, 1024)
                            if data:
                                sys.stdout.buffer.write(data)
                                sys.stdout.buffer.flush()
                                self.last_output_time = time.time()
                        except OSError:
                            break
                    
                    if sys.stdin in ready:
                        try:
                            data = sys.stdin.buffer.read(1024)
                            if data:
                                os.write(self.master, data)
                        except (OSError, BlockingIOError):
                            break
                            
                except KeyboardInterrupt:
                    break
                    
        finally:
            self.cleanup()
        
        return True

def main():
    """Main entry point"""
    skip_permissions = '--skip-permissions' in sys.argv
    interactive = '--interactive' in sys.argv
    
    wrapper = ClaudePTYWrapper(skip_permissions=skip_permissions)
    
    try:
        if interactive:
            # Interactive mode for testing
            wrapper.run_interactive_mode()
        else:
            # JSON communication mode for Node.js integration
            if not wrapper.start_session():
                sys.exit(1)
            
            if not wrapper.wait_for_ready_prompt():
                sys.exit(1)
            
            wrapper.print_json({
                "type": "ready",
                "message": "Claude session ready for messages",
                "timestamp": time.time()
            })
            
            # Listen for JSON commands from stdin using select for non-blocking
            while wrapper.claude_process and wrapper.claude_process.poll() is None:
                try:
                    # Check for stdin input with timeout
                    ready, _, _ = select.select([sys.stdin], [], [], 1.0)
                    
                    if sys.stdin in ready:
                        try:
                            line = sys.stdin.readline()
                            if not line:  # EOF
                                break
                                
                            line = line.strip()
                            if not line:
                                continue
                                
                            command = json.loads(line)
                            
                            if command.get("action") == "send_message":
                                message = command.get("message", "")
                                result = wrapper.process_queue_item(message)
                                wrapper.print_json({
                                    "type": "result",
                                    "data": result,
                                    "message_id": command.get("message_id")
                                })
                            
                            elif command.get("action") == "ping":
                                wrapper.print_json({
                                    "type": "pong",
                                    "timestamp": time.time()
                                })
                            
                            elif command.get("action") == "exit":
                                break
                                
                        except json.JSONDecodeError as e:
                            wrapper.log_error(f"Invalid JSON command: {e}")
                        except Exception as e:
                            wrapper.log_error(f"Command processing error: {e}")
                            
                except KeyboardInterrupt:
                    break
                except Exception as e:
                    wrapper.log_error(f"Main loop error: {e}")
                    break
    
    except Exception as e:
        print(json.dumps({
            "type": "error",
            "message": f"Fatal error: {e}",
            "timestamp": time.time()
        }), flush=True)
        sys.exit(1)
    
    finally:
        wrapper.cleanup()

if __name__ == '__main__':
    main()