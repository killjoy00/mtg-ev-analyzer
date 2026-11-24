"""Current-user Windows setup for the reviewed Pack One Weekly runtime.

No installer-admin rights, network listener or terminal required. Credentials
are entered once in the local window and encrypted with Windows DPAPI for the
current account. The packaged private runner only receives them in memory.
"""
import base64
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import ttk, messagebox

APP = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'PackOneWeekly'
CONFIG = APP / 'settings.dpapi'
KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
ENTRY = 'PackOneWeekly'
FLAGS = ('PACKONE_WEEKLY_PRIVATE_RUNTIME', 'PACKONE_WEEKLY_NOTICE_VERIFIED', 'PACKONE_WEEKLY_PUBLICATION_ENABLED')
CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

class Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]

def crypt(data, decrypt=False):
    # DPAPI default is user-scoped, not machine-wide. No plaintext file.
    if os.name != 'nt':
        raise OSError('Windows required')
    source = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    inp, out = Blob(len(data), source), Blob()
    dpapi, kernel = ctypes.windll.crypt32, ctypes.windll.kernel32
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    dpapi.CryptProtectData.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    dpapi.CryptProtectData.restype = wintypes.BOOL
    dpapi.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    dpapi.CryptUnprotectData.restype = wintypes.BOOL
    if decrypt:
        ok = dpapi.CryptUnprotectData(ctypes.byref(inp), None, None, None, None, 1, ctypes.byref(out))
    else:
        ok = dpapi.CryptProtectData(ctypes.byref(inp), 'Pack One Weekly', None, None, None, 1, ctypes.byref(out))
    if not ok:
        raise OSError('Windows credential protection failed')
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel.LocalFree(out.pbData)

def load_config():
    try:
        raw = json.loads(crypt(CONFIG.read_bytes(), decrypt=True))
        if (set(raw) != {'database', 'token', 'notice', 'enabled'} or
            not isinstance(raw['database'], str) or not isinstance(raw['token'], str) or
            not isinstance(raw['notice'], bool) or not isinstance(raw['enabled'], bool)):
            raise ValueError()
        return raw
    except FileNotFoundError:
        return {'database': '', 'token': '', 'notice': False, 'enabled': False}

def save_config(data):
    APP.mkdir(parents=True, exist_ok=True)
    encrypted = crypt(json.dumps(data).encode('utf-8'))
    temporary = CONFIG.with_suffix('.tmp')
    with temporary.open('wb') as handle:
        handle.write(encrypted)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, CONFIG)

def runtime_root():
    return Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent

def validate_runtime(root):
    for rel in ('PackOneWeeklySetup.exe', 'runtime/node.exe', 'runtime/scripts/pack-one-weekly-private-runner.mjs',
                'runtime/WeeklyPrivateBridge.exe', 'runtime/node_modules/playwright/package.json', 'runtime/build.json'):
        if not (root / rel).is_file():
            raise ValueError('Package is incomplete')
    release = json.loads((root / 'runtime/build.json').read_text(encoding='utf-8'))
    revision = release.get('revision', '')
    if not isinstance(revision, str) or len(revision) != 40 or any(c not in '0123456789abcdef' for c in revision):
        raise ValueError('Invalid release revision')
    return revision

def install_runtime(root):
    revision = validate_runtime(root)
    destination = APP / ('release-' + revision)
    if root == destination:
        return destination
    APP.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        temporary = APP / ('installing-' + revision)
        if temporary.exists():
            shutil.rmtree(temporary)
        temporary.mkdir()
        shutil.copy2(root / 'PackOneWeeklySetup.exe', temporary / 'PackOneWeeklySetup.exe')
        shutil.copytree(root / 'runtime', temporary / 'runtime')
        validate_runtime(temporary)
        os.replace(temporary, destination)
    validate_runtime(destination)
    return destination

def startup(root, enable):
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, KEY) as key:
        if enable:
            exe = root / 'PackOneWeeklySetup.exe'
            winreg.SetValueEx(key, ENTRY, 0, winreg.REG_SZ, '"' + str(exe) + '" --autorun')
        else:
            try:
                winreg.DeleteValue(key, ENTRY)
            except FileNotFoundError:
                pass

