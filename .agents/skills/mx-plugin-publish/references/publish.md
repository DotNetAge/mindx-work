# 打包与登记脚本范式

Python 标准库即可完成（zipfile + hashlib + json），无需第三方依赖。**所有路径与域名使用占位写法，勿硬编码具体机器路径**；脚本可按插件数量扩展为循环。

## 完整范式（单插件双版本）

```python
"""生成市场发布数据：N 个版本的插件 zip + sha256 + 静态 index.json"""
import hashlib
import json
import zipfile
from pathlib import Path

# 占位：发布产物输出目录（静态源根目录）
SERVE = Path('<发布目录>')
SERVE.mkdir(exist_ok=True)

# 占位：发布源公网基址（index.json 与 zip 同源托管）
BASE_URL = '<https://静态源基址>'

# 入口范式：default 导出 (app, mx) => cleanup；h 由壳注入，禁止 import Vue
ENTRY = '''export default function (app, mx) {{
  const {{ h }} = mx
  function Page() {{ /* 条目组件 */ }}
  app.Sidebar.add({{ /* 分节 + rows */ }})
  app.Content.add({{ /* 页面条目 */ }})
  return () => {{ /* 清理：逐区 remove */ }}
}}
'''

# manifest 字段契约见 mx-plugin-dev contract.md §18.2（缺字段会在安装侧校验被拒）
MANIFEST = {
    'id': '<反向域.id>',
    'name': '<显示名>',
    'description': '<描述>',
    'author': '<作者>',
    'url': '<主页>',
    'repo': '<仓库>',
    'license': '<许可证>',
    'entry': 'entry.mjs',
    'permissions': ['sidebar:register', 'content:register'],
    'mxApiVersion': '1',
}

versions = []
for version in ('<1.0.0>', '<1.1.0>'):
    zip_path = SERVE / f"{MANIFEST['id']}-{version}.zip"
    with zipfile.ZipFile(zip_path, 'w') as zf:
        # manifest.json 必须位于包根；version 并入 manifest
        zf.writestr('manifest.json', json.dumps(dict(MANIFEST, version=version), ensure_ascii=False, indent=2))
        zf.writestr('entry.mjs', ENTRY.format(version=version))
        # 其余资源文件按包根相对路径 writestr / write
    # sha256 = zip 文件字节哈希（安装时主进程与登记值比对，失配拒装）
    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    versions.append({'version': version, 'url': f'{BASE_URL}/{zip_path.name}', 'sha256': sha})

index = {
    'schemaVersion': 1,
    'plugins': [dict(MANIFEST, versions=versions)],
}
(SERVE / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8')
```

## 已有插件追加新版本（增量登记）

1. 读现有 index.json，找到对应插件条目。
2. 生成新版本 zip + sha256，**追加**到该条目 `versions` 数组（旧条目不删——切版能力依赖多版本数组）。
3. 写回 index.json（`ensure_ascii=False` 保持中文可读）。

## 登记校验清单

- [ ] manifest 字段与 contract.md §18.2 全量对齐（id 反向域格式、version 三段 semver、entry 以 `.mjs` 结尾）
- [ ] 每个 versions 条目含 `version / url / sha256` 三字段（`parseMarketIndex` 逐条校验，缺字段整条被剔除）
- [ ] index.json 的 `url` 全部指向同一公网静态源且可访问
- [ ] 同版本号内容与已发布版本字节一致（军规：版本不可变代际）
