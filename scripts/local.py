"""Start/status/stop local project services; only stop processes this launcher owns."""
import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'outputs'
STATE = OUTPUT / 'local-services.json'
PORTS = {'backend': ('127.0.0.1', 8000), 'web': ('localhost', 3000)}


def get_json(url):
    # Local calls should not be routed through system HTTP proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=3) as response:
        return json.load(response)


def healthy(name):
    host, port = PORTS[name]
    try:
        data = get_json(f'http://{host}:{port}/api/health')
        return data.get('status') == 'ok' and data.get('dataset') == 'synthetic'
    except (OSError, ValueError, AttributeError):
        return False


def port_open(name):
    host, port = PORTS[name]
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def identity(pid):
    if os.name != 'nt':
        return None
    command = f'Get-CimInstance Win32_Process -Filter "ProcessId = {int(pid)}" | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress'
    result = subprocess.run(['powershell.exe', '-NoProfile', '-Command', command], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        return json.loads(result.stdout) if result.returncode == 0 and result.stdout.strip() else None
    except ValueError:
        return None


def save_state(state):
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')


def read_state():
    try:
        return json.loads(STATE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def start_service(name, command, state):
    if healthy(name):
        print(f'{name}: 已在运行，直接复用。', flush=True)
        return
    if port_open(name):
        raise RuntimeError(f'{PORTS[name][1]} 端口被其他程序占用，未启动重复服务。')
    env = dict(os.environ, PYTHONUTF8='1', OLLAMA_NO_CLOUD='1')
    env.setdefault('OLLAMA_MODEL', 'qwen3:1.7b')
    # The extra report writer is opt-in; replenishment already uses one local model call.
    env.setdefault('OLLAMA_SUMMARY', '0')
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    with (OUTPUT / f'{name}.log').open('ab') as out, (OUTPUT / f'{name}-error.log').open('ab') as err:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=out, stderr=err, creationflags=flags)
    state[name] = {'pid': process.pid, 'identity': identity(process.pid)}
    save_state(state)
    print(f'{name}: 正在启动，请稍候…', flush=True)
    deadline = time.monotonic() + 100
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'{name} 提前退出。请查看 outputs/{name}-error.log。')
        if healthy(name):
            print(f'{name}: 已就绪。', flush=True)
            return
        time.sleep(1)
    raise RuntimeError(f'{name} 未在规定时间内就绪，请查看 outputs/{name}-error.log。')


def start(open_browser=True):
    if not (ROOT / 'node_modules/vinext/dist/cli.js').is_file():
        raise RuntimeError('缺少网页依赖，请在项目目录执行 npm ci。')
    node = shutil.which('node')
    if not node:
        raise RuntimeError('找不到 Node.js，请先安装 Node.js 22.13 或更高版本。')
    envfile = ROOT / '.env.local'
    existing = envfile.read_text(encoding='utf-8-sig') if envfile.exists() else ''
    active = [line.strip() for line in existing.splitlines() if line.strip() and not line.lstrip().startswith('#')]
    if not any(line.startswith('AGENT_BACKEND_URL=') for line in active):
        with envfile.open('a', encoding='utf-8') as file:
            file.write('\nAGENT_BACKEND_URL=http://127.0.0.1:8000\n')
    state = read_state()
    start_service('backend', [sys.executable, '-X', 'utf8', '-m', 'uvicorn', 'backend.api:app', '--host', '127.0.0.1', '--port', '8000'], state)
    start_service('web', [node, str(ROOT / 'node_modules/vinext/dist/cli.js'), 'dev'], state)
    status()
    print('\n网页：http://localhost:3000\n服务在后台运行；关闭此窗口不会停止服务。\n需要停止时双击“停止项目.cmd”。', flush=True)
    if open_browser:
        webbrowser.open('http://localhost:3000')


def status():
    for name in PORTS:
        print(f'{name}: ' + ('已连接' if healthy(name) else '未就绪'), flush=True)
    try:
        data = get_json('http://127.0.0.1:8000/api/services')
        print(f'Ollama: {data.get("ollama", "unknown")} · {data.get("model", "")}', flush=True)
        if data.get('ollama') != 'ready':
            print('请打开 Ollama 应用；模型未就绪时仍可使用手动计算和门店分析。', flush=True)
    except (OSError, ValueError):
        print('暂时无法检查模型状态。', flush=True)


def stop():
    state = read_state()
    for name, entry in list(state.items()):
        original = entry.get('identity')
        current = identity(entry.get('pid', 0))
        if current and original and current == original:
            result = subprocess.run(['taskkill', '/PID', str(entry['pid']), '/T', '/F'], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            if result.returncode == 0:
                print(f'{name}: 已停止。', flush=True)
                del state[name]
            else:
                print(f'{name}: 未能停止，请查看服务窗口。', flush=True)
        elif current:
            print(f'{name}: 无法核对进程身份，未停止该进程。', flush=True)
        else:
            state.pop(name, None)
    save_state(state)
    print('仅停止本启动器创建且身份核对一致的服务；不会关闭 Ollama 或其他项目。', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'status', 'stop'], nargs='?', default='start')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    try:
        if args.action == 'start': start(not args.no_browser)
        elif args.action == 'stop': stop()
        else: status()
    except Exception as error:
        print(f'启动提示：{error}', flush=True)
        sys.exit(1)