def instance_lock():
    import msvcrt
    APP.mkdir(parents=True, exist_ok=True)
    handle = (APP / 'running.lock').open('a+b')
    handle.seek(0)
    handle.write(b'0')
    handle.flush()
    handle.seek(0)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        handle.close()
        raise
    return handle

def run_tick(root, config, check=False):
    runtime = root / 'runtime'
    # Inherited credentials and CI flags are deliberately not passed. Never
    # put secrets into args, persistent environment variables, or a log file.
    allow = ('PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'APPDATA',
             'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'PATHEXT',
             'ProgramFiles', 'ProgramFiles(x86)', 'COMSPEC', 'ComSpec')
    env = {k: v for k, v in os.environ.items() if k in allow}
    if not check and (not config['enabled'] or not config['notice']):
        return 'paused'
    env.update({flag: 'true' for flag in FLAGS})
    env.update(PACKONE_WEEKLY_DATABASE_URL=config['database'],
               PACKONE_WEEKLY_PATREON_READ_TOKEN=config['token'],
               PACKONE_WEEKLY_BRIDGE_EXE=str(runtime / 'WeeklyPrivateBridge.exe'),
               PLAYWRIGHT_BROWSERS_PATH=str(runtime / 'browsers'))
    try:
        result = subprocess.run([str(runtime / 'node.exe'), str(runtime / 'scripts/pack-one-weekly-private-runner.mjs'),
                                 '--check-config' if check else '--once'],
                                cwd=runtime, env=env, creationflags=CREATE_NO_WINDOW, timeout=240,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, encoding='utf-8', errors='replace')
        statuses = {'connections-verified', 'outside-window', 'already-verified', 'receipt-exists',
                    'queued-awaiting-verification', 'review-required', 'unexpected-public-post'}
        lines = result.stdout.strip().splitlines()
        if result.returncode == 0 and len(lines) == 1 and lines[0].startswith('pack-one-weekly:'):
            status = lines[0].split(':', 1)[1]
            if status in statuses:
                return status
    except (OSError, subprocess.TimeoutExpired):
        pass
    return 'failed-closed'

MESSAGES = {
    'connections-verified': 'Connected to Pack One and Patreon. No post was created.',
    'outside-window': 'Automatic mode is on. Next recap: Monday, noon Central.',
    'already-verified': 'This week’s recap is verified.',
    'receipt-exists': 'This week already has a receipt. No duplicate will be sent.',
    'queued-awaiting-verification': 'Sent to PostyBirb. Waiting for public verification.',
    'review-required': 'Review required. No duplicate will be sent.',
    'unexpected-public-post': 'A matching post already exists. No duplicate will be sent.',
    'paused': 'Automatic posting is paused.',
    'failed-closed': 'Connection or publication check failed. No automatic retry of an uncertain submission.'
}

