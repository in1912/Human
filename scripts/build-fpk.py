# 打 Vivix Human 的飞牛 fpk（复刻 fnpack 三步；本机无 fnpack.exe，走 bsdtar 替代链）
# 外层结构照 JARVIS 那份（21 条目：4 目录 + 17 文件，顺序/权限/uid/gid/uname/mtime 全显式），
# manifest 走 fnpack 风格（去空行 + key 补到 27 列 + '= ' + CRLF + 末尾 checksum=MD5(app.tgz)）。
#
# 前置：node fnos/build-fpk.mjs  （装配到 <仓库同级>/human-fnos-build/vivixhuman）
import hashlib, io, os, subprocess, sys, tarfile

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 仓库根
BUILD = os.environ.get('HUMAN_BUILD') or os.path.join(os.path.dirname(ROOT), 'human-fnos-build')
PROJ = os.path.join(BUILD, 'vivixhuman')
APP = os.path.join(PROJ, 'app')
APP_TGZ = os.path.join(BUILD, 'app.tgz')
NEW = os.path.join(ROOT, 'Vivix-Human-飞牛应用-1.0.0.fpk')
BSDTAR = r'C:/Windows/System32/tar.exe'

# 外层成员（照 fnOS 官方包结构：`.` 打头 → 目录 → 文件按 ASCII 序）
MEMBERS = [
    ('.', True, 0o755), ('cmd', True, 0o755), ('config', True, 0o755), ('wizard', True, 0o755),
    ('ICON.PNG', False, 0o644), ('ICON_256.PNG', False, 0o644), ('app.tgz', False, 0o644),
    ('cmd/config_callback', False, 0o755), ('cmd/config_init', False, 0o755),
    ('cmd/install_callback', False, 0o755), ('cmd/install_init', False, 0o755),
    ('cmd/main', False, 0o755), ('cmd/uninstall_callback', False, 0o755),
    ('cmd/uninstall_init', False, 0o755), ('cmd/upgrade_callback', False, 0o755),
    ('cmd/upgrade_init', False, 0o755),
    ('config/privilege', False, 0o644), ('config/resource', False, 0o644),
    ('manifest', False, 0o644),
    ('wizard/config', False, 0o644), ('wizard/install', False, 0o644),
]

if not os.path.isdir(APP):
    sys.exit('未找到装配目录 %s —— 先跑 node fnos/build-fpk.mjs' % APP)

# ---- ⓪ 清残留（教训：CWD 里躺着上次的 raw 会打成旧版）----
for stale in (APP_TGZ, os.path.join(BUILD, 'manifest.sh'), os.path.join(BUILD, 'raw.fpk')):
    if os.path.exists(stale):
        os.remove(stale)
        print('[0] 清残留', stale)

# ---- ① app.tgz：载荷根平铺（无 app/ 前缀），bsdtar 自展开通配符 ----
subprocess.run([BSDTAR, '-czf', APP_TGZ, '*'], cwd=APP, check=True)
at_size = os.path.getsize(APP_TGZ)
print('[1] app.tgz', at_size, 'B')

# ---- ② manifest：fnpack 风格 ----
lines = []
with open(os.path.join(PROJ, 'manifest'), encoding='utf-8') as f:
    for raw in f.read().splitlines():
        if not raw.strip():
            continue
        key, _, val = raw.partition('=')
        lines.append(f'{key.strip():<27}= {val.strip()}')
with open(APP_TGZ, 'rb') as f:
    md5 = hashlib.md5(f.read()).hexdigest()
lines.append(f'{"checksum":<27}= {md5}')
mani = ('\r\n'.join(lines) + '\r\n').encode('utf-8')
print('[2] manifest', len(lines), 'lines, checksum', md5)

tmp_mani = os.path.join(BUILD, 'manifest.sh')
with open(tmp_mani, 'wb') as f:
    f.write(mani)

# ---- ③ 外层 tar.gz ----
src = {
    'manifest': tmp_mani,
    'ICON.PNG': os.path.join(PROJ, 'ICON.PNG'),
    'ICON_256.PNG': os.path.join(PROJ, 'ICON_256.PNG'),
    'app.tgz': APP_TGZ,
}
if os.path.exists(NEW):
    os.remove(NEW)
with tarfile.open(NEW, 'w:gz', format=tarfile.USTAR_FORMAT) as t:
    for name, isdir, mode in MEMBERS:
        ti = tarfile.TarInfo(name)
        ti.mode = mode
        ti.uid = ti.gid = 0
        ti.uname = ti.gname = 'root'
        ti.mtime = 0
        if isdir:
            ti.type = tarfile.DIRTYPE
            ti.size = 0
            t.addfile(ti)
        else:
            path = src.get(name, os.path.join(PROJ, name))
            with open(path, 'rb') as f:
                data = f.read()
            ti.size = len(data)
            t.addfile(ti, io.BytesIO(data))
print('[3] fpk', NEW, os.path.getsize(NEW), 'B')
