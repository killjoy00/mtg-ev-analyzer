"""Current-user Windows setup for the unified Pack One Patreon publisher.

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
import re
import webbrowser
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import ttk, messagebox
from packone_patreon import lock_instance as lock_legacy_instance, disable_legacy_automatic

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
    blank = {'pairing': '', 'enabled': False}
    try:
        raw = json.loads(crypt(CONFIG.read_bytes(), decrypt=True))
        # Superseded direct-login configuration is deliberately not reused.
        # The new owner pairing code is required before automatic posting.
        if isinstance(raw, dict) and 'database' in raw:
            save_config(blank)
            return blank
        if (set(raw) != {'pairing', 'enabled'} or
            not isinstance(raw['pairing'], str) or
            not isinstance(raw['enabled'], bool)):
            raise ValueError()
        return raw
    except FileNotFoundError:
        return blank

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
    for rel in ('PackOnePatreonPublisher.exe', 'runtime/node.exe', 'runtime/scripts/pack-one-patreon-publisher.mjs',
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
        shutil.copy2(root / 'PackOnePatreonPublisher.exe', temporary / 'PackOnePatreonPublisher.exe')
        shutil.copytree(root / 'runtime', temporary / 'runtime')
        validate_runtime(temporary)
        os.replace(temporary, destination)
    validate_runtime(destination)
    return destination

def startup(root, enable):
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, KEY) as key:
        if enable:
            exe = root / 'PackOnePatreonPublisher.exe'
            # Take over the prior helper only after both process locks are held
            # and the unified connection check succeeded. Preserve its journal.
            disable_legacy_automatic()
            try:
                winreg.DeleteValue(key, 'PackOnePatreon')
            except FileNotFoundError:
                pass
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
    if not check and not config['enabled']:
        return 'paused'
    env.update({flag: 'true' for flag in FLAGS})
    env.update(PACKONE_WEEKLY_PAIRING_CODE=config['pairing'],
               PACKONE_WEEKLY_BRIDGE_EXE=str(runtime / 'WeeklyPrivateBridge.exe'),
               PLAYWRIGHT_BROWSERS_PATH=str(runtime / 'browsers'))
    try:
        result = subprocess.run([str(runtime / 'node.exe'), str(runtime / 'scripts/pack-one-patreon-publisher.mjs'),
                                 '--check-config' if check else '--once'],
                                cwd=runtime, env=env, creationflags=CREATE_NO_WINDOW, timeout=420,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, encoding='utf-8', errors='replace')
        lines = result.stdout.strip().splitlines()
        if result.returncode == 0 and len(lines) == 1 and lines[0].startswith('pack-one-publisher:'):
            value = lines[0].split(':', 1)[1]
            if check and value == 'connections-verified':
                return value
            if not check:
                result = json.loads(value)
                if (isinstance(result, dict) and set(result) == set(LANES)
                        and all(isinstance(v, str) and v in LANE_MESSAGES for v in result.values())):
                    return result
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass
    return 'failed-closed'

LANES = {'recap': 'Monday recap', 'pick': 'Pick of the Week', 'season': 'Season posts', 'lab': 'Pack One Lab'}
LANE_MESSAGES = {
    'outside-window': 'Not due', 'waiting-feed': 'Waiting for weekly feed',
    'public-confirmed': 'Public post confirmed by Patreon', 'already-verified': 'Verified', 'verified': 'Verified',
    'receipt-exists': 'Receipt exists; no duplicate', 'queued-awaiting-verification': 'Waiting for public verification',
    'review-required': 'Review required; no duplicate', 'unexpected-public-post': 'Matching public post exists',
    'failed-closed': 'Check failed; no retry of uncertain submission', 'not-connected': 'Not connected yet',
    'schema-unavailable': 'Backend release pending', 'guide-draft-awaiting-approval': 'Guide awaiting approval',
    'guide-evidence-unavailable': 'Guide evidence unavailable', 'lab-awaiting-approval': 'Article awaiting approval',
    'season-check-failed': 'Season check failed', 'lab-check-failed': 'Lab check failed'
}

MESSAGES = {
    'connections-verified': 'Connected to Pack One and Patreon. No post was created.',
    'outside-window': 'Automatic mode is on. No connected article is due.',
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
    root.title('Pack One Patreon Publisher')
    root.geometry('690x530')
    root.resizable(False, False)
    lock = legacy_lock = None
    try:
        lock = instance_lock()
        legacy_lock = lock_legacy_instance()
    except OSError:
        if lock is not None:
            lock.close()
        messagebox.showinfo('Pack One Patreon', 'Close the previous Pack One publisher or helper, then reopen this one.')
        root.destroy()
        return
    try:
        current = load_config()
        location = runtime_root()
        validate_runtime(location)
    except Exception:
        messagebox.showerror('Pack One Patreon', 'The package or saved local setup could not be read. Reopen the reviewed download.')
        legacy_lock.close()
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
            try:
                save_config(current)
                startup(installed, False)
            except Exception:
                pass
    frame = ttk.Frame(root, padding=20)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='Pack One Patreon Publisher', font=('Segoe UI', 22, 'bold')).pack(anchor='w')
    ttk.Label(frame, text='One publisher for all Pack One articles · Uses your existing PostyBirb+ login.').pack(anchor='w', pady=(0, 14))
    ttk.Label(frame, text='Pack One publisher pairing code').pack(anchor='w')
    pairing = tk.StringVar(value=current['pairing'])
    ttk.Entry(frame, textvariable=pairing, show='*', width=75).pack(fill='x', pady=(2, 10))
    ttk.Button(frame, text='Open Pack One Patreon admin', command=lambda: webbrowser.open('https://packone.pro/admin/?area=patreon')).pack(anchor='w', pady=(0, 10))
    ttk.Label(frame, text='Generate a pairing code in the owner-only Patreon admin, then paste it here once. No database login or Patreon API token is needed.', wraplength=590).pack(anchor='w', pady=4)
    status = tk.StringVar(value='Automatic mode is on.' if current['enabled'] else 'Keep PostyBirb open. Check the connection first.')
    ttk.Label(frame, textvariable=status, wraplength=590).pack(anchor='w', pady=10)
    results = queue.Queue()
    busy = False
    buttons = ttk.Frame(frame)
    buttons.pack(anchor='w', pady=(3, 10))

    def read_entries():
        return {'pairing': pairing.get().strip(), 'enabled': False}

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
        if mode != 'tick' and not re.fullmatch(r'p1w_[A-Za-z0-9_-]{43}', snapshot['pairing']):
            status.set('Enter the pairing code from Pack One’s Patreon admin.')
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
    ttk.Label(frame, text='The pairing code is encrypted for this Windows account. Keep the PC, this window and PostyBirb running. '
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
                    status.set('Automatic posting enabled for all connected article types.')
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
                if isinstance(result, dict):
                    status.set('\n'.join(label + ': ' + LANE_MESSAGES[result[key]] for key, label in LANES.items()))
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
    legacy_lock.close()
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
