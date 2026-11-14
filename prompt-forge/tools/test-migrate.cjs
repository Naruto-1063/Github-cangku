'use strict'

/**
 * 数据目录迁移的真实文件测试（在 Electron 里跑，需要 safeStorage/app 环境）：
 *   electron tools/test-migrate.cjs --user-data-dir=<临时目录>
 */
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

const store = require('../electron/store.js')

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failed += 1
}

app.whenReady().then(() => {
  const base = app.getPath('userData')
  const targetA = path.join(base, '..', 'pf-moved-a')
  const targetB = path.join(base, '..', 'pf-moved-b')
  fs.rmSync(targetA, { recursive: true, force: true })
  fs.rmSync(targetB, { recursive: true, force: true })

  fs.mkdirSync(base, { recursive: true })
  fs.writeFileSync(
    path.join(base, 'settings.json'),
    JSON.stringify({ providerId: 'deepseek', model: 'deepseek-chat', temperature: 0.3 })
  )
  fs.writeFileSync(path.join(base, 'history.json'), JSON.stringify([{ id: 'h1', input: 'a', output: 'b' }]))
  fs.writeFileSync(path.join(base, 'keys.json'), JSON.stringify({ deepseek: 'ciphertext' }))

  check('初始目录就是 userData', store.getDataDir() === base, store.getDataDir())
  check('初始判定为非自定义', store.isCustomDataDir() === false)

  const result = store.migrateDataDir(targetA)
  check('迁移返回 changed=true', result.changed === true)
  check('迁移了 3 个文件', result.files === 3, String(result.files))
  check('当前目录已切换到新位置', store.getDataDir() === targetA, store.getDataDir())
  check('isCustomDataDir=true', store.isCustomDataDir() === true)
  check('新目录有 settings.json', fs.existsSync(path.join(targetA, 'settings.json')))
  check('新目录有 history.json', fs.existsSync(path.join(targetA, 'history.json')))
  check('新目录有 keys.json', fs.existsSync(path.join(targetA, 'keys.json')))
  check('旧文件已移走（只剩备份）', !fs.existsSync(path.join(base, 'settings.json')))
  const backups = fs.readdirSync(base).filter((n) => n.includes('.bak-'))
  check('旧文件有备份留底', backups.length === 3, backups.slice(0, 3).join(', '))
  check('迁移后仍能读到设置', store.getSettings().providerId === 'deepseek')
  check('迁移后仍能读到历史', store.listHistory().length === 1)

  const again = store.migrateDataDir(targetA)
  check('重复迁移同一目录不报错且不搬动', again.changed === false)

  fs.mkdirSync(targetB, { recursive: true })
  fs.writeFileSync(path.join(targetB, 'settings.json'), '{}')
  let conflict = ''
  try {
    store.migrateDataDir(targetB)
  } catch (error) {
    conflict = error.message
  }
  check('目标目录已有数据时拒绝迁移', conflict.includes('已有'), conflict)
  check('拒绝后目录不变', store.getDataDir() === targetA)

  store.updateSettings({ templateId: 'coding' })
  const written = JSON.parse(fs.readFileSync(path.join(targetA, 'settings.json'), 'utf8'))
  check('迁移后写设置写到新目录', written.templateId === 'coding')
  check('旧目录没有再生成 settings.json', !fs.existsSync(path.join(base, 'settings.json')))

  fs.rmSync(targetA, { recursive: true, force: true })
  fs.rmSync(targetB, { recursive: true, force: true })

  console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`)
  app.exit(failed === 0 ? 0 : 1)
})
