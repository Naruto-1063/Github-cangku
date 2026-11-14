import fs from 'node:fs'
import path from 'node:path'

const out = 'release/PromptForge-win-x64'
const exeName = '提示词工坊.exe'

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

// 1. Electron 运行时
const runtime = 'node_modules/electron/dist'
for (const entry of fs.readdirSync(runtime)) {
  fs.cpSync(path.join(runtime, entry), path.join(out, entry), { recursive: true })
}

// 2. 应用代码放在 resources/app，Electron 会自动加载
const appDir = path.join(out, 'resources', 'app')
fs.mkdirSync(appDir, { recursive: true })
fs.cpSync('dist', path.join(appDir, 'dist'), { recursive: true })
fs.cpSync('electron', path.join(appDir, 'electron'), { recursive: true })
fs.copyFileSync('package.json', path.join(appDir, 'package.json'))

// 3. 图标放到 resources 根目录，主进程从这里读托盘图标
fs.copyFileSync('build/icon.png', path.join(out, 'resources', 'icon.png'))
fs.copyFileSync('build/tray.png', path.join(out, 'resources', 'tray.png'))

// 4. 重命名主程序
fs.renameSync(path.join(out, 'electron.exe'), path.join(out, exeName))

const size = (dir) => {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    total += entry.isDirectory() ? size(full) : fs.statSync(full).size
  }
  return total
}

console.log(`组装完成：${out}`)
console.log(`体积：${(size(out) / 1024 / 1024).toFixed(0)} MB`)
console.log(`入口：${exeName}`)
