#!/usr/bin/env python3
"""
Claude PTY Wrapper - Identical to Claude-Autopilot implementation
Simple bridge between Node.js and Claude CLI via PTY
"""

import pty
import os
import sys
import select
import subprocess
import fcntl
import platform

def get_claude_command():
    """Get the appropriate command to run Claude CLI. On Windows, always use WSL since PTY requires Unix environment."""
    if platform.system() == 'Windows':
        # On Windows, we must use WSL because PTY functionality requires Unix-like system calls
        # that are not available on Windows (pty, select, fcntl modules)
        return ['wsl', 'claude']
    else:
        # Check for Claude CLI in common locations
        claude_paths = [
            'claude',  # Try system PATH first
            '/Users/jgw/.claude/local/claude',  # User-specific Claude installation
            '/usr/local/bin/claude',  # Common system location
            '/opt/homebrew/bin/claude'  # Homebrew on Apple Silicon
        ]
        
        for claude_path in claude_paths:
            if claude_path == 'claude':
                # For system PATH, use which command to check availability
                try:
                    result = subprocess.run(['which', 'claude'], capture_output=True, text=True)
                    if result.returncode == 0 and result.stdout.strip():
                        return ['claude']
                except:
                    continue
            else:
                # For absolute paths, check if file exists and is executable
                if os.path.exists(claude_path) and os.access(claude_path, os.X_OK):
                    return [claude_path]
        
        # Fallback to 'claude' if nothing found
        return ['claude']

def main():
    # Parse command line arguments
    skip_permissions = '--skip-permissions' in sys.argv
    
    # Parse working directory argument
    working_directory = None
    for i, arg in enumerate(sys.argv):
        if arg == '--working-dir' and i + 1 < len(sys.argv):
            working_directory = sys.argv[i + 1]
            break
    
    # Set working directory if specified
    if working_directory and os.path.exists(working_directory) and os.path.isdir(working_directory):
        try:
            os.chdir(working_directory)
            print(f"[PTY] Changed working directory to: {working_directory}", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[PTY] Warning: Failed to change working directory: {e}", file=sys.stderr, flush=True)
    
    print(f"[PTY] Starting Claude PTY wrapper...", file=sys.stderr, flush=True)
    print(f"[PTY] Skip permissions: {skip_permissions}", file=sys.stderr, flush=True)
    print(f"[PTY] Current working directory: {os.getcwd()}", file=sys.stderr, flush=True)
    
    # Spawn Claude with a proper PTY
    master, slave = pty.openpty()
    
    # Start Claude process with the slave PTY as its controlling terminal
    claude_args = get_claude_command()
    if skip_permissions:
        claude_args.append('--dangerously-skip-permissions')
    
    print(f"[PTY] Executing command: {' '.join(claude_args)}", file=sys.stderr, flush=True)
    
    try:
        claude_process = subprocess.Popen(
            claude_args,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True,
            preexec_fn=os.setsid if platform.system() != 'Windows' else None
        )
        print(f"[PTY] Claude process started with PID: {claude_process.pid}", file=sys.stderr, flush=True)
    except FileNotFoundError as e:
        print(f"[PTY] ERROR: Claude command not found - {e}", file=sys.stderr, flush=True)
        print(f"[PTY] Make sure 'claude' CLI is installed and in your PATH", file=sys.stderr, flush=True)
        sys.exit(1)
    except Exception as e:
        print(f"[PTY] ERROR: Failed to start Claude process - {e}", file=sys.stderr, flush=True)
        sys.exit(1)
    
    # Close the slave end in the parent process
    os.close(slave)
    
    # Set stdin to non-blocking mode
    stdin_flags = fcntl.fcntl(sys.stdin.fileno(), fcntl.F_GETFL)
    fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, stdin_flags | os.O_NONBLOCK)
    
    try:
        while claude_process.poll() is None:
            # Use select to handle both reading from master and stdin
            ready, _, _ = select.select([master, sys.stdin], [], [])
            
            if master in ready:
                try:
                    # Read from Claude and write to stdout
                    data = os.read(master, 1024)
                    if data:
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
                except OSError:
                    break
            
            if sys.stdin in ready:
                try:
                    # Read from stdin and write to Claude
                    # Read more data at once for better performance
                    data = sys.stdin.buffer.read(1024)
                    if data:
                        # Debug: print what we're sending to Claude
                        # Use stderr for debug output to avoid interfering with stdout data flow
                        # between the PTY and Claude - stdout is reserved for actual program output
                        sys.stderr.write(f"[PTY] Sending to Claude: {repr(data)}\n")
                        sys.stderr.flush()
                        os.write(master, data)
                except (OSError, BlockingIOError):
                    break
                    
    except KeyboardInterrupt:
        pass
    finally:
        # Clean up
        claude_process.terminate()
        claude_process.wait()
        os.close(master)

if __name__ == '__main__':
    main()