def gui():
    root = tk.Tk()
    root.title('Pack One Weekly')
    root.geometry('650x455')
    root.resizable(False, False)
    try:
        lock = instance_lock()
    except OSError:
        messagebox.showinfo('Pack One Weekly', 'The weekly publisher is already open.')
        root.destroy()
        return
    try:
        current = load_config()
        location = runtime_root()
        validate_runtime(location)
    except Exception:
        messagebox.showerror('Pack One Weekly', 'The package or saved local setup could not be read. Reopen the reviewed download.')
        lock.close()
        root.destroy()
        return
    # If this is a reviewed update, preserve an enabled configuration and the
    # existing private receipt ledger. No credentials are copied into the app.
    installed = location
    if current['enabled']:
        try:
            installed = install_runtime(location)
            startup(installed, True)
        except Exception:
            current['enabled'] = False
    frame = ttk.Frame(root, padding=20)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='Pack One Weekly', font=('Segoe UI', 22, 'bold')).pack(anchor='w')
    ttk.Label(frame, text='Monday at noon Central · Uses your existing PostyBirb+ login.').pack(anchor='w', pady=(0, 14))
    ttk.Label(frame, text='Private weekly-publisher database connection').pack(anchor='w')
    database = tk.StringVar(value=current['database'])
    ttk.Entry(frame, textvariable=database, show='*', width=75).pack(fill='x', pady=(2, 10))
    ttk.Label(frame, text='Patreon read-only creator token').pack(anchor='w')
    token = tk.StringVar(value=current['token'])
    ttk.Entry(frame, textvariable=token, show='*', width=75).pack(fill='x', pady=(2, 10))
    notice = tk.BooleanVar(value=current['notice'])
    ttk.Checkbutton(frame, text='Pack One’s original player publication notice commitment is verified.', variable=notice).pack(anchor='w', pady=4)
    status = tk.StringVar(value='Automatic mode is on.' if current['enabled'] else 'Keep PostyBirb open. Check the connection first.')
    ttk.Label(frame, textvariable=status, wraplength=590).pack(anchor='w', pady=10)
    results = queue.Queue()
    busy = False
    buttons = ttk.Frame(frame)
    buttons.pack(anchor='w', pady=(3, 10))

    def read_entries():
        return {'database': database.get().strip(), 'token': token.get().strip(),
                'notice': bool(notice.get()), 'enabled': False}

    def work(mode):
        nonlocal busy, current, installed
        if busy:
            return
        if mode == 'pause':
            try:
                current = {**current, 'enabled': False}
                save_config(current)
                startup(installed, False)
                status.set(MESSAGES['paused'])
            except Exception:
                status.set('Could not save pause. Close this window to stop the local publisher.')
            return
        snapshot = current.copy() if mode == 'tick' else read_entries()
        if mode == 'enable' and not snapshot['notice']:
            status.set('Verify the publication notice before enabling automatic posts.')
            return
        if mode != 'tick' and (not snapshot['database'] or not snapshot['token']):
            status.set('Enter the dedicated private connection and read-only token.')
            return
        busy = True
        if mode != 'tick':
            status.set('Checking the private connection…')
        def worker():
            result = run_tick(installed, snapshot, check=mode != 'tick')
            results.put((mode, result, snapshot))
        threading.Thread(target=worker, daemon=True).start()

    ttk.Button(buttons, text='Check connection', command=lambda: work('check')).pack(side='left', padx=(0, 8))
    ttk.Button(buttons, text='Enable automatic posts', command=lambda: work('enable')).pack(side='left', padx=(0, 8))
    ttk.Button(buttons, text='Pause', command=lambda: work('pause')).pack(side='left')
    ttk.Label(frame, text='Credentials are encrypted for this Windows account. Keep the PC, this window and PostyBirb running. '
              'Automatic mode starts at Windows sign-in.', wraplength=590).pack(anchor='w', pady=5)

    def poll():
        nonlocal busy, installed, current
        try:
            mode, result, snapshot = results.get_nowait()
            busy = False
            if mode == 'enable' and result == 'connections-verified':
                try:
                    installed = install_runtime(location)
                    candidate = {**snapshot, 'enabled': True}
                    save_config(candidate)
                    startup(installed, True)
                    current = candidate
                    status.set('Automatic mode enabled. Monday at noon Central.')
                    root.after(500, lambda: work('tick'))
                except Exception:
                    current = {**snapshot, 'enabled': False}
                    try:
                        save_config(current)
                        startup(installed, False)
                    except Exception:
                        pass
                    status.set('Setup could not be installed. Automatic mode is off.')
            else:
                status.set(MESSAGES.get(result, MESSAGES['failed-closed']))
        except queue.Empty:
            pass
        root.after(200, poll)

    def scheduled():
        if current['enabled']:
            work('tick')
        root.after(60000, scheduled)

    root.after(200, poll)
    root.after(800, scheduled)
    def close():
        # Do not terminate a running draft/queue subprocess. The database
        # receipt protects a crash, but normal close waits for its status.
        if busy:
            status.set('A check is running. Close the window after it finishes.')
            return
        root.destroy()
    root.protocol('WM_DELETE_WINDOW', close)
    root.mainloop()
    lock.close()

if __name__ == '__main__':
    if '--self-test' in sys.argv:
        # A windowed PyInstaller executable can display a modal error dialog
        # on an unhandled exception, hanging an unattended build. Return fixed
        # diagnostic exit codes without ever opening a window in self-test.
        try:
            value = b'fixture-only'
            if crypt(crypt(value), decrypt=True) != value:
                raise ValueError('DPAPI round trip')
        except Exception:
            sys.exit(11)
        try:
            validate_runtime(runtime_root())
        except Exception:
            sys.exit(12)
        try:
            (runtime_root() / 'setup-self-test.ok').write_text('passed', encoding='ascii')
        except Exception:
            sys.exit(13)
        sys.exit(0)
    else:
        gui()
