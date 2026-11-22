"""Local dev modes launched by dev.ps1. Never rewrite hosted .env files."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import urllib.request

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
API = 'https://hdfc-bank.duckdns.org'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'demo'
CONTAINER = 'hdfc-bank-dev-mysql'


def command(*args, env=None, capture=False):
    return subprocess.run(args, cwd=ROOT, env=env, check=True, text=True,
                          capture_output=capture)


def local_mysql(env):
    command('docker', 'info', capture=True)
    path = ROOT / 'secrets/local/.env'
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(f'MYSQL_ROOT_PASSWORD={secrets.token_urlsafe(30)}\n'
                        f'MYSQL_PASSWORD={secrets.token_urlsafe(30)}\n'
                        'MYSQL_USER=bank\nMYSQL_DATABASE=hdfc_bank_local\n', encoding='utf-8')
    values = dotenv_values(path)
    exists = subprocess.run(['docker', 'container', 'inspect', CONTAINER],
                            capture_output=True, text=True)
    if exists.returncode:
        command('docker', 'run', '-d', '--name', CONTAINER,
                '--label', 'dev.hdfcbank.owner=dev.ps1', '--memory=512m',
                '--env-file', str(path), '-p', '127.0.0.1:3307:3306',
                '-v', 'hdfc-bank-dev-mysql:/var/lib/mysql', 'mysql:8.4',
                '--innodb-buffer-pool-size=128M', '--performance-schema=OFF')
    else:
        info = json.loads(exists.stdout)[0]
        if info['Config'].get('Labels', {}).get('dev.hdfcbank.owner') != 'dev.ps1':
            raise RuntimeError('Container name is already used by another project.')
        if info['HostConfig']['PortBindings'].get('3306/tcp') != [{'HostIp': '127.0.0.1', 'HostPort': '3307'}]:
            raise RuntimeError('Local MySQL must bind only to 127.0.0.1:3307.')
        command('docker', 'start', CONTAINER)
    env.update(BANK_LOCAL_MYSQL='1', DB_HOST='127.0.0.1', DB_PORT='3307',
               DB_NAME=values['MYSQL_DATABASE'], DB_USER=values['MYSQL_USER'],
               DB_PASSWORD=values['MYSQL_PASSWORD'], DB_SSL_CA='', DB_SSL_CA_BASE64='')
    import MySQLdb
    print('Waiting for local MySQL (first initialization can take a few minutes)...', flush=True)
    for _ in range(180):
        try:
            connection = MySQLdb.connect(host='127.0.0.1', port=3307,
                user=env['DB_USER'], password=env['DB_PASSWORD'], database=env['DB_NAME'], connect_timeout=2)
            connection.close()
            return
        except MySQLdb.Error:
            time.sleep(1)
    raise RuntimeError('Local MySQL did not become ready. Check docker logs hdfc-bank-dev-mysql.')


def main():
    if MODE not in ('demo', 'frontend', 'hosted-db', 'local'):
        raise ValueError('Unknown development mode')
    ports = [4321] + ([] if MODE == 'frontend' else [8000])
    for port in ports:
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                raise RuntimeError(f'Port {port} is already in use.')
    env = {**os.environ, **{k: v for k, v in dotenv_values(ROOT / 'backend/.env').items() if v is not None}}
    env.update(DJANGO_DEBUG='1', DJANGO_ALLOWED_HOSTS='localhost,127.0.0.1',
               DJANGO_TRUST_PROXY='0', CORS_ORIGINS='http://localhost:4321,http://127.0.0.1:4321')
    env.pop('RENDER', None)
    env.pop('BANK_LOCAL_MYSQL', None)
    env.pop('DJANGO_SETTINGS_MODULE', None)
    settings = []
    if MODE == 'demo':
        settings = ['--settings=config.demo_settings']
    elif MODE == 'local':
        local_mysql(env)
    elif MODE == 'hosted-db':
        if env.get('DB_HOST') != 'hdfc-bank.duckdns.org' or not env.get('DB_SSL_CA_BASE64'):
            raise RuntimeError('Restore backend/.env with the hosted DB credentials and CA first (option 7).')
        # Check connectivity and schema without applying migrations to the live database.
        command(sys.executable, str(ROOT / 'backend/manage.py'), 'migrate', '--check', env=env)
    if MODE in ('demo', 'local'):
        command(sys.executable, str(ROOT / 'backend/manage.py'), 'migrate', '--noinput', *settings, env=env)
    processes = []
    try:
        if MODE != 'frontend':
            processes.append(subprocess.Popen([sys.executable, str(ROOT / 'backend/manage.py'),
                'runserver', '127.0.0.1:8000', '--noreload', *settings], cwd=ROOT, env=env))
        # Never pass backend secrets to the frontend dev server.
        frontend_env = {k: v for k, v in os.environ.items()
                        if not k.startswith(('DB_', 'MYSQL_', 'DJANGO_', 'BREVO_', 'RESEND_', 'EMAIL_', 'COOLIFY_', 'BANK_'))}
        frontend_env.update(PUBLIC_API_URL=API if MODE == 'frontend' else 'http://127.0.0.1:8000')
        processes.append(subprocess.Popen(['node', str(ROOT / 'frontend/node_modules/astro/bin/astro.mjs'),
            'dev', '--host', '127.0.0.1', '--port', '4321'], cwd=ROOT / 'frontend', env=frontend_env))
        print(f'\nMode: {MODE} | Website: http://127.0.0.1:4321 | API: {frontend_env["PUBLIC_API_URL"]}', flush=True)
        print('Ctrl+C stops these servers. Local MySQL data stays in its Docker volume.', flush=True)
        while all(p.poll() is None for p in processes):
            time.sleep(0.5)
        raise RuntimeError('A development server exited. See its output above.')
    except KeyboardInterrupt:
        print('\nStopping local servers...', flush=True)
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if MODE == 'local':
            command('docker', 'stop', CONTAINER)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f'Development startup failed: {exc}', file=sys.stderr)
        sys.exit(1)